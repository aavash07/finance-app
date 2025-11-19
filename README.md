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
- Tesseract OCR (system binary) + language data (at least English). The Python package `pytesseract` is only a wrapper; you MUST install the native engine (see "OCR Prerequisites" below).

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

## OCR Prerequisites

The ingest pipeline uses `pytesseract` which calls the native Tesseract binary. If the binary or its language data is missing, OCR returns an empty string and receipts will show `Unknown` merchant and `USD 0` total.

Install Tesseract for your environment BEFORE testing ingest:

Windows:
1. Download installer: https://github.com/UB-Mannheim/tesseract/wiki (choose the latest release).
2. Run installer (ensure English language data selected).
3. Add install dir (e.g. `C:\Program Files\Tesseract-OCR`) to PATH, or set env var `TESSERACT_CMD` to the full path of `tesseract.exe`.
4. Restart shell / IDE.

macOS (Homebrew):
```bash
brew install tesseract
```

Ubuntu / Debian:
```bash
sudo apt update
sudo apt install -y tesseract-ocr libtesseract-dev libgl1 libglib2.0-0
```

Alpine (if building a custom image):
```bash
apk add --no-cache tesseract-ocr tesseract-ocr-data-eng
```

Docker (recommended for Azure or reproducible deploys):
```Dockerfile
WORKDIR /app
COPY requirements.txt ./
RUN pip install --upgrade pip && pip install --no-cache-dir -r requirements.txt
Verification (run after install):
```bash
which tesseract
tesseract --version

Environment override (if binary not on PATH):
```bash
export TESSERACT_CMD=/usr/bin/tesseract
```
On Windows PowerShell:
```powershell
[Environment]::SetEnvironmentVariable('TESSERACT_CMD','C:\\Program Files\\Tesseract-OCR\\tesseract.exe','Machine')
```

## Azure Deployment Notes

If deploying to Azure App Service (Linux) without a custom container, use a startup script or `Dockerfile` (via Web App for Containers) that installs the system packages listed above. Missing Tesseract will result in all receipts ingesting with `Unknown` merchant and zero totals.

Example App Service startup command (Enable SSH / Bash first):
```bash
apt-get update && apt-get install -y tesseract-ocr libtesseract-dev libgl1 libglib2.0-0
```
For production, prefer a custom container image so dependencies are versioned and reproducible.

Health check: enhance `/api/v1/health` or create a management command to log `pytesseract.get_tesseract_version()` at startup for observability.
The `/api/v1/health` endpoint now returns `tesseract_path`, `tesseract_version`, and `ocr_ready` for quick diagnostics.

## Quick dev flow

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

## WSL (Ubuntu) setup

Running the backend inside WSL is recommended on Windows. Here’s a quick path:

1) Prereqs inside WSL
- Python 3.11 or 3.12 (recommended)
- pip and venv: `sudo apt update && sudo apt install -y python3-venv python3-pip`
- Docker Desktop for Windows with WSL integration enabled (for Postgres/Redis via Docker Compose)

```bash

This launches Postgres on 5432 and Redis on 6379. The defaults in `.env` and `settings.py` already point to these.

3) Create venv and install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

4) Env and migrations

Create `.env` (copy from `.env.example`) and ensure DB_ vars match docker-compose values. Then:

```

5) Run the server

```bash
python manage.py runserver 0.0.0.0:8000
```

From Windows, you can hit it at `http://localhost:8000`. From the Android emulator in Expo, use `http://10.0.2.2:8000`. The mobile app now defaults to the Azure backend URL unless you set `EXPO_PUBLIC_USE_LOCAL=1` (or provide an explicit `EXPO_PUBLIC_BASE_URL`).

Note: If you prefer SQLite for quick experiments, set `DB_ENGINE=sqlite` in `.env` (not recommended for Postgres features, but handy for fast local runs). No changes are needed when using Docker Postgres in WSL.

### Makefile shortcuts (WSL)

Common tasks via `make`:

```bash
# Start/stop services
make db-up
make db-down

# One-time setup
make install      # creates .venv and installs requirements
make migrate      # apply migrations
make superuser    # create admin user

# Dev loop
make run          # runserver 0.0.0.0:8000
make test         # run tests
```

## Android CI Build (EAS + GitHub Actions)

This section documents how to produce a signed Android preview APK automatically via GitHub Actions using Expo Application Services (EAS).

### 1. Prerequisites

| Item | Why |
|------|-----|
| Expo project linked (`eas init`) | Associates the project with your Expo account so builds work in CI. |
| Programmatic access token | Non‑interactive auth; create in Expo Dashboard → Account → Access Tokens. |
| GitHub Actions workflow | Automates build, artifact upload, optional release publishing. |
| Android keystore (JKS) | Required for signing when using local credentials. |

Ensure `eas.json` contains a build profile (e.g. `preview`) and (for local credentials) sets:

```jsonc
// mobile-app/eas.json (excerpt)
"preview": {
	"android": {
		"buildType": "apk",
		"credentialsSource": "local"
	},
	"env": { "EXPO_PUBLIC_BASE_URL": "https://your-backend" }
}
```

If you omit `credentialsSource`, Expo can manage credentials remotely (see Remote Credentials below).

### 2. Secrets (GitHub → Settings → Secrets and variables → Actions)

Create these repository secrets:

| Secret Name | Value |
|-------------|-------|
| `EXPO_TOKEN` | Programmatic access token from Expo dashboard |
| `ANDROID_KEYSTORE_BASE64` | Base64 of your keystore file (.jks) |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore (store) password |
| `ANDROID_KEY_PASSWORD` | Key (alias) password (often same) |
| `ANDROID_KEYSTORE_ALIAS` | Alias used when generating the key |

The workflow exports them as environment variables with the names EAS expects:

| Workflow Env | Source Secret |
|--------------|---------------|
| `EAS_ACCESS_TOKEN` / `EXPO_TOKEN` | `EXPO_TOKEN` |
| `EAS_BUILD_ANDROID_KEYSTORE_BASE64` | `ANDROID_KEYSTORE_BASE64` |
| `EAS_BUILD_ANDROID_KEYSTORE_PASSWORD` | `ANDROID_KEYSTORE_PASSWORD` |
| `EAS_BUILD_ANDROID_KEY_PASSWORD` | `ANDROID_KEY_PASSWORD` |
| `EAS_BUILD_ANDROID_KEYSTORE_ALIAS` | `ANDROID_KEYSTORE_ALIAS` |

### 3. Generate a Keystore (local credentials path)

Windows (PowerShell):
```powershell
$alias = "financekitmobile"
$password = "CHOOSE_STRONG_PASSWORD"
& "$env:JAVA_HOME\bin\keytool.exe" -genkeypair `
	-v -keystore financekit-mobile.keystore `
	-alias $alias -keyalg RSA -keysize 2048 -validity 10000 `
	-storepass $password -keypass $password `
	-dname "CN=FinanceKit,O=FinanceKit,L=City,S=State,C=US"
```

macOS / Linux:
```bash
alias=financekitmobile
password=CHOOSE_STRONG_PASSWORD
keytool -genkeypair -v \
	-keystore financekit-mobile.keystore \
	-alias "$alias" -keyalg RSA -keysize 2048 -validity 10000 \
	-storepass "$password" -keypass "$password" \
	-dname "CN=FinanceKit,O=FinanceKit,L=City,S=State,C=US"
```

Base64 encode for secret:
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("financekit-mobile.keystore")) | Set-Content -NoNewline android.keystore.b64
```
```bash
base64 -w0 financekit-mobile.keystore > android.keystore.b64  # Linux
base64 financekit-mobile.keystore > android.keystore.b64      # macOS
```
Copy the file contents into `ANDROID_KEYSTORE_BASE64`.

Verify keystore locally:
```powershell
& "$env:JAVA_HOME\bin\keytool.exe" -list -v -keystore financekit-mobile.keystore -storepass $password
```

### 4. Example GitHub Actions Workflow (excerpt)

```yaml
name: Build Android APK (EAS)
on:
	workflow_dispatch:
	push:
		branches: [ main ]
jobs:
	build-apk:
		runs-on: ubuntu-latest
		env:
			EXPO_TOKEN: ${{ secrets.EXPO_TOKEN }}
			EAS_ACCESS_TOKEN: ${{ secrets.EXPO_TOKEN }}
			EAS_BUILD_ANDROID_KEYSTORE_BASE64: ${{ secrets.ANDROID_KEYSTORE_BASE64 }}
			EAS_BUILD_ANDROID_KEYSTORE_PASSWORD: ${{ secrets.ANDROID_KEYSTORE_PASSWORD }}
			EAS_BUILD_ANDROID_KEY_PASSWORD: ${{ secrets.ANDROID_KEY_PASSWORD }}
			EAS_BUILD_ANDROID_KEYSTORE_ALIAS: ${{ secrets.ANDROID_KEYSTORE_ALIAS }}
		defaults:
			run:
				working-directory: mobile-app
		steps:
			- uses: actions/checkout@v4
			- uses: actions/setup-node@v4
				with: { node-version: '20' }
			- name: Pack internal SDK
				working-directory: rn-sdk
				run: |
					npm ci
					npm run build
					tgz=$(npm pack --silent)
					cp "$tgz" ../mobile-app/
			- name: Install app deps
				run: npm ci && npm i -g eas-cli@latest
			- name: Auth
				run: |
					echo "EXPO_TOKEN=$EXPO_TOKEN" >> $GITHUB_ENV
					eas whoami
			- name: Build APK
				run: |
					for v in EAS_BUILD_ANDROID_KEYSTORE_BASE64 EAS_BUILD_ANDROID_KEYSTORE_PASSWORD EAS_BUILD_ANDROID_KEY_PASSWORD EAS_BUILD_ANDROID_KEYSTORE_ALIAS; do
						[ -z "${!v:-}" ] && echo "Missing $v" && exit 1
					done
					eas build -p android --profile preview --non-interactive --wait
			- uses: actions/upload-artifact@v4
				with:
					name: financekit-preview-apk
					path: mobile-app/dist/financekit-preview.apk
```

### 5. Internal SDK Dependency Options

Current approach uses a packed tarball: `"@financekit/rn-sdk": "file:../rn-sdk/financekit-rn-sdk-0.1.0.tgz"`.

Simpler alternative: switch to folder reference:
```json
"@financekit/rn-sdk": "file:../rn-sdk"
```
Then in CI:
```yaml
- working-directory: rn-sdk
	run: npm ci && npm run build
- run: npm install  # (NOT npm ci first time after change, to update lockfile)
```
Commit the updated `package-lock.json`. This removes the need for `npm pack`.

### 6. Remote Credentials Alternative

If you prefer Expo-managed credentials:
1. Remove `"credentialsSource": "local"` from `eas.json`.
2. Run locally (interactive): `eas build -p android --profile preview` and let Expo create/store the keystore.
3. Commit changes; CI builds no longer need the keystore secrets.

### 7. Common Errors & Fixes

| Error Message | Cause | Fix |
|---------------|-------|-----|
| `Generating a new Keystore is not supported in non-interactive mode` | Local credentials selected but keystore secrets missing | Provide all four Android secrets or switch to remote credentials |
| `An Expo user account is required to proceed` | Token not exported to build step | Ensure `EXPO_TOKEN` / `EAS_ACCESS_TOKEN` env present at job level before `eas build` |
| `ENOENT ... financekit-rn-sdk-0.1.0.tgz` | Tarball not packed/copied before `npm ci` | Add `npm pack` step or switch to folder dependency |
| Interactive prompt hangs | Missing `--non-interactive` flag | Include `--non-interactive` in CI build command |

### 8. Security Notes

- Treat `EXPO_TOKEN` and keystore secrets as sensitive; rotate if leaked.
- Do NOT commit the keystore file or its Base64 contents.
- Use unique, strong passwords; avoid sharing the same token for multiple repos with broad scopes.

### 9. Quick Verification Checklist

Before relying on CI:
1. `eas whoami` succeeds locally with token.
2. `eas build -p android --profile preview` completes (interactive if using remote credentials first time).
3. All secrets show as defined in GitHub UI.
4. Workflow run log shows keystore validation passing before build.

Once complete, download the uploaded artifact (preview APK) from the workflow run or release page and distribute for testing.

