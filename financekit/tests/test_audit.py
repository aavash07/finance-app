import json, time, uuid, base64, os
from django.test import TestCase
from django.contrib.auth.models import User
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding as asy_padding
from nacl.signing import SigningKey
from nacl.encoding import Base64Encoder
from financekit.models import DeviceKey, Receipt, AuditEvent


def b64(b): return base64.b64encode(b).decode()

def b64url(b): import base64 as b64m; return b64m.urlsafe_b64encode(b).decode().rstrip("=")


class AuditTests(TestCase):
    def setUp(self):
        self.u = User.objects.create_user("auditor", password="pass1234")
        self.client.login(username="auditor", password="pass1234")
        from django.conf import settings
        with open(settings.SERVER_RSA_PUB_PATH, "rb") as f:
            self.pub = serialization.load_pem_public_key(f.read())
        self.sk = SigningKey.generate()
        vk_b64 = self.sk.verify_key.encode(encoder=Base64Encoder).decode()
        DeviceKey.objects.create(user=self.u, device_id="dev-audit", public_key_b64=vk_b64)

    def _insert_receipt(self):
        pt = json.dumps({"merchant":"Audit Coffee","total":1.23}).encode()
        self.dek = os.urandom(32)
        nonce = os.urandom(12)
        ct_tag = AESGCM(self.dek).encrypt(nonce, pt, b"receipt_v1")
        ct, tag = ct_tag[:-16], ct_tag[-16:]
        r = Receipt.objects.create(
            user=self.u, year=2025, month=10, category="Food",
            body_nonce=base64.b64decode(b64(nonce)),
            body_ct=base64.b64decode(b64(ct)),
            body_tag=base64.b64decode(b64(tag)),
        )
        return r.id

    def _wrap(self):
        return base64.b64encode(self.pub.encrypt(
            self.dek,
            asy_padding.OAEP(
                mgf=asy_padding.MGF1(algorithm=hashes.SHA256()),
                algorithm=hashes.SHA256(),
                label=None
            )
        )).decode()

    def _jwt(self, rid, ttl=120):
        now = int(time.time())
        h = {"alg":"EdDSA","typ":"JWT","kid":"dev-audit"}
        p = {"sub":str(self.u.id),"scope":["receipt:decrypt"],"targets":[rid],"iat":now,"nbf":now-5,"exp":now+ttl,"jti":str(uuid.uuid4())}
        H = b64url(json.dumps(h,separators=(",",":")).encode())
        P = b64url(json.dumps(p,separators=(",",":")).encode())
        S = self.sk.sign((H+"."+P).encode()).signature
        return f"{H}.{P}.{b64url(S)}"

    def test_audit_success_and_replay(self):
        rid = self._insert_receipt()
        dek_wrap = self._wrap()
        token = self._jwt(rid)
        body = {"token": token, "dek_wrap_srv": dek_wrap, "targets": [rid]}

        r1 = self.client.post("/api/v1/decrypt/process", data=json.dumps(body), content_type="application/json")
        self.assertEqual(r1.status_code, 200, r1.content)
        self.assertTrue(AuditEvent.objects.filter(endpoint="decrypt/process", outcome="success", user=self.u).exists())

        r2 = self.client.post("/api/v1/decrypt/process", data=json.dumps(body), content_type="application/json")
        self.assertEqual(r2.status_code, 409, r2.content)
        self.assertTrue(AuditEvent.objects.filter(endpoint="decrypt/process", outcome="replay", user=self.u).exists())
