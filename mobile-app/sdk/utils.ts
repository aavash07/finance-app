import * as base64js from 'base64-js';

export function b64(bytes: Uint8Array): string {
  return base64js.fromByteArray(bytes);
}

export function b64ToBytes(s: string): Uint8Array {
  return base64js.toByteArray(s);
}

export function b64url(bytes: Uint8Array): string {
  const s = b64(bytes).replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return s;
}

export function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}
