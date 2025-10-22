import base64, json, secrets
from django.utils import timezone
from django.contrib.auth.models import User
from rest_framework import permissions, status, generics
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.throttling import UserRateThrottle, ScopedRateThrottle
from django.core.cache import cache
from django.db.models import Sum, Value
from django.db.models.functions import Coalesce
from django.db import transaction
from django.conf import settings
import redis as redislib
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding as asy_padding

from .models import DeviceKey, GrantJTI, Receipt, ReceiptItem
from .serializers import DeviceRegisterSerializer, ProcessGrantSerializer, DevCreateReceiptSerializer
from .crypto_utils import (
    load_server_rsa_pub_pem, jwt_verify_eddsa, unwrap_dek_rsa_oaep, aesgcm_decrypt
)

from .serializers import IngestReceiptSerializer, ReceiptSerializer
from .ocr_adapter import parse_image_to_json
from .crypto_utils import aesgcm_encrypt
from django.http import JsonResponse
import traceback

import datetime
import secrets
import base64
from nacl import signing
from nacl.encoding import Base64Encoder

# Optional Redis for single-use JTI
def redis_client():
    url = getattr(settings, "REDIS_URL", None)
    return redislib.from_url(url) if url else None

class ServerPubKeyView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response({
            "algorithm": "RSA-OAEP-SHA256",
            "pem": load_server_rsa_pub_pem()
        })

class DeviceRegisterView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        s = DeviceRegisterSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        DeviceKey.objects.update_or_create(
            user=request.user,
            device_id=s.validated_data["device_id"],
            defaults={"public_key_b64": s.validated_data["public_key_b64"], "is_active": True}
        )
        return Response({"ok": True})

class ProcessDecryptView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle, UserRateThrottle]
    throttle_scope = "decrypt"

    @transaction.atomic
    def post(self, request):
        # Enforce throttle early to ensure 429 takes precedence over validation errors
        # DRF throttles (best-effort; may run again in APIView.initial)
        self.check_throttles(request)

        # Helper: manual lightweight per-user limiter (used only on invalid grant paths)
        def manual_limit_or_increment():
            try:
                if request.user and request.user.is_authenticated:
                    rl_key = f"rl:decrypt:u:{request.user.id}"
                else:
                    ident = request.META.get("REMOTE_ADDR") or "anon"
                    rl_key = f"rl:decrypt:ip:{ident}"
                hits = cache.get(rl_key) or 0
                if hits >= 1:
                    return Response({"code": "rate_limited", "detail": "Request was throttled."}, status=429)
                cache.set(rl_key, hits + 1, timeout=60)
            except Exception:
                # Never fail request due to cache issues
                return None
            return None
        s = ProcessGrantSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        token = s.validated_data["token"]
        dek_wrap_srv = s.validated_data["dek_wrap_srv"]
        targets = s.validated_data["targets"]

        # Parse header to get kid (device_id). If invalid, continue so throttling can still apply.
        try:
            header_b64 = token.split(".")[0]
            header = json.loads(base64.urlsafe_b64decode(header_b64 + "=="))
            kid = header.get("kid")
        except Exception:
            # Invalid header: apply manual limiter and proceed to generic error
            resp = manual_limit_or_increment()
            if resp:
                return resp
            kid = None

        # Lookup device public key
        try:
            dev = DeviceKey.objects.get(user=request.user, device_id=kid, is_active=True)
        except DeviceKey.DoesNotExist:
            resp = manual_limit_or_increment()
            if resp:
                return resp
            return Response({"detail": "Unknown device"}, status=403)

        # Verify JWT
        try:
            payload = jwt_verify_eddsa(token, dev.public_key_b64)
        except Exception as e:
            resp = manual_limit_or_increment()
            if resp:
                return resp
            return Response({"detail": f"JWT verify failed: {e}"}, status=403)

        # Single-use JTI check
        jti = payload.get("jti")
        if not jti:
            resp = manual_limit_or_increment()
            if resp:
                return resp
            return Response({"detail": "Missing jti"}, status=400)

        r = redis_client()
        if r:
            # atomic set-if-not-exists with TTL ~180s
            ok = r.set(name=f"grant:jti:{jti}", value="1", nx=True, ex=180)
            if not ok:
                return Response({"detail": "Replay detected"}, status=409)
        else:
            if GrantJTI.objects.filter(jti=jti).exists():
                return Response({"detail": "Replay detected"}, status=409)
            GrantJTI.objects.create(jti=jti, user=request.user, device_id=dev.device_id)

        # At this point, grant is valid and not a replay. Apply manual limiter after replay guard.
        resp = manual_limit_or_increment()
        if resp:
            return resp

        scope = set(payload.get("scope") or [])
        if "receipt:decrypt" not in scope:
            return Response({"detail": "Scope denied"}, status=403)

        # Optional: enforce targets from payload if included
        # payload_targets = payload.get("targets"); if payload_targets and set(map(str,payload_targets)) != set(map(str,targets)): deny

        # Unwrap DEK (memory only)
        try:
            dek = unwrap_dek_rsa_oaep(dek_wrap_srv)
        except Exception:
            return Response({"detail": "DEK unwrap failed"}, status=400)

        # Decrypt & process
        receipts = list(Receipt.objects.filter(user=request.user, id__in=targets))
        results = []
        try:
            for rcp in receipts:
                pt = aesgcm_decrypt(
                    key=dek,
                    nonce=bytes(rcp.body_nonce),
                    ct=bytes(rcp.body_ct),
                    tag=bytes(rcp.body_tag),
                    aad=b"receipt_v1"
                )
                # Here you’d run server-side processing (e.g., categorize)
                results.append({"id": rcp.id, "plaintext_json": pt.decode("utf-8")})
        finally:
            # Best-effort zeroize
            ba = bytearray(dek)
            for i in range(len(ba)): ba[i] = 0

        return Response({"data": results, "processed_at": timezone.now().isoformat()})

# ----- Dev-only helper to insert encrypted rows for testing -----
class DevCreateEncryptedReceiptView(APIView):
    permission_classes = [permissions.IsAdminUser]  # restrict to staff in dev


    def post(self, request):
        if not getattr(settings, "ALLOW_DEV_ENDPOINTS", True):
            return Response({"code": "not_found", "detail": "Not found"}, status=404)
        s = DevCreateReceiptSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        user = User.objects.get(id=s.validated_data["user_id"])
        r = Receipt.objects.create(
            user=user,
            year=s.validated_data["year"],
            month=s.validated_data["month"],
            category=s.validated_data["category"],
            body_nonce=base64.b64decode(s.validated_data["body_nonce_b64"]),
            body_ct=base64.b64decode(s.validated_data["body_ct_b64"]),
            body_tag=base64.b64decode(s.validated_data["body_tag_b64"]),
        )
        return Response({"receipt_id": r.id})


class IngestReceiptView(APIView):
    """
    POST multipart/form-data with:
      - token: short-lived EdDSA JWT (scope must include 'receipt:ingest')
      - dek_wrap_srv: base64 RSA-OAEP wrapping of user's DEK
      - year, month, category
      - image: receipt photo
    Server unwraps DEK, OCRs image, encrypts JSON with DEK, stores, zeroizes DEK, returns receipt_id.
    """
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle, UserRateThrottle]
    throttle_scope = "ingest"

    @transaction.atomic
    def post(self, request):
        # Enforce throttle early to ensure 429 takes precedence
        self.check_throttles(request)
        s = IngestReceiptSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        token = s.validated_data["token"]
        dek_wrap_srv = s.validated_data["dek_wrap_srv"]
        year = s.validated_data["year"]
        month = s.validated_data["month"]
        category = s.validated_data["category"]
        image = s.validated_data["image"]

        # Parse header.kid. If invalid, continue so throttling can still apply.
        try:
            header_b64 = token.split(".")[0]
            header = json.loads(base64.urlsafe_b64decode(header_b64 + "=="))
            kid = header.get("kid")
        except Exception:
            kid = None

        # Verify device
        try:
            dev = DeviceKey.objects.get(user=request.user, device_id=kid, is_active=True)
        except DeviceKey.DoesNotExist:
            return Response({"detail": "Unknown device"}, status=403)

        # Verify JWT
        try:
            payload = jwt_verify_eddsa(token, dev.public_key_b64)
        except Exception as e:
            return Response({"detail": f"JWT verify failed: {e}"}, status=403)

        # Single-use JTI
        jti = payload.get("jti")
        if not jti:
            return Response({"detail": "Missing jti"}, status=400)
        r = redis_client()
        if r:
            ok = r.set(name=f"grant:jti:{jti}", value="1", nx=True, ex=180)
            if not ok:
                return Response({"detail": "Replay detected"}, status=409)
        else:
            if GrantJTI.objects.filter(jti=jti).exists():
                return Response({"detail": "Replay detected"}, status=409)
            GrantJTI.objects.create(jti=jti, user=request.user, device_id=dev.device_id)

        # Scope check
        scope = set(payload.get("scope") or [])
        if "receipt:ingest" not in scope:
            return Response({"detail": "Scope denied"}, status=403)

        try:
            # 1) Read image
            img_bytes = image.read()
            if not img_bytes:
                return Response({"detail": "empty image upload"}, status=400)

            # 2) OCR
            try:
                parsed = parse_image_to_json(img_bytes)
            except Exception as e:
                return Response({"detail": f"parse_image_to_json failed: {e}", "trace": traceback.format_exc()}, status=500)
            if not isinstance(parsed, dict):
                return Response({"detail": f"parse_image_to_json returned {type(parsed).__name__}, wanted dict"}, status=500)
            try:
                pt = json.dumps(parsed, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
            except Exception as e:
                return Response({"detail": f"json.dumps failed: {e}"}, status=500)

            # 3) Unwrap DEK (RSA-OAEP-SHA256)
            try:
                dek = unwrap_dek_rsa_oaep(dek_wrap_srv)
            except Exception as e:
                return Response({"detail": f"DEK unwrap failed: {e}", "trace": traceback.format_exc()}, status=400)
            if not isinstance(dek, (bytes, bytearray)) or len(dek) not in (16, 24, 32):
                return Response({"detail": f"unwrapped DEK has invalid length={len(dek) if isinstance(dek,(bytes,bytearray)) else 'n/a'}"}, status=400)

            # 4) Encrypt (AES-GCM)
            try:
                nonce, ct, tag = aesgcm_encrypt(dek, pt, aad=b"receipt_v1")
            except Exception as e:
                return Response({"detail": f"aesgcm_encrypt failed: {e}", "trace": traceback.format_exc()}, status=500)

            # 5) Persist (ciphertext + derived columns)
            try:
                # parse derived fields (best effort)
                parsed_obj = json.loads(pt.decode("utf-8")) if isinstance(pt, (bytes, bytearray)) else {}
                merchant = (parsed_obj.get("merchant") or "").strip()
                currency = (parsed_obj.get("currency") or "USD").strip() or "USD"
                # prefer date_str if present else "date"
                date_str = (parsed_obj.get("date_str") or parsed_obj.get("date") or "")
                from decimal import Decimal, ROUND_HALF_UP
                def _to_cents(v):
                    try:
                        return Decimal(str(v)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                    except Exception:
                        return Decimal("0.00")
                total_val = _to_cents(parsed_obj.get("total", 0))

                rec = Receipt.objects.create(
                    user=request.user,
                    year=year, month=month, category=category,
                    merchant=merchant[:255],
                    date_str=str(date_str)[:32],
                    currency=currency[:8] or "USD",
                    total=total_val,
                    body_nonce=nonce, body_ct=ct, body_tag=tag,
                )

                # optional: create items
                try:
                    items = parsed_obj.get("items") or []
                    from .models import ReceiptItem
                    from decimal import Decimal
                    for it in items:
                        desc = str(it.get("desc") or "").strip()
                        if not desc:
                            continue
                        qty = it.get("qty", 1)
                        price = it.get("price", 0)
                        try:
                            qd = Decimal(str(qty))
                        except Exception:
                            qd = Decimal("1")
                        try:
                            pd = Decimal(str(price)).quantize(Decimal("0.01"))
                        except Exception:
                            pd = Decimal("0.00")
                        ReceiptItem.objects.create(
                            receipt=rec, desc=desc[:512], qty=qd, price=pd
                        )
                except Exception:
                    # do not fail ingest if items fail
                    pass
            except Exception as e:
                return Response({"detail": f"DB insert failed: {e}", "trace": traceback.format_exc()}, status=500)

        finally:
            # best-effort zeroize
            try:
                if isinstance(dek, (bytes, bytearray)):
                    ba = bytearray(dek)
                    for i in range(len(ba)): ba[i] = 0
            except Exception:
                pass

        return Response({"receipt_id": rec.id}, status=200)
        # --- end TEMP block ---



class ReceiptListView(generics.ListAPIView):
    serializer_class = ReceiptSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        qs = Receipt.objects.filter(user=self.request.user)
        # Filters: month=YYYY-MM, category, merchant (icontains)
        month = self.request.query_params.get("month")
        if month:
            # allow YYYY-MM or YYYY/MM
            try:
                parts = month.replace("/", "-").split("-")
                if len(parts) >= 2:
                    y = int(parts[0]); m = int(parts[1])
                    qs = qs.filter(year=y, month=m)
            except Exception:
                pass
        cat = self.request.query_params.get("category")
        if cat:
            qs = qs.filter(category__iexact=cat)
        merch = self.request.query_params.get("merchant")
        if merch:
            qs = qs.filter(merchant__icontains=merch)
        return qs.order_by("-created_at")

class ReceiptDetailView(generics.RetrieveAPIView):
    serializer_class = ReceiptSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Receipt.objects.filter(user=self.request.user)


class AnalyticsSpendView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        qs = Receipt.objects.filter(user=request.user)
        month = request.query_params.get("month")
        category = request.query_params.get("category")

        year_val = month_val = None
        if month:
            try:
                parts = month.replace("/", "-").split("-")
                if len(parts) >= 2:
                    year_val = int(parts[0]); month_val = int(parts[1])
                    qs = qs.filter(year=year_val, month=month_val)
            except Exception:
                pass
        if category:
            qs = qs.filter(category__iexact=category)

        # Aggregates
        agg = qs.aggregate(total=Sum("total"))
        total_sum = agg.get("total") or 0

        by_category = (
            qs.values("category")
              .annotate(total=Sum("total"))
              .order_by("-total")
        )
        top_merchants = list(
            qs.values("merchant")
              .annotate(total=Sum("total"))
              .order_by("-total")[:5]
        )

        # Daily series (based on date_str if present, else created_at date)
        daily_map = {}
        for r in qs.only("date_str", "created_at", "total"):
            d = (r.date_str or "").strip()
            if not d:
                d = r.created_at.date().isoformat()
            # constrain to selected month if provided
            if year_val and month_val:
                try:
                    y, m, *_ = [int(x) for x in d.replace("/", "-").split("-")]
                    if y != year_val or m != month_val:
                        continue
                except Exception:
                    pass
            daily_map.setdefault(d, 0)
            daily_map[d] += float(r.total)

        daily = [
            {"date": k, "total": round(v, 2)}
            for k, v in sorted(daily_map.items())
        ]

        return Response({
            "month": f"{year_val:04d}-{month_val:02d}" if (year_val and month_val) else None,
            "category": category or None,
            "total": str(total_sum),
            "by_category": [
                {"category": (row.get("category") or ""), "total": str(row.get("total") or 0)}
                for row in by_category
            ],
            "top_merchants": [
                {"merchant": (row.get("merchant") or ""), "total": str(row.get("total") or 0)}
                for row in top_merchants
            ],
            "daily": daily,
        })
    
    
    
    # DEV-ONLY: mint an EdDSA JWT and auto-register the device pub; returns token + keys
from .serializers import DevMintTokenSerializer, DevWrapDekSerializer
from .crypto_utils import b64url_encode, load_server_rsa_pub_pem

class DevMintTokenView(APIView):
    """
    DEV-ONLY (staff): generate a fresh Ed25519 keypair, register DeviceKey for current user,
    and mint a short-lived JWT signed with the private key. Returns token and both keys.
    """
    permission_classes = [permissions.IsAdminUser]


    def post(self, request):
        if not getattr(settings, "ALLOW_DEV_ENDPOINTS", True):
            return Response({"code": "not_found", "detail": "Not found"}, status=404)
        s = DevMintTokenSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        device_id = s.validated_data["device_id"]
        scope = s.validated_data["scope"]
        ttl = s.validated_data["ttl_seconds"]
        targets = s.validated_data.get("targets") or []

        # 1) generate keypair
        sk = signing.SigningKey.generate()
        vk = sk.verify_key
        device_pub_b64 = vk.encode(encoder=Base64Encoder).decode()

        # 2) upsert DeviceKey row (pubkey)
        DeviceKey.objects.update_or_create(
            user=request.user,
            device_id=device_id,
            defaults={"public_key_b64": device_pub_b64, "is_active": True},
        )

        # 3) mint JWT (EdDSA)
        now = datetime.datetime.now(datetime.timezone.utc)
        iat = int(now.timestamp())
        nbf = iat - 5
        exp = iat + int(ttl)
        jti = base64.urlsafe_b64encode(secrets.token_bytes(16)).decode().rstrip("=")

        header = {"alg": "EdDSA", "typ": "JWT", "kid": device_id}
        payload = {
            "iss": "financekit-dev",
            "sub": str(request.user.id),
            "scope": scope,
            "jti": jti,
            "iat": iat,
            "nbf": nbf,
            "exp": exp,
        }
        if targets:
            payload["targets"] = targets

        header_b64 = b64url_encode(json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode())
        payload_b64 = b64url_encode(json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode())
        signing_input = f"{header_b64}.{payload_b64}".encode()
        sig = sk.sign(signing_input).signature
        sig_b64 = b64url_encode(sig)
        token = f"{header_b64}.{payload_b64}.{sig_b64}"

        # return token + keys (private key is DEV ONLY)
        return Response({
            "device_id": device_id,
            "device_pub_b64": device_pub_b64,
            "device_priv_b64": sk.encode(encoder=Base64Encoder).decode(),  # DEV ONLY
            "ttl_seconds": ttl,
            "token": token,
            "scope": scope,
            "jti": jti,
            "nbf": nbf,
            "exp": exp,
        })
        

class DevWrapDekView(APIView):
    """
    DEV-ONLY (staff): generate a random 32-byte DEK, wrap with server RSA-OAEP-SHA256,
    and return both the wrapped blob and the plaintext DEK (for demo). NEVER do this in prod.
    """
    permission_classes = [permissions.IsAdminUser]


    def post(self, request):
        if not getattr(settings, "ALLOW_DEV_ENDPOINTS", True):
            return Response({"code": "not_found", "detail": "Not found"}, status=404)
        _ = DevWrapDekSerializer(data=request.data)
        _.is_valid(raise_exception=True)

        # random 32-byte DEK
        dek = secrets.token_bytes(32)

        # load server RSA public key and wrap (OAEP-SHA256)
        pem = load_server_rsa_pub_pem()
        pub = serialization.load_pem_public_key(pem.encode())
        wrapped = pub.encrypt(
            dek,
            asy_padding.OAEP(
                mgf=asy_padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None,
            ),
        )

        dek_b64 = base64.b64encode(dek).decode()
        dek_wrap_srv = base64.b64encode(wrapped).decode()

        return Response({
            "dek_b64": dek_b64,             # DEV ONLY (plaintext key back to caller)
            "dek_wrap_srv": dek_wrap_srv,   # what /ingest/ and /decrypt/ expect
            "len_bytes": len(dek),
            "alg": "RSA-OAEP-SHA256",
        })
