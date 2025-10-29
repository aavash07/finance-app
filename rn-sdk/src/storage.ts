export interface SecureStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

// Reference implementation using react-native MMKV or Keychain can be wired by the host app.
export class MemoryStore implements SecureStore {
  private m = new Map<string, string>();
  async get(key: string) { return this.m.has(key) ? this.m.get(key)! : null; }
  async set(key: string, value: string) { this.m.set(key, value); }
  async remove(key: string) { this.m.delete(key); }
}
