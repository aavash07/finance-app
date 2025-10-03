import base64, json
from datetime import datetime, timezone
from django.conf import settings
from nacl.signing import VerifyKey
from nacl.encoding import Base64Encoder
from cryptography.hazmat.primitives import serialization, hashes
from cryptography.hazmat.primitives.asymmetric import padding as asy_padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from os import urandom

def b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "==" * ((4 - len(s) % 4) % 4))

def b64url_encode(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")

def load_server_rsa_priv():
    with open(settings.SERVER_RSA_PRIV_PATH, "rb") as f:
        return serialization.load_pem_private_key(f.read(), password=None)

def load_server_rsa_pub_pem() -> str:
    with open(settings.SERVER_RSA_PUB_PATH, "r") as f:
        return f.read()

def jwt_verify_eddsa(token: str, device_pubkey_b64: str) -> dict:
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
    except ValueError:
        raise ValueError("Malformed JWT")
    vk = VerifyKey(device_pubkey_b64, encoder=Base64Encoder)
    vk.verify((header_b64 + "." + payload_b64).encode(), b64url_decode(sig_b64))
    payload = json.loads(b64url_decode(payload_b64))
    now = int(datetime.now(timezone.utc).timestamp())
    if "exp" not in payload or now >= int(payload["exp"]):
        raise ValueError("JWT expired")
    if "nbf" in payload and now < int(payload["nbf"]):
        raise ValueError("JWT not yet valid")
    return payload

def unwrap_dek_rsa_oaep(b64_ciphertext: str) -> bytes:
    priv = load_server_rsa_priv()
    dek = priv.decrypt(
        base64.b64decode(b64_ciphertext),
        asy_padding.OAEP(
            mgf=asy_padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )
    if len(dek) not in (16, 24, 32):
        raise ValueError("Bad DEK length")
    return dek

def aesgcm_decrypt(key: bytes, nonce: bytes, ct: bytes, tag: bytes, aad: bytes = b""):
    aead = AESGCM(key)
    return aead.decrypt(nonce, ct + tag, aad)

def aesgcm_encrypt(key: bytes, plaintext: bytes, aad: bytes = b"") -> tuple[bytes, bytes, bytes]:
    """
    Returns (nonce, ct, tag). Tag is last 16 bytes of AEAD output.
    """
    nonce = urandom(12)
    aead = AESGCM(key)
    ct_tag = aead.encrypt(nonce, plaintext, aad)
    return nonce, ct_tag[:-16], ct_tag[-16:]
