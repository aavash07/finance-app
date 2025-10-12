# devtools/test_ingest_rest.py
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

# pick any image you have; relative to repo root is fine
DEFAULT_IMAGE = os.environ.get("RECEIPT_IMG", "Data/16.jpg")

# year/month/category for the record
YEAR = int(os.environ.get("RECEIPT_YEAR", "2025"))
MONTH = int(os.environ.get("RECEIPT_MONTH", "10"))
CATEGORY = os.environ.get("RECEIPT_CATEGORY", "Food")

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
    # Your DRF is using IsAuthenticated; HTTP Basic works in dev
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

def ingest_image(sess: requests.Session, token: str, dek_wrap_srv: str, img_path: str):
    url = f"{BASE}/api/v1/ingest/receipt"
    with open(img_path, "rb") as f:
        files = {
            "image": (Path(img_path).name, f, "image/jpeg"),
        }
        data = {
            "token": token,
            "dek_wrap_srv": dek_wrap_srv,
            "year": str(YEAR),
            "month": str(MONTH),
            "category": CATEGORY,
        }
        r = sess.post(url, data=data, files=files, auth=get_auth())
    print(f"[*] Uploading image to /api/v1/ingest/receipt ...\n→ {r.status_code} {url}")
    print("Headers:", r.headers)
    print("Body:", r.text)
    r.raise_for_status()
    return r.json()

# ---- main ----------------------------------------------------------------

def main():
    img = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_IMAGE
    if not Path(img).exists():
        print(f"Image not found: {img}")
        sys.exit(1)

    sess = requests.Session()

    # persistent Ed25519 (for JWT) & DEK
    sk_b64, pk_b64 = load_or_make_ed25519()
    dek = load_or_make_dek()

    # 1) register device
    device_register(sess, pk_b64)

    # 2) fetch server RSA pubkey
    server_pub = fetch_server_pubkey(sess)

    # 3) build JWT for ingest
    sk = signing.SigningKey(sk_b64, encoder=Base64Encoder)
    token = make_eddsa_jwt(sk, DEVICE_ID, scope=["receipt:ingest"])

    # 4) wrap DEK for server
    dek_wrap_srv = wrap_dek_for_server(server_pub["pem"], dek)

    # 5) call ingest
    res = ingest_image(sess, token, dek_wrap_srv, img)
    print()
    print(json.dumps(res, indent=2))

if __name__ == "__main__":
    main()
