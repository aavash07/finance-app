import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ExpoSecureStore } from '../secureStore';
import * as base64js from 'base64-js';

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
  // Budgets per category (monthly limits)
  budgets: Record<string, number>;
  setBudget: (category: string, amount: number | null) => Promise<void>;
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
  const [baseUrl, setBaseUrl] = useState('http://10.0.2.2:8000');
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
  const [onAuthFailure, setOnAuthFailure] = useState<(() => void) | null>(null);

  useEffect(() => {
    (async () => {
      const [sPriv, sPub, sDev, sBase, sUser, sPass, sPem, sReg, sAccess, sRefresh, sWraps, sReceipts, sBudgets] = await Promise.all([
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
        store.get('dekWraps'),
        store.get('receiptsCache'),
        store.get('budgets'),
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

      if (sWraps) {
        try { setDekWraps(JSON.parse(sWraps)); } catch { /* ignore */ }
      }
      if (sReceipts) {
        try { setReceipts(JSON.parse(sReceipts)); } catch { /* ignore */ }
      }
      if (sBudgets) {
        try { setBudgets(JSON.parse(sBudgets) || {}); } catch { /* ignore */ }
      }
    })();
  }, []);

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
    let res = await fetch(url, { ...init, headers });
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
    ]);
  };

  const logout = async () => {
    await setTokens(null, null);
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
      // Persist asynchronously; fire and forget
      store.set('dekWraps', JSON.stringify(next));
      return next;
    });
  };

  const setReceiptData = async (id: number, data?: any, derived?: any) => {
    setReceipts(prev => {
      const key = String(id);
      const next = { ...prev, [key]: { id, data, derived, updatedAt: new Date().toISOString() } };
      store.set('receiptsCache', JSON.stringify(next));
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
      store.set('budgets', JSON.stringify(next));
      return next;
    });
  };

  const value = useMemo<AppState>(() => ({ baseUrl, setBaseUrl, username, setUsername, password, setPassword, deviceId, setDeviceId, pubB64, setPubB64, privB64, setPrivB64, pem, setPem, registered, setRegistered: markRegistered, authHeaders, fetchWithAuth, logout, setOnAuthFailure, save, dekWraps, setReceiptDekWrap, receipts, setReceiptData, budgets, setBudget, accessToken, refreshToken, setTokens }), [baseUrl, username, password, deviceId, pubB64, privB64, pem, registered, authHeaders, fetchWithAuth, logout, setOnAuthFailure, dekWraps, receipts, budgets, accessToken, refreshToken]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppState must be used within AppStateProvider');
  return ctx;
}
