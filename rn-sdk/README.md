# FinanceKit React Native SDK (alpha)

Helpers for device-side crypto and API calls:
- Ed25519 grants (mint short-lived JWTs)
- RSA-OAEP-SHA256 wrapping of a DEK using server public key
- Minimal API client for register/ingest/decrypt
- Pluggable secure storage interface

## Install

In your React Native app:

```sh
npm install @financekit/rn-sdk @noble/ed25519 node-forge base64-js react-native-get-random-values
```

Polyfills in your app entry (index.js/tsx):

```js
import 'react-native-get-random-values';
```

## Usage

```ts
import { FinanceKitClient, generateEd25519Keypair, mintGrantJWT, generateDEK, rsaOaepWrapDek } from '@financekit/rn-sdk';

const api = new FinanceKitClient('https://your.api');

// 1) Create device key and register
const { publicKeyB64, privateKeyB64 } = await generateEd25519Keypair();
await api.registerDevice('device-123', publicKeyB64, { Authorization: 'Basic …' });

// 2) Fetch server RSA public key
const { pem } = await api.getServerPublicKey({ Authorization: 'Basic …' });

// 3) Generate DEK (32 bytes) and wrap with server key
const dek = generateDEK(32);
const dek_wrap_srv = rsaOaepWrapDek(pem, dek);

// 4) Mint a short-lived EdDSA grant token
const now = Math.floor(Date.now() / 1000);
const payload = {
  sub: 'user-id', scope: ['receipt:ingest'],
  jti: 'random-jti', iat: now, nbf: now - 5, exp: now + 120
};
const token = await mintGrantJWT('device-123', privateKeyB64, payload);

// 5) Ingest a receipt
const formImage = { uri: 'file:///…/photo.jpg', name: 'receipt.jpg', type: 'image/jpeg' };
await api.ingestReceipt({ token, dek_wrap_srv, year: 2025, month: 10, category: 'Food', image: formImage, authHeaders: { Authorization: 'Basic …' } });
```

Notes:
- This SDK intentionally avoids bundling native storage; wire your preferred secure storage and keep `privateKeyB64` and DEK out of JS if possible.
- For production, store device private key in a secure enclave/keystore and expose only signing via a native module.
- The RSA-OAEP implementation uses node-forge and requires no native code.
