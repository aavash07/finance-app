import { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Simple FX hook that loads and caches currency -> USD conversion multipliers.
// Source: open.er-api.com (USD base). Cache TTL default: 6 hours.
export type FxMap = Record<string, number>;

const FX_KEY = 'fx_rates_v1';
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export function useFxRates(ttlMs: number = DEFAULT_TTL_MS) {
  const [toUSD, setToUSD] = useState<FxMap | null>(null);
  const [asOf, setAsOf] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFromCache = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(FX_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return false;
      const { toUSD: map, asOf: ts } = parsed as { toUSD?: FxMap; asOf?: number };
      if (!map || !ts) return false;
      if (Date.now() - ts > ttlMs) return false;
      setToUSD(map);
      setAsOf(ts);
      return true;
    } catch {
      return false;
    }
  }, [ttlMs]);

  const fetchRates = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('https://open.er-api.com/v6/latest/USD');
      const json = await resp.json();
      const rates = (json?.rates || {}) as Record<string, number>;
      const map: FxMap = { USD: 1 };
      for (const [cur, usdToCur] of Object.entries(rates)) {
        if (typeof usdToCur === 'number' && usdToCur > 0) map[cur] = 1 / usdToCur;
      }
      setToUSD(map);
      const ts = Date.now();
      setAsOf(ts);
      await AsyncStorage.setItem(FX_KEY, JSON.stringify({ toUSD: map, asOf: ts }));
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch FX rates');
    } finally {
      setLoading(false);
    }
  }, []);

  const ensureRates = useCallback(async () => {
    const ok = await loadFromCache();
    if (!ok) await fetchRates();
  }, [loadFromCache, fetchRates]);

  useEffect(() => { ensureRates(); }, [ensureRates]);

  const convertToUSD = useCallback((amount: number, currency?: string) => {
    const cur = (currency || 'USD').toUpperCase();
    const rate = (toUSD || { USD: 1 })[cur];
    if (!Number.isFinite(amount)) return 0;
    const conv = (typeof rate === 'number' && rate > 0) ? rate : 1;
    return amount * conv;
  }, [toUSD]);

  const formatUSD = useCallback((amount: number) => {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(amount); }
    catch { return `$${amount.toFixed(2)}`; }
  }, []);

  const info = useMemo(() => ({ toUSD, asOf, loading, error }), [toUSD, asOf, loading, error]);

  return { ...info, ensureRates, fetchRates, convertToUSD, formatUSD } as const;
}
