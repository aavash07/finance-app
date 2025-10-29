import * as SecureStore from 'expo-secure-store';
import type { SecureStore as ISecureStore } from '@financekit/rn-sdk';

export class ExpoSecureStore implements ISecureStore {
  async get(key: string): Promise<string | null> {
    try { return await SecureStore.getItemAsync(key); } catch { return null; }
  }
  async set(key: string, value: string): Promise<void> {
    try { await SecureStore.setItemAsync(key, value, { keychainService: 'financekit' }); } catch {}
  }
  async remove(key: string): Promise<void> {
    try { await SecureStore.deleteItemAsync(key, { keychainService: 'financekit' }); } catch {}
  }
}
