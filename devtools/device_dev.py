# import base64, json, time, uuid, requests, os, secrets
# from nacl.signing import SigningKey
# from nacl.encoding import Base64Encoder
# from cryptography.hazmat.primitives.ciphers.aead import AESGCM
# from cryptography.hazmat.primitives import serialization, hashes
# from cryptography.hazmat.primitives.asymmetric import padding as asy_padding


# BASE = os.environ.get("API_BASE","http://127.0.0.1:8000/api/v1")
# USERNAME = os.environ.get("API_USER","admin")
# PASSWORD = os.environ.get("API_PASS","adminpass")
# DEVICE_ID = "ios-dev-001"

# def b64url(b: bytes) -> str: return base64.urlsafe_b64encode(b).decode().rstrip("=")
# def b64(b: bytes) -> str: return base64.b64encode(b).decode()

# s = requests.Session()
# s.auth = (USERNAME, PASSWORD)

# # 1) Create Ed25519 device keypair
# sk = SigningKey.generate()
# vk_b64 = sk.verify_key.encode(encoder=Base64Encoder).decode()

# # 2) Register device public key
# res = s.post(f"{BASE}/device/register", json={"device_id": DEVICE_ID, "public_key_b64": vk_b64})
# print("Device register response:", res.status_code, res.text)
# assert res.status_code == 200, res.text

# # 3) Fetch server RSA public key
# pub_resp = s.get(f"{BASE}/crypto/server-public-key")
# print("Server pubkey response:", pub_resp.status_code)
# assert pub_resp.status_code == 200, pub_resp.text
# pub = pub_resp.json()["pem"]
# pub_key = serialization.load_pem_public_key(pub.encode())

# # 4) Create a sample receipt and encrypt it
# receipt = {
#     "merchant":"Test Coffee","date":"2025-09-23","currency":"USD","total":7.85,
#     "items":[{"desc":"Latte","qty":1,"price":4.50},{"desc":"Muffin","qty":1,"price":3.35}]
# }
# pt = json.dumps(receipt).encode()
# dek = secrets.token_bytes(32)
# nonce = secrets.token_bytes(12)
# ct_tag = AESGCM(dek).encrypt(nonce, pt, b"receipt_v1")
# body_ct, body_tag = ct_tag[:-16], ct_tag[-16:]

# ins = s.post(f"{BASE}/dev/create-receipt", json={
#     "user_id": 1, "year": 2025, "month": 9, "category": "Food",
#     "body_nonce_b64": b64(nonce), "body_ct_b64": b64(body_ct), "body_tag_b64": b64(body_tag)
# })
# print("Dev insert response:", ins.status_code, ins.text)
# assert ins.status_code == 200, ins.text
# receipt_id = ins.json()["receipt_id"]
# print("Created receipt_id:", receipt_id)

# # 6) Wrap DEK with server RSA public key
# dek_wrap_srv = base64.b64encode(
#     pub_key.encrypt(
#         dek,
#         asy_padding.OAEP(mgf=asy_padding.MGF1(algorithm=hashes.SHA256()),
#                          algorithm=hashes.SHA256(), label=None)
#     )
# ).decode()

# # 7) Build short-lived EdDSA JWT
# header = {"alg":"EdDSA","typ":"JWT","kid":DEVICE_ID}
# now = int(time.time())
# payload = {
#     "sub":"1","device_id":DEVICE_ID,"scope":["receipt:decrypt"],
#     "targets":[receipt_id],
#     "iat":now,"nbf":now-5,"exp":now+120,
#     "jti":str(uuid.uuid4())
# }
# h_b64 = b64url(json.dumps(header,separators=(",",":")).encode())
# p_b64 = b64url(json.dumps(payload,separators=(",",":")).encode())
# sig = sk.sign((h_b64 + "." + p_b64).encode()).signature
# jwt = f"{h_b64}.{p_b64}.{b64url(sig)}"

# # 8) Call backend to process/decrypt
# res = s.post(f"{BASE}/decrypt/process", json={
#     "token": jwt, "dek_wrap_srv": dek_wrap_srv, "targets": [receipt_id]
# })
# print("Process response:", res.status_code, res.text)


# ---- in a Python REPL ----
import base64, json, time, uuid, secrets
from nacl.signing import SigningKey
from nacl.encoding import Base64Encoder
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding as asy_padding

# (1) device key (generate once then keep)
sk = SigningKey.generate()
vk_b64 = sk.verify_key.encode(encoder=Base64Encoder).decode()
print("device verify key:", vk_b64)

# Register this device once via /device/register (you can do with curl).

# (2) Fetch server pubkey PEM (copy from /crypto/server-public-key)
server_pub_pem = """-----BEGIN PUBLIC KEY-----
... paste here ...
-----END PUBLIC KEY-----"""
pub = serialization.load_pem_public_key(server_pub_pem.encode())

# (3) DEK and wrap for server
dek = secrets.token_bytes(32)
dek_wrap_srv = base64.b64encode(
    pub.encrypt(
        dek,
        asy_padding.OAEP(mgf=asy_padding.MGF1(algorithm=hashes.SHA256()),
                         algorithm=hashes.SHA256(), label=None)
    )
).decode()
print("DEK_WRAP_SRV:", dek_wrap_srv)

# (4) JWT grant (scope ingest)
def b64url(b): return base64.urlsafe_b64encode(b).decode().rstrip("=")
header = {"alg":"EdDSA","typ":"JWT","kid":"ios-dev-001"}
now = int(time.time())
payload = {
  "sub":"1","device_id":"ios-dev-001","scope":["receipt:ingest"],
  "iat":now,"nbf":now-5,"exp":now+120,"jti":str(uuid.uuid4())
}
H = b64url(json.dumps(header,separators=(",",":")).encode())
P = b64url(json.dumps(payload,separators=(",",":")).encode())
sig = sk.sign((H+"."+P).encode()).signature
jwt = f"{H}.{P}.{b64url(sig)}"
print("JWT:", jwt)
