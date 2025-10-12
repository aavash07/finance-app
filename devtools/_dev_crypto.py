# devtools/_dev_crypto.py
from pathlib import Path
import os
from nacl import signing
from nacl.encoding import Base64Encoder

DEV_STATE_DIR = Path(__file__).parent / ".dev_state"
DEV_STATE_DIR.mkdir(parents=True, exist_ok=True)

DEK_PATH = DEV_STATE_DIR / "dek.bin"                # 32 bytes for AES-256
ED25519_PRIV_PATH = DEV_STATE_DIR / "ed25519_priv.b64"
ED25519_PUB_PATH = DEV_STATE_DIR / "ed25519_pub.b64"

# use the same device id everywhere; it becomes JWT "kid"
DEVICE_ID = "ios-dev-001"

def load_or_make_dek() -> bytes:
    if DEK_PATH.exists():
        return DEK_PATH.read_bytes()
    key = os.urandom(32)
    DEK_PATH.write_bytes(key)
    return key

def load_or_make_ed25519() -> tuple[str, str]:
    """
    Returns (signing_key_b64, verify_key_b64), both Base64 (NOT urlsafe).
    """
    if ED25519_PRIV_PATH.exists() and ED25519_PUB_PATH.exists():
        return ED25519_PRIV_PATH.read_text().strip(), ED25519_PUB_PATH.read_text().strip()

    sk = signing.SigningKey.generate()
    pk = sk.verify_key
    sk_b64 = sk.encode(encoder=Base64Encoder).decode()
    pk_b64 = pk.encode(encoder=Base64Encoder).decode()
    ED25519_PRIV_PATH.write_text(sk_b64)
    ED25519_PUB_PATH.write_text(pk_b64)
    return sk_b64, pk_b64
