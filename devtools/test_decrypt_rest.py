# devtools/test_decrypt_rest.py
import base64, datetime, json, os, sys
from pathlib import Path

import requests
from requests.auth import HTTPBasicAuth

from nacl import signing
from nacl.encoding import Base64Encoder

from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding as asy_padding

from devtools._dev_crypto import load_or_make_dek, load_or_make_ed25519, DEVICE_ID

# ---- CONFIG ---------------------------------------------------------------

BASE = os.environ.get("BASE_URL", "http://127.0.0.1:8000")
ADMIN_USER = os.environ.get("ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("ADMIN_PASS", "test123")

# If you pass a receipt id as argv[1], we’ll use that; otherwise we’ll fetch latest.
RECEIPT_ID_ARG = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else None

# ---- helpers --------------------------------------------------------------

def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")

def make_eddsa_jwt(sk: signing.SigningKey, kid: str, scope: list[str]) -> str:
    # timezone-aware UTC to avoid deprecation + add small skew for safety
    now = datetime.datetime.now(datetime.timezone.utc)
    skew_s = 60  # allow 60s of clock skew
    payload = {
        "iss": "devtool",
        "sub": ADMIN_USER,
        "scope": scope,
        "iat": int(now.timestamp()),
        "nbf": int((now - datetime.timedelta(seconds=skew_s)).timestamp()),
        "exp": int((now + datetime.timedelta(minutes=5)).timestamp()),
        "jti": os.urandom(16).hex(),
    }
    header = {"alg": "EdDSA", "typ": "JWT", "kid": kid}
    hdr_b64 = b64u(json.dumps(header, separators=(",", ":")).encode())
    pld_b64 = b64u(json.dumps(payload, separators=(",", ":")).encode())
    sig = sk.sign(f"{hdr_b64}.{pld_b64}".encode()).signature
    return f"{hdr_b64}.{pld_b64}.{b64u(sig)}"


def get_auth():
    return HTTPBasicAuth(ADMIN_USER, ADMIN_PASS)

def device_register(sess: requests.Session, verify_pub_b64: str):
    url = f"{BASE}/api/v1/device/register"
    data = {"device_id": DEVICE_ID, "public_key_b64": verify_pub_b64}
    r = sess.post(url, json=data, auth=get_auth())
    print(f"[*] Registering device ...\n→ {r.status_code} {url}\n{r.text}")
    r.raise_for_status()

def fetch_server_pubkey(sess: requests.Session) -> dict:
    url = f"{BASE}/api/v1/crypto/server-public-key"
    r = sess.get(url, auth=get_auth())
    print(f"[*] Fetching server pubkey ...\n→ {r.status_code} {url}\n{r.text}")
    r.raise_for_status()
    return r.json()

def wrap_dek_for_server(server_pub_pem: str, dek: bytes) -> str:
    pub = serialization.load_pem_public_key(server_pub_pem.encode())
    wrapped = pub.encrypt(
        dek,
        asy_padding.OAEP(
            mgf=asy_padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    return base64.b64encode(wrapped).decode()

def latest_receipt_id(sess: requests.Session) -> int | None:
    # Your ReceiptListView is open (AllowAny) and sorted newest-first
    url = f"{BASE}/api/v1/receipts"
    r = sess.get(url)  # no auth needed per your view
    print(f"[*] Fetching latest receipt list ...\n→ {r.status_code} {url}")
    if r.status_code != 200:
        print("Could not fetch receipts:", r.text)
        return None
    data = r.json()
    if not data:
        return None
    # Expecting DRF ListAPIView default list; if you customized pagination, adjust here
    first = data[0] if isinstance(data, list) else None
    if not first:
        return None
    rid = first.get("id") or first.get("pk")
    return int(rid) if rid is not None else None

def decrypt_process(sess: requests.Session, token: str, dek_wrap_srv: str, targets: list[int]):
    url = f"{BASE}/api/v1/decrypt/process"
    body = {"token": token, "dek_wrap_srv": dek_wrap_srv, "targets": targets}
    r = sess.post(url, json=body, auth=get_auth())
    print(f"[*] Calling /api/v1/decrypt/process ...\n→ {r.status_code} {url}")
    print("Headers:", r.headers)
    print("Body:", r.text)
    r.raise_for_status()
    return r.json()

# ---- main ----------------------------------------------------------------

def main():
    sess = requests.Session()

    # persistent Ed25519 keypair & DEK (matches ingest)
    sk_b64, pk_b64 = load_or_make_ed25519()
    dek = load_or_make_dek()

    # 1) register device (idempotent)
    device_register(sess, pk_b64)

    # 2) fetch server pubkey
    server_pub = fetch_server_pubkey(sess)

    # 3) build JWT for decrypt
    sk = signing.SigningKey(sk_b64, encoder=Base64Encoder)
    token = make_eddsa_jwt(sk, DEVICE_ID, scope=["receipt:decrypt"])

    # 4) wrap DEK for server
    dek_wrap_srv = wrap_dek_for_server(server_pub["pem"], dek)

    # 5) pick target id
    rid = RECEIPT_ID_ARG or latest_receipt_id(sess)
    if not rid:
        print("No receipt found. Run the ingest script first.")
        sys.exit(2)

    # 6) call decrypt/process
    res = decrypt_process(sess, token, dek_wrap_srv, targets=[rid])
    print()
    print(json.dumps(res, indent=2))

if __name__ == "__main__":
    main()
