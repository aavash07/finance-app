# FinanceKit Backend (Django REST)

This backend powers a privacy-first finance app. Receipts are OCR'd on ingest and stored encrypted in the server DB. The user's Data Encryption Key (DEK) never leaves the device unwrapped; the server only receives a short-lived, time-bound grant (EdDSA JWT) and an RSA-OAEP wrapped DEK to decrypt/process data in-memory.

## Architecture

- Device keys: Each device has an Ed25519 keypair. The verify key (public) is registered per user/device. Short-lived JWTs (alg=EdDSA) are minted by the device to authorize specific actions and scopes.
- Server keys: Server holds an RSA private key. Clients fetch the server RSA public key to wrap their DEK using RSA-OAEP-SHA256.
- DEK: A per-user (or per-device) symmetric key (16/24/32 bytes) used with AES-GCM to encrypt receipt JSON. Only wrapped DEKs are transmitted to the server. Server unwraps in-memory per request, zeroizes after use.
- JTI replay protection: Each JWT contains a jti used once. Redis is preferred for TTL-based single-use, with a DB fallback.
- OCR: Pytesseract via a minimal pipeline to extract text and normalize to a basic schema, then encrypted and stored.

## Endpoints (prefixed with `/api/v1`)

- `GET /crypto/server-public-key` (auth): Return server RSA public key PEM.
- `POST /device/register` (auth): Register/rotate device Ed25519 verify key for the authenticated user.
- `POST /ingest/receipt` (auth): Form-data with image + token (EdDSA) + RSA-OAEP wrapped DEK. Server OCRs, encrypts with DEK, stores. JTI is single-use.
- `POST /decrypt/process` (auth): JSON with token + RSA-OAEP wrapped DEK + targets. Server unwraps DEK, decrypts receipts, runs processing, returns plaintext JSON in response. JTI is single-use.
- Dev helpers (staff only): `POST /dev/mint-token`, `POST /dev/wrap-dek`, `POST /dev/create-receipt`.

## Local setup

1) Prereqs
- Python 3.12+
- PostgreSQL 15 (or update settings to SQLite for quick try)
- Redis 7 (optional, recommended)
- Tesseract OCR installed and on PATH. On Windows, install Tesseract and optionally set `TESSERACT_CMD` env var.

2) Install deps

```powershell
python -m venv .venv ; .\.venv\Scripts\Activate.ps1 ; pip install -r requirements.txt
```

3) Create RSA keys and .env

Place your RSA keys under `secrets/` and reference them in `.env`:

```
SERVER_RSA_PRIV_PATH=secrets/server_rsa_priv.pem
SERVER_RSA_PUB_PATH=secrets/server_rsa_pub.pem
DEBUG=1
SECRET_KEY=dev
DB_HOST=localhost
DB_NAME=capstone
DB_USER=capstone
DB_PASSWORD=capstone
DB_PORT=5432
REDIS_URL=redis://127.0.0.1:6379/0
```

A starter file is provided: `.env.example`.

4) DB and migrations

```powershell
python manage.py migrate
python manage.py createsuperuser
```

5) Optional services via Docker

```powershell
make db-up
```

6) Run server

```powershell
python manage.py runserver 0.0.0.0:8000
```

## Quick dev flow

- Register device pubkey: `POST /api/v1/device/register` (Basic auth in dev)
- Fetch server RSA pubkey: `GET /api/v1/crypto/server-public-key`
- Mint short-lived EdDSA JWT on device (scope `receipt:ingest` or `receipt:decrypt`)
- Wrap DEK with server pubkey (RSA-OAEP-SHA256)
- Ingest: upload image to `/ingest/receipt`
- Decrypt/process: call `/decrypt/process` with previous JWT+wrap

Use the VS Code REST file at `api_collection/requests.http` or devtools scripts under `devtools/`.

## React Native integration (high-level)

- Key storage: Store Ed25519 signing key and DEK in secure storage (e.g., react-native-keychain + platform keystore). Do not sync in plaintext.
- JWT minting: Use `tweetnacl` or `react-native-nacl` to sign JWT header.payload (urlbase64) with Ed25519 private key. `kid` = device_id.
- DEK wrapping: Call backend `GET /crypto/server-public-key`, load PEM, perform RSA-OAEP-SHA256 wrapping. On RN, use a native crypto lib or call a lightweight cloud function to wrap if needed. Alternatively, pre-wrap on a small device-native module.
- Upload flow: FormData with image, token, dek_wrap_srv, metadata. Handle 409 for replay (regenerate jti and retry once).
- Decrypt flow: Same token+wrap pattern, the server returns plaintext JSON for processing or to hydrate UI.

## Security notes

- JWT lifetimes should be short (<= 5 minutes). Device clocks can drift; set nbf with small negative skew.
- Enforce scopes server-side; optionally assert targets embedded in JWT.
- Zeroize sensitive material where possible; keep keys out of logs.
- Prefer Redis for JTI single-use with TTL.

## Tests

Minimal tests are under `financekit/tests/`. Example e2e test asserts single-use JTI behavior.

## Troubleshooting

- Missing Python deps in editor warnings are expected until your venv is active in VS Code.
- On Windows, ensure Tesseract is installed and `pytesseract` can find it. Set env `TESSERACT_CMD` if needed.
- If using SQLite for quick try, update `DATABASES` in `settings.py` accordingly.

### Cleaning generated files

On Windows, you can purge caches and build artifacts with:

```
powershell -ExecutionPolicy Bypass -File scripts/clean.ps1
```

Add `-Deep` to also clear Python caches.

### Updating the local rn-sdk in the app

When you change code under `rn-sdk/`, repack and install the tarball into the app:

```
powershell -ExecutionPolicy Bypass -File scripts/sync-sdk.ps1
```

Then restart Expo with a clean cache:

```
cd mobile-app
npx expo start -c
```
