import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { ExpoSecureStore } from '../secureStore';
import * as base64js from 'base64-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

type AppState = {
  baseUrl: string; setBaseUrl: (s: string) => void;
  username: string; setUsername: (s: string) => void;
  password: string; setPassword: (s: string) => void;
  deviceId: string; setDeviceId: (s: string) => void;
  pubB64: string; setPubB64: (s: string) => void;
  privB64: string; setPrivB64: (s: string) => void;
  pem: string; setPem: (s: string) => void;
  registered: boolean; setRegistered: (b: boolean) => Promise<void>;
  accessToken?: string | null; refreshToken?: string | null; setTokens?: (a: string|null, r: string|null)=>Promise<void>;
  authHeaders: Record<string, string>;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
  logout: () => Promise<void>;
  setOnAuthFailure: (cb: (() => void) | null) => void;
  save: (obj: Partial<Record<'baseUrl'|'username'|'password'|'deviceId'|'pubB64'|'privB64'|'pem'|'registered', string>>) => Promise<void>;
  dekWraps: Record<string, string>;
  setReceiptDekWrap: (id: number, wrap: string) => Promise<void>;
  // Local receipts cache for offline-first UI
  receipts: Record<string, { id: number; data?: any; derived?: any; updatedAt: string }>;
  setReceiptData: (id: number, data?: any, derived?: any) => Promise<void>;
  removeReceipt: (id: number) => Promise<void>;
  // Budgets per category (monthly limits)
  budgets: Record<string, number>;
  setBudget: (category: string, amount: number | null) => Promise<void>;
  // Offline outbox for pending operations
  outboxDeletes: number[];
  queueDelete: (id: number) => Promise<void>;
  dequeueDelete: (id: number) => Promise<void>;
  hydrated: boolean; // initial secure store / async storage load complete
};

const Ctx = createContext<AppState | undefined>(undefined);
const store = new ExpoSecureStore();

function asciiToBytes(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = (str.codePointAt(i) || 0) & 0xff;
  return out;
}

function toB64Ascii(str: string): string {
  // Username:password are ASCII-safe; avoid relying on btoa/Buffer in RN
  return base64js.fromByteArray(asciiToBytes(str));
}

export function AppStateProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  // Default base URL logic:
  // - If EXPO_PUBLIC_BASE_URL is set, use it
  // - Else if EXPO_PUBLIC_USE_LOCAL=1 or in __DEV__ (no override), use localhost (10.0.2.2 on Android emulator)
  // - Else fall back to the Azure default URL
  const DEFAULT_AZURE_URL = process.env.EXPO_PUBLIC_DEFAULT_AZURE_URL || 'https://financekit-backend-byeud6e5hra6epf0.eastus-01.azurewebsites.net';
  const localUrl = Platform.OS === 'android' ? 'http://10.0.2.2:8000' : 'http://localhost:8000';
  const envBase = process.env.EXPO_PUBLIC_BASE_URL;
  const preferLocal = (process.env.EXPO_PUBLIC_USE_LOCAL === '1') || (!!__DEV__ && !envBase);
  const initialBase = envBase || (preferLocal ? localUrl : DEFAULT_AZURE_URL);
  const [baseUrl, setBaseUrl] = useState(initialBase);
  const [username, setUsername] = useState('tester');
  const [password, setPassword] = useState('pass1234');
  const [deviceId, setDeviceId] = useState('device-mobile-1');
  const [pubB64, setPubB64] = useState('');
  const [privB64, setPrivB64] = useState('');
  const [pem, setPem] = useState('');
  const [registered, setRegistered] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [dekWraps, setDekWraps] = useState<Record<string, string>>({});
  const [receipts, setReceipts] = useState<Record<string, { id: number; data?: any; derived?: any; updatedAt: string }>>({});
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [outboxDeletes, setOutboxDeletes] = useState<number[]>([]);
  const [onAuthFailure, setOnAuthFailure] = useState<(() => void) | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Load secrets and small values from SecureStore
      const [sPriv, sPub, sDev, sBase, sUser, sPass, sPem, sReg, sAccess, sRefresh] = await Promise.all([
        store.get('privB64'),
        store.get('pubB64'),
        store.get('deviceId'),
        store.get('baseUrl'),
        store.get('username'),
        store.get('password'),
        store.get('pem'),
        store.get('registered'),
        store.get('accessToken'),
        store.get('refreshToken'),
      ]);
      if (sPriv) setPrivB64(sPriv);
      if (sPub) setPubB64(sPub);
      if (sDev) setDeviceId(sDev);
      if (sBase) setBaseUrl(sBase);
      if (sUser) setUsername(sUser);
      if (sPass) setPassword(sPass);
      if (sPem) setPem(sPem);
      if (sReg) setRegistered(sReg === '1' || sReg.toLowerCase() === 'true');
      if (sAccess) setAccessToken(sAccess);
      if (sRefresh) setRefreshToken(sRefresh);

      // Fallback: if secure store didn't return tokens (e.g. after reinstall), try AsyncStorage
      if (!sAccess || !sRefresh) {
        const [aAccess, aRefresh] = await Promise.all([
          AsyncStorage.getItem('accessToken_fallback'),
          AsyncStorage.getItem('refreshToken_fallback')
        ]);
        if (!sAccess && aAccess) setAccessToken(aAccess);
        if (!sRefresh && aRefresh) setRefreshToken(aRefresh);
      }

      // Migration: move large JSON items from SecureStore -> AsyncStorage (one-time)
      const migrated = await AsyncStorage.getItem('async_migrated_v1');
      if (!migrated) {
        const [oldWraps, oldReceipts, oldBudgets] = await Promise.all([
          store.get('dekWraps'),
          store.get('receiptsCache'),
          store.get('budgets'),
        ]);
        if (oldWraps) await AsyncStorage.setItem('dekWraps', oldWraps);
        if (oldReceipts) await AsyncStorage.setItem('receiptsCache', oldReceipts);
        if (oldBudgets) await AsyncStorage.setItem('budgets', oldBudgets);
        await AsyncStorage.setItem('async_migrated_v1', '1');
        // Optionally clear old large values to reclaim secure storage space
        if (oldWraps) await store.remove('dekWraps');
        if (oldReceipts) await store.remove('receiptsCache');
        if (oldBudgets) await store.remove('budgets');
      }

      // Load large JSON blobs from AsyncStorage (user-scoped)
      const u = sUser || username;
      const [aWraps, aReceipts, aBudgets, aOutDel] = await Promise.all([
        AsyncStorage.getItem(`dekWraps:${u}`),
        AsyncStorage.getItem(`receiptsCache:${u}`),
        AsyncStorage.getItem(`budgets:${u}`),
        AsyncStorage.getItem(`outbox:deletes:${u}`),
      ]);
      if (aWraps) { try { setDekWraps(JSON.parse(aWraps)); } catch {} }
      if (aReceipts) { try { setReceipts(JSON.parse(aReceipts)); } catch {} }
      if (aBudgets) { try { setBudgets(JSON.parse(aBudgets) || {}); } catch {} }
      if (aOutDel) { try { setOutboxDeletes((JSON.parse(aOutDel) || []).map(Number).filter((n: number)=>Number.isFinite(n))); } catch {} }
      // Proactive access token refresh if expired and refresh token present
      const needsRefresh = (() => {
        if (!sAccess) return false;
        try {
          const payloadB64 = sAccess.split('.')[1];
          if (!payloadB64) return false;
          const norm = payloadB64.replaceAll('-', '+').replaceAll('_', '/');
          const pad = norm + '==='.slice((norm.length % 4));
          const bytes = base64js.toByteArray(pad);
          let json = '';
          for (const b of bytes as any) json += String.fromCodePoint(b as number);
          const parsed = JSON.parse(json);
          const exp = parsed?.exp;
          if (!exp || typeof exp !== 'number') return false;
          const nowSec = Math.floor(Date.now()/1000);
          // Refresh if already expired or will expire within 60s
          return exp <= nowSec + 60;
        } catch { return false; }
      })();
      if (needsRefresh && sRefresh) {
        try {
          const r = await fetch(`${(sBase||baseUrl).replace(/\/$/,'')}/api/v1/auth/token/refresh`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh: sRefresh })
          });
          if (r.ok) {
            const data = await r.json();
            if (data?.access) await setTokens(data.access, data.refresh || sRefresh);
          } else {
            // Invalidate tokens if refresh fails
            await setTokens(null, null);
          }
        } catch { /* ignore network errors; fallback to existing token */ }
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => { cancelled = true; };
  }, []);

  const DEBUG_NET = (process.env.EXPO_PUBLIC_DEBUG_NETWORK === '1');
  const authHeaders = useMemo(() => {
    if (accessToken) return { Authorization: `Bearer ${accessToken}` };
    return { Authorization: `Basic ${toB64Ascii(username + ':' + password)}` };
  }, [username, password, accessToken]);

  // Wrapper around fetch that injects Authorization and refreshes tokens on 401
  const fetchWithAuth = React.useCallback(async (url: string, init?: RequestInit) => {
    const headers = new Headers(init?.headers as any);
    // Only inject if not explicitly provided
    if (!headers.has('Authorization')) {
      if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
      else headers.set('Authorization', `Basic ${toB64Ascii(username + ':' + password)}`);
    }
    // Correlate with backend logs if RequestID middleware is present
    const reqId = Math.random().toString(36).slice(2);
    headers.set('X-Client-Request-ID', reqId);
    const started = Date.now();
    if (DEBUG_NET) console.log('[net] start', { url, method: (init?.method||'GET'), reqId });
    let res = await fetch(url, { ...init, headers });
    if (DEBUG_NET) console.log('[net] end', { url, status: res.status, ms: Date.now()-started, reqId });
    if (res.status !== 401 || !refreshToken) return res;
    // Attempt refresh
    try {
      const r = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/auth/token/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: refreshToken }),
      });
      if (!r.ok) {
        // Refresh failed – log out and notify
        await logout();
        return res; // give original 401 back
      }
      const data = await r.json();
      // Update tokens and retry once
      await setTokens?.(data.access, data.refresh ?? refreshToken);
      const retryHeaders = new Headers(init?.headers as any);
      retryHeaders.set('Authorization', `Bearer ${data.access}`);
      retryHeaders.set('X-Client-Request-ID', reqId + '-retry');
      res = await fetch(url, { ...init, headers: retryHeaders });
      return res;
    } catch {
      await logout();
      return res;
    }
  }, [accessToken, refreshToken, username, password, baseUrl]);

  const save = async (obj: Partial<Record<'baseUrl'|'username'|'password'|'deviceId'|'pubB64'|'privB64'|'pem'|'registered', string>>) => {
    await Promise.all(Object.entries(obj).map(([k, v]) => store.set(k, v || '')));
    if (obj.baseUrl !== undefined) setBaseUrl(obj.baseUrl);
    if (obj.username !== undefined) setUsername(obj.username);
    if (obj.password !== undefined) setPassword(obj.password);
    if (obj.deviceId !== undefined) setDeviceId(obj.deviceId);
    if (obj.pubB64 !== undefined) setPubB64(obj.pubB64);
    if (obj.privB64 !== undefined) setPrivB64(obj.privB64);
    if (obj.pem !== undefined) setPem(obj.pem);
    if (obj.registered !== undefined) setRegistered(obj.registered === '1' || obj.registered.toLowerCase() === 'true');
  };

  const setTokens = async (access: string | null, refresh: string | null) => {
    setAccessToken(access);
    setRefreshToken(refresh);
    await Promise.all([
      store.set('accessToken', access || ''),
      store.set('refreshToken', refresh || ''),
      AsyncStorage.setItem('accessToken_fallback', access || ''),
      AsyncStorage.setItem('refreshToken_fallback', refresh || ''),
    ]);
  };

  // Clear caches for the current or provided username (and legacy keys)
  const clearUserCaches = async (u?: string) => {
    const user = (u ?? username) || '__anon__';
    try {
      await AsyncStorage.multiRemove([
        `dekWraps:${user}`, `receiptsCache:${user}`, `budgets:${user}`,
        `outbox:deletes:${user}`,
        // legacy keys (pre user-scoping)
        'dekWraps', 'receiptsCache', 'budgets',
        // screen-level archived key (legacy and user-scoped)
        'archived_receipt_ids_v1', `archived_receipt_ids_v1:${user}`,
      ]);
    } catch {}
    setDekWraps({});
    setReceipts({});
    setBudgets({});
    setOutboxDeletes([]);
  };

  const logout = async () => {
    await setTokens(null, null);
    await clearUserCaches();
    await markRegistered(false);
    onAuthFailure?.();
  };

  const markRegistered = async (b: boolean) => {
    setRegistered(b);
    await store.set('registered', b ? '1' : '0');
  };

  const setReceiptDekWrap = async (id: number, wrap: string) => {
    setDekWraps(prev => {
      const next = { ...prev, [String(id)]: wrap };
      // Persist in AsyncStorage (fire and forget)
      AsyncStorage.setItem(`dekWraps:${username}`, JSON.stringify(next));
      return next;
    });
  };

  const setReceiptData = async (id: number, data?: any, derived?: any) => {
    setReceipts(prev => {
      const key = String(id);
      const next = { ...prev, [key]: { id, data, derived, updatedAt: new Date().toISOString() } };
      AsyncStorage.setItem(`receiptsCache:${username}`, JSON.stringify(next));
      return next;
    });
  };

  const setBudget = async (category: string, amount: number | null) => {
    const cat = (category || '').trim();
    if (!cat) return;
    setBudgets(prev => {
      const next = { ...prev } as Record<string, number>;
      if (amount === null || Number.isNaN(amount) || amount <= 0) {
        // remove budget if null/invalid
        if (cat in next) delete next[cat];
      } else {
        next[cat] = amount;
      }
      AsyncStorage.setItem(`budgets:${username}`, JSON.stringify(next));
      return next;
    });
  };

  const removeReceipt = async (id: number) => {
    const key = String(id);
    setReceipts(prev => {
      const next = { ...prev };
      delete next[key];
      AsyncStorage.setItem(`receiptsCache:${username}`, JSON.stringify(next));
      return next;
    });
    setDekWraps(prev => {
      const next = { ...prev };
      if (key in next) delete next[key];
      AsyncStorage.setItem(`dekWraps:${username}`, JSON.stringify(next));
      return next;
    });
  };

  const queueDelete = async (id: number) => {
    setOutboxDeletes(prev => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      AsyncStorage.setItem(`outbox:deletes:${username}`, JSON.stringify(next));
      return next;
    });
  };

  const dequeueDelete = async (id: number) => {
    setOutboxDeletes(prev => {
      const next = prev.filter(x => x !== id);
      AsyncStorage.setItem(`outbox:deletes:${username}`, JSON.stringify(next));
      return next;
    });
  };

  // If username changes via save(), clear caches for old user to prevent leakage
  const prevUsernameRef = React.useRef(username);
  useEffect(() => {
    const prev = prevUsernameRef.current;
    if (prev !== username) {
      // Clear previous user's caches
      clearUserCaches(prev);
      prevUsernameRef.current = username;
    }
  }, [username]);

  const value = useMemo<AppState>(() => ({ baseUrl, setBaseUrl, username, setUsername, password, setPassword, deviceId, setDeviceId, pubB64, setPubB64, privB64, setPrivB64, pem, setPem, registered, setRegistered: markRegistered, authHeaders, fetchWithAuth, logout, setOnAuthFailure, save, dekWraps, setReceiptDekWrap, receipts, setReceiptData, removeReceipt, budgets, setBudget, outboxDeletes, queueDelete, dequeueDelete, accessToken, refreshToken, setTokens, hydrated }), [baseUrl, username, password, deviceId, pubB64, privB64, pem, registered, authHeaders, fetchWithAuth, logout, setOnAuthFailure, dekWraps, receipts, budgets, outboxDeletes, accessToken, refreshToken, hydrated]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
