import * as ed25519 from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import forge from 'node-forge';
import { b64, b64url, utf8ToBytes, b64ToBytes, concatBytes } from './utils';

export type Ed25519Keypair = { publicKeyB64: string; privateKeyB64: string };

export async function generateEd25519Keypair(): Promise<Ed25519Keypair> {
  const sk = ed25519.utils.randomPrivateKey();
  // Use sync APIs in React Native to avoid requiring WebCrypto subtle
  const pk = ed25519.getPublicKey(sk);
  return { publicKeyB64: b64(pk), privateKeyB64: b64(sk) };
}

export async function signEdDSA(input: Uint8Array, privateKeyB64: string): Promise<Uint8Array> {
  const sk = b64ToBytes(privateKeyB64);
  // Use sync sign to avoid WebCrypto requirement
  return ed25519.sign(input, sk);
}

// Configure noble/ed25519 to use a synchronous SHA-512 implementation
// in environments without WebCrypto (like React Native).
if (!('sha512Sync' in (ed25519 as any).etc) || !(ed25519 as any).etc.sha512Sync) {
  (ed25519 as any).etc.sha512Sync = (...msgs: Uint8Array[]) => sha512(concatBytes(...msgs));
}

export function generateDEK(bytes: number = 32): Uint8Array {
  const arr = new Uint8Array(bytes);
  // RN: ensure react-native-get-random-values is imported by app entry
  crypto.getRandomValues(arr);
  return arr;
}

export function rsaOaepWrapDek(serverPem: string, dek: Uint8Array): string {
  const publicKey = forge.pki.publicKeyFromPem(serverPem);
  // Convert Uint8Array to a raw binary string for forge
  const raw = Array.from(dek).map(b => String.fromCharCode(b)).join('');
  const encrypted: string = publicKey.encrypt(raw, 'RSA-OAEP', {
    md: forge.md.sha256.create(),
    mgf1: { md: forge.md.sha256.create() },
  });
  // encrypted is a binary string; convert to Uint8Array then base64
  const bytes = Uint8Array.from(encrypted, c => c.charCodeAt(0));
  return b64(bytes);
}

export type GrantPayload = {
  iss?: string;
  sub: string; // user id
  scope: string[];
  jti: string;
  iat: number; nbf: number; exp: number;
  targets?: number[];
};

export function mintGrantJWT(deviceId: string, privateKeyB64: string, payload: GrantPayload): Promise<string> {
  const header = { alg: 'EdDSA', typ: 'JWT', kid: deviceId };
  const H = b64url(utf8ToBytes(JSON.stringify(header)));
  const P = b64url(utf8ToBytes(JSON.stringify(payload)));
  const signingInput = utf8ToBytes(`${H}.${P}`);
  return signEdDSA(signingInput, privateKeyB64).then(sig => `${H}.${P}.${b64url(sig)}`);
}
