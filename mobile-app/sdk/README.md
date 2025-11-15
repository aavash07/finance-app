Internal FinanceKit SDK
========================

This directory contains the inlined version of the former `@financekit/rn-sdk` package.
Imports can continue to use the alias `@financekit/rn-sdk` (set via `tsconfig.json` paths).

Modules:
- `client.ts` API client helpers
- `crypto.ts` Ed25519 and RSA-OAEP utilities
- `storage.ts` simple in-memory secure store abstraction
- `utils.ts` encoding helpers

Edit these sources directly; no separate build step is needed.
