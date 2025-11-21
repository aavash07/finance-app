import React, { useMemo, useState, useLayoutEffect, useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Modal, SafeAreaView, Alert, Share, TouchableWithoutFeedback, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useAppState } from '../context/AppState';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFxRates } from '../hooks/useFxRates';

type Metric = { label: string; value: string };

function safeStr(v: unknown): string { return typeof v === 'string' ? v : ''; }
function safeNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const cleaned = v.replaceAll(',', '').replaceAll(' ', '');
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
function monthKey(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

// Robust date parsing: prefer receipt date fields, fallback to ingest (updatedAt)
function parseMaybeDate(input: unknown): Date | null {
  // Date instance
  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }
  // Numeric epoch (seconds or milliseconds)
  if (typeof input === 'number' && Number.isFinite(input)) {
    const ms = input < 1e12 ? input * 1000 : input;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  // String cases
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return null;
  // Pure digits: epoch seconds/millis or yyyymmdd
  if (/^\d+$/.test(raw)) {
    if (raw.length === 8) {
      // yyyymmdd
      const y = Number(raw.slice(0, 4));
      const mo = Number(raw.slice(4, 6));
      const da = Number(raw.slice(6, 8));
      const d = new Date(y, mo - 1, da);
      if (!Number.isNaN(d.getTime())) return d;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) {
      const ms = n < 1e12 ? n * 1000 : n;
      const d = new Date(ms);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  // Normalize space-separated ISO-like strings
  let t = raw.includes(' ') && raw.includes('-') && !raw.includes('T') ? raw.replace(' ', 'T') : raw;
  let direct = new Date(t);
  if (!Number.isNaN(direct.getTime())) return direct;
  // Try YYYY-MM-DD or YYYY/MM/DD
  let m = t.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/);
  if (m) {
    const y = Number(m[1]); const mo = Number(m[2]); const da = Number(m[3]);
    const dt = new Date(y, mo - 1, da);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  // Try MM/DD/YYYY or DD/MM/YYYY; if first > 12, treat as DD/MM
  m = t.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/);
  if (m) {
    let a = Number(m[1]); let b = Number(m[2]); const y = Number(m[3]);
    if (a > 12) { const tmp = a; a = b; b = tmp; }
    const dt = new Date(y, a - 1, b);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  return null;
}

function resolveReceiptDate(r: any): Date | null {
  const d: any = r?.data || r?.derived || {};
  const byDate = parseMaybeDate(d?.date) || parseMaybeDate(d?.date_str);
  if (byDate) return byDate;
  return parseMaybeDate((r as any)?.updatedAt);
}

type DateFilter = 'ALL' | 'L3' | 'L6' | 'YTD';

function monthStart(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d: Date, delta: number): Date { return new Date(d.getFullYear(), d.getMonth() + delta, 1); }

// Helper: human label for archived mode
type ArchivedMode = 'ALL' | 'ACTIVE' | 'ARCHIVED';
function archivedModeLabel(v: ArchivedMode): string {
  switch (v) {
    case 'ACTIVE': return 'Active Only';
    case 'ARCHIVED': return 'Archived Only';
    default: return 'All Receipts';
  }
}

// Pure filter function to keep component complexity low
function filterReceipts(baseList: any[], opts: {
  dateFilter: DateFilter;
  currencyFilter: string;
  q: string;
  minAmt: string;
  maxAmt: string;
  onlyWithItems: boolean;
  archivedMode: 'ALL' | 'ACTIVE' | 'ARCHIVED';
  archivedIds: Set<number>;
}): any[] {
  const { dateFilter, currencyFilter, q, minAmt, maxAmt, onlyWithItems, archivedMode, archivedIds } = opts;
  // Date filtering
  let minDate: Date | null = null;
  const now = new Date();
  if (dateFilter === 'L3') minDate = addMonths(monthStart(now), -2); // include current month -> 3 months span
  if (dateFilter === 'L6') minDate = addMonths(monthStart(now), -5);
  if (dateFilter === 'YTD') minDate = new Date(now.getFullYear(), 0, 1);

  const qLower = q.trim().toLowerCase();
  const minV = minAmt.trim() ? Number.parseFloat(minAmt.trim()) : Number.NaN;
  const maxV = maxAmt.trim() ? Number.parseFloat(maxAmt.trim()) : Number.NaN;

  const matches = (r: any) => {
    const d: any = r?.data || r?.derived || {};
    const dt = resolveReceiptDate(r);
    const total = safeNum(d.total);
    const itemsArr: any[] = Array.isArray(d.items) ? d.items : [];
    const merchant = safeStr(d.merchant).toLowerCase();
    const itemHit = qLower ? itemsArr.some(it => ((safeStr(it?.desc) || safeStr(it?.name)).toLowerCase().includes(qLower))) : true;

    const isDateOk = !minDate || (dt && dt >= minDate);
    const isCurrencyOk = currencyFilter === 'ALL' || safeStr(d.currency) === currencyFilter;
    const isQueryOk = !qLower || merchant.includes(qLower) || itemHit;
    const isAmtOk = (Number.isNaN(minV) || total >= minV) && (Number.isNaN(maxV) || total <= maxV);
    const isItemsOk = !onlyWithItems || itemsArr.length > 0;

    // Archived mode filtering
    let isArchiveOk = true;
    const idNum = Number(r.id);
    if (archivedMode === 'ACTIVE') isArchiveOk = !archivedIds.has(idNum);
    else if (archivedMode === 'ARCHIVED') isArchiveOk = archivedIds.has(idNum);
    return isDateOk && isCurrencyOk && isQueryOk && isAmtOk && isItemsOk && isArchiveOk;
  };
  return baseList.filter(matches);
}

function Bar({ pct, color }: Readonly<{ pct: number; color?: string }>) {
  const w = Math.max(2, Math.min(100, pct));
  return <View style={[styles.bar, { width: `${w}%`, backgroundColor: color || styles.bar.backgroundColor as any }]} />;
}

function Section({ title, children }: Readonly<React.PropsWithChildren<{ title: string }>>) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionBox}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <View style={styles.sectionContent}>{children}</View>
      </View>
    </View>
  );
}

export default function AnalyticsScreen({ navigation }: any) {
  const { receipts, budgets, setBudget, analyticsTick } = useAppState() as any;
  const baseList = useMemo(() => Object.values(receipts || {}), [receipts]);
  // Independent month filter for category aggregation
  const [categoryMonth, setCategoryMonth] = useState<string>('ALL');

  const currencies = useMemo(() => {
    const set = new Set<string>();
    for (const r of baseList) {
      const d: any = r?.data || r?.derived || {};
      const cur = safeStr(d.currency);
      if (cur) set.add(cur);
    }
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [baseList]);

  const [dateFilter, setDateFilter] = useState<DateFilter>('ALL');
  const [currencyFilter, setCurrencyFilter] = useState<string>('ALL');
  const [showCsv, setShowCsv] = useState(false);
  const [q, setQ] = useState('');
  const [minAmt, setMinAmt] = useState('');
  const [maxAmt, setMaxAmt] = useState('');
  const [onlyWithItems, setOnlyWithItems] = useState(false);
  // Archived filter: ALL (ignore), ACTIVE (exclude archived), ARCHIVED (only archived)
  const [archivedMode, setArchivedMode] = useState<ArchivedMode>('ALL');
  const [archivedIds, setArchivedIds] = useState<Set<number>>(new Set());
  const loadArchivedIds = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('archived_receipt_ids_v1');
      if (!raw) { setArchivedIds(new Set()); return; }
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) setArchivedIds(new Set(arr.map(Number).filter((n: number) => Number.isFinite(n))));
      else setArchivedIds(new Set());
    } catch { setArchivedIds(new Set()); }
  }, []);
  // Initial
  useEffect(() => { loadArchivedIds(); }, [loadArchivedIds]);
  // Refresh when the screen gains focus (captures changes from Receipts screen in same session)
  useFocusEffect(useCallback(() => { loadArchivedIds(); }, [loadArchivedIds]));

  // FX rates via shared hook
  const { toUSD: fxToUSD, ensureRates: ensureFxRates } = useFxRates();
  useEffect(() => { ensureFxRates(); }, [ensureFxRates]);
  useFocusEffect(useCallback(() => { ensureFxRates(); }, [ensureFxRates]));
  // Removed collapsible inline filters; using FAB + modal instead
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);
  // Configure notification handler (foreground behavior)
  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false })
    });
  }, []);
  // Android channel setup
  useEffect(() => {
    (async () => {
      if (Platform.OS === 'android') {
        try {
          await Notifications.setNotificationChannelAsync('budget-alerts', {
            name: 'Budget Alerts',
            importance: Notifications.AndroidImportance.HIGH,
            sound: 'default'
          });
        } catch {}
      }
    })();
  }, []);
  // Global preference moved to Account screen (context)
  const { budgetAlertsEnabled, setBudgetAlertsEnabled } = useAppState() as any;

  const filtered = useMemo(() => filterReceipts(baseList, {
    dateFilter, currencyFilter, q, minAmt, maxAmt, onlyWithItems, archivedMode, archivedIds
  }), [baseList, dateFilter, currencyFilter, q, minAmt, maxAmt, onlyWithItems, archivedMode, archivedIds, analyticsTick]);

  const { kpis, byMonth, byMerchant, byCurrency, byCategory, byCategoryBudget, csv, categoryTotalAll, categoryTotalThisMonth } = useMemo(() => {
    const totals: number[] = [];
    const months: Record<string, number> = {};
    const merchants: Record<string, number> = {};
    const currencies: Record<string, number> = {};
    // Receipt-level categories (simpler, explicit user selection)
    const categories: Record<string, number> = {};
    const categoriesBudget: Record<string, number> = {};
    const shouldConvert = currencyFilter === 'ALL';
    const toUSD = fxToUSD || { USD: 1 };
    const startMonth = monthStart(new Date());
    const nextMonth = addMonths(startMonth, 1);

    for (const r of filtered) {
      const d: any = r?.data || r?.derived || {};
      const totalRaw = safeNum(d.total);
      const cur = safeStr(d.currency) || 'USD';
      let conv = 1;
      if (shouldConvert) {
        const rate = toUSD[cur];
        if (typeof rate === 'number' && rate > 0) conv = rate;
      }
      const total = totalRaw * conv;
      const merchant = safeStr(d.merchant) || 'Unknown';
      const dt = resolveReceiptDate(r);
      const mKey = !dt || Number.isNaN(dt.getTime()) ? 'Unknown' : monthKey(dt);

      totals.push(total);
      months[mKey] = (months[mKey] || 0) + total;
      merchants[merchant] = (merchants[merchant] || 0) + total;
      // byCurrency keeps raw amounts per currency (no conversion)
      currencies[cur] = (currencies[cur] || 0) + totalRaw;

      // Use explicit receipt-level category (fallback 'Other') and apply month filter if active
      const receiptCat = (safeStr(d.category) || 'Other').trim() || 'Other';
      if (categoryMonth !== 'ALL') {
        const mkForCat = mKey; // already computed above
        if (mkForCat !== categoryMonth) continue; // skip if month doesn't match selected category month
      }
      categories[receiptCat] = (categories[receiptCat] || 0) + total;
      if (dt && dt >= startMonth && dt < nextMonth) {
        categoriesBudget[receiptCat] = (categoriesBudget[receiptCat] || 0) + total;
      }
    }

    const count = totals.length;
    const sum = totals.reduce((a, b) => a + b, 0);
    const avg = count ? sum / count : 0;

    const kpis: Metric[] = [
      { label: 'Receipts', value: String(count) },
      { label: 'Total Spend', value: sum.toFixed(2) },
      { label: 'Avg / Receipt', value: avg.toFixed(2) },
    ];

    const byMonth = Object.entries(months)
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([k, v]) => ({ key: k, value: v }));
    const byMerchant = Object.entries(merchants)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([k, v]) => ({ key: k, value: v }));
    const byCurrency = Object.entries(currencies)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ key: k, value: v }));
    const byCategory = Object.entries(categories)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ key: k, value: v }));
    const byCategoryBudget = Object.entries(categoriesBudget)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ key: k, value: v }));
    const categoryTotalAll = Object.values(categories).reduce((a,b)=>a+b,0);
    const categoryTotalThisMonth = Object.values(categoriesBudget).reduce((a,b)=>a+b,0);

    // CSV (basic): date,merchant,currency,total
    const rows = filtered.map((r: any) => {
      const d: any = r?.data || r?.derived || {};
      const dateStr = safeStr(d.date_str) || safeStr(d.date) || safeStr(r.updatedAt) || '';
      const merchant = safeStr(d.merchant).replaceAll(',', ' ');
      const cur = safeStr(d.currency);
      const total = safeNum(d.total).toFixed(2);
      return `${dateStr},${merchant},${cur},${total}`;
    });
    const csv = ['date,merchant,currency,total', ...rows].join('\n');

    return { kpis, byMonth, byMerchant, byCurrency, byCategory, byCategoryBudget, csv, categoryTotalAll, categoryTotalThisMonth };
  }, [filtered, currencyFilter, fxToUSD, categoryMonth]);

  

  const maxMonth = Math.max(1, ...byMonth.map(x => x.value));
  const maxMerchant = Math.max(1, ...byMerchant.map(x => x.value));
  const maxCategory = Math.max(1, ...byCategory.map(x => x.value));
  const maxCategoryBudget = Math.max(1, ...byCategoryBudget.map(x => x.value));
  const categoryMonthsAvailable = useMemo(() => {
    const set = new Set<string>();
    for (const r of filtered) {
      const d: any = r?.data || r?.derived || {};
      const dt = resolveReceiptDate(r);
      if (dt && !Number.isNaN(dt.getTime())) set.add(monthKey(dt));
    }
    return Array.from(set.values()).sort((a,b)=> b.localeCompare(a)); // newest first
  }, [filtered]);
  const fullCategoryList = useMemo(() => {
    const set = new Set<string>();
    for (const c of byCategory) set.add(c.key);
    for (const k of Object.keys(budgets || {})) set.add(k);
    for (const def of CATEGORY_KEYWORDS) set.add(def.key);
    return Array.from(set.values()).sort((a,b)=> a.localeCompare(b));
  }, [byCategory, budgets]);

  const overAlerts = useMemo(() => byCategoryBudget.filter(c => {
    const key = (c.key || '').trim();
    const limit = budgets?.[key];
    return typeof limit === 'number' && c.value >= limit;
  }), [byCategoryBudget, budgets]);
  // Fire a local notification (if enabled) when alerts are present
  const notifiedRef = useRef<string>('');
  const notifyLockRef = useRef<boolean>(false);
  useFocusEffect(useCallback(() => {
    const alertsSig = `${overAlerts.map(a => a.key).join('|')}|${overAlerts.length}`;
    const tryNotify = async () => {
      if (notifyLockRef.current) return;
      if (!budgetAlertsEnabled) return;
      if (!overAlerts.length) { notifiedRef.current = ''; return; }
      // Persisted cooldown (avoid duplicates across reloads)
      try {
        const now = Date.now();
        const raw = await AsyncStorage.getItem('budget_alert_last_v2');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.sig === alertsSig && typeof parsed?.ts === 'number' && (now - parsed.ts) < 6 * 60 * 60 * 1000) {
            notifiedRef.current = alertsSig;
            return; // within 6h window, skip
          }
        }
      } catch {}
      if (notifiedRef.current === alertsSig) return;
      notifyLockRef.current = true;
      try {
        // Permissions (Android 13+ & iOS)
        const perm = await Notifications.getPermissionsAsync();
        if (perm.status !== 'granted') {
          const req = await Notifications.requestPermissionsAsync();
          if (req.status !== 'granted') return;
        }
        const count = overAlerts.length;
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Budget Alert',
            body: count === 1 ? `${overAlerts[0].key} is over its budget` : `${count} categories are over budget`,
            sound: 'default',
          },
          trigger: null,
        });
        notifiedRef.current = alertsSig;
        try { await AsyncStorage.setItem('budget_alert_last_v2', JSON.stringify({ sig: alertsSig, ts: Date.now() })); } catch {}
      } catch (e) {
        // Fallback to Alert if scheduling fails
        try {
          const count = overAlerts.length;
          Alert.alert('Budget alert', count === 1 ? `${overAlerts[0].key} is over its budget` : `${count} categories are over budget`);
          notifiedRef.current = alertsSig;
          try { await AsyncStorage.setItem('budget_alert_last_v2', JSON.stringify({ sig: alertsSig, ts: Date.now() })); } catch {}
        } catch {}
      } finally { notifyLockRef.current = false; }
    };
    tryNotify();
  }, [overAlerts, budgetAlertsEnabled]));
  const [budgetEditorExpanded] = useState(true); // legacy flag (always expanded now)
  const [insightsModalOpen, setInsightsModalOpen] = useState(false);

  const fmtAmount = (n: number) => {
    try {
      const currency = currencyFilter === 'ALL' ? 'USD' : currencyFilter;
      return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n);
    } catch {
      return n.toFixed(2);
    }
  };

  // Format explicitly in a given currency (used by By Currency section)
  const fmtAmountIn = (currencyCode: string, n: number) => {
    try {
      const cur = currencyCode || (currencyFilter === 'ALL' ? 'USD' : currencyFilter);
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n);
    } catch {
      return n.toFixed(2);
    }
  };

  // Insights
  const now = new Date();
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let largestReceipt30d: { date: string; merchant: string; total: number } | null = null;
  for (const r of filtered) {
    const d: any = r?.data || r?.derived || {};
    const dt = resolveReceiptDate(r);
    if (dt && dt >= last30) {
      const cur = safeStr(d.currency) || 'USD';
      const conv = currencyFilter === 'ALL' ? ((fxToUSD || { USD: 1 })[cur] ?? 1) : 1;
      const total = safeNum(d.total) * conv;
      if (!largestReceipt30d || total > largestReceipt30d.total) {
        const iso = !Number.isNaN(dt.getTime()) ? dt.toISOString() : '';
        largestReceipt30d = { date: iso, merchant: safeStr(d.merchant), total };
      }
    }
  }

  const thisMonthStart = monthStart(now);
  const catTotalsThisMonth: Record<string, number> = {};
  for (const r of filtered) {
    const d: any = r?.data || r?.derived || {};
    const dt = resolveReceiptDate(r);
    if (dt && dt >= thisMonthStart && Array.isArray(d.items)) {
      const cur = safeStr(d.currency) || 'USD';
      const conv = currencyFilter === 'ALL' ? ((fxToUSD || { USD: 1 })[cur] ?? 1) : 1;
      for (const it of d.items) {
        const desc = safeStr(it?.desc) || safeStr(it?.name);
        const low = desc.toLowerCase();
        const isCharge = (
          low.includes('subtotal') || low.includes('total') || low.includes('tax') || low.includes('vat') || low.includes('gst') ||
          low.includes('discount') || low.includes('coupon') || low.includes('promo') || low.includes('promotion') || low.includes('savings') || low.includes('rebate') ||
          low.includes('service charge') || low.includes('gratuity') || low.includes('tip') || low.includes('delivery') || low.includes('surcharge') || low.includes('fee') ||
          low.includes('change')
        );
        if (isCharge) continue;
        const qty = safeNum(it?.qty) || 1;
        const price = safeNum(it?.price);
        const amount = Math.max(0, qty * price) * conv;
        const cat = categorize(desc);
        catTotalsThisMonth[cat] = (catTotalsThisMonth[cat] || 0) + amount;
      }
    }
  }
  const topCatThisMonth = Object.entries(catTotalsThisMonth).sort((a,b)=>b[1]-a[1])[0];

  const latestMoM = byMonth.length >= 2 ? ((byMonth[0].value - byMonth[1].value) / (byMonth[1].value || 1)) * 100 : 0;

  const onShareCsv = async () => {
    try {
      const fileUri = (FileSystem.cacheDirectory || '') + `receipts-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Share Receipts CSV', UTI: 'public.comma-separated-values-text' });
      } else {
        await Share.share({ title: 'Receipts CSV', message: csv });
      }
    } catch (e: any) {
      Alert.alert('Share failed', e?.message || 'Unknown error');
    }
  };

  // Scroll refs for header alert pill jump
  const scrollRef = useRef<ScrollView | null>(null);
  const budgetsSectionYRef = useRef<number>(0);
  // Navigation header content (filters + alert pill)
  const HeaderRight = useCallback(() => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12 }}>
      <ActiveFiltersSummary
        dateFilter={dateFilter}
        currencyFilter={currencyFilter}
        q={q}
        minAmt={minAmt}
        maxAmt={maxAmt}
        onlyWithItems={onlyWithItems}
        archivedMode={archivedMode}
        total={baseList.length}
        filtered={filtered.length}
        onOpen={() => setFiltersModalOpen(true)}
      />
      {overAlerts.length > 0 ? (
        <Pressable
          accessibilityLabel="Jump to budgets & alerts"
          onPress={() => {
            if (budgetsSectionYRef.current && scrollRef.current) {
              scrollRef.current.scrollTo({ y: Math.max(budgetsSectionYRef.current - 12, 0), animated: true });
            }
          }}
          style={[styles.pill, styles.pillActive]}
        >
          <Text style={[styles.pillText, styles.pillTextActive]}>Alerts: {overAlerts.length}</Text>
        </Pressable>
      ) : null}
    </View>
  ), [dateFilter, currencyFilter, q, minAmt, maxAmt, onlyWithItems, archivedMode, baseList.length, filtered.length, overAlerts.length]);

  useLayoutEffect(() => {
    navigation?.setOptions?.({ headerTitle: 'Analytics', headerRight: HeaderRight });
  }, [navigation, HeaderRight]);

  return (
    <View style={styles.container}>
      <ScrollView ref={scrollRef} style={styles.screen} contentContainerStyle={styles.c}>
      {/* Removed redundant inline page title and old alert pill */}
      <OverviewSection kpis={kpis} fmtAmount={fmtAmount} />

      <MonthlySpendSection byMonth={byMonth} maxMonth={maxMonth} fmtAmount={fmtAmount} />

      <TopMerchantsSection byMerchant={byMerchant} maxMerchant={maxMerchant} fmtAmount={fmtAmount} />

      <ByCurrencySection byCurrency={byCurrency} fmtAmountIn={fmtAmountIn} />

      <ByCategorySection
        byCategory={byCategory}
        maxCategory={maxCategory}
        totalAll={categoryTotalAll}
        budgets={budgets}
        fmtAmount={fmtAmount}
        months={categoryMonthsAvailable}
        activeMonth={categoryMonth}
        onSelectMonth={setCategoryMonth}
      />

      <BudgetsAndAlertsSection
        byCategory={byCategoryBudget}
        fullCategoryList={fullCategoryList}
        maxCategory={maxCategoryBudget}
        totalAll={categoryTotalThisMonth}
        budgets={budgets}
        setBudget={setBudget}
        fmtAmount={fmtAmount}
        overAlerts={overAlerts}
        budgetAlertsEnabled={budgetAlertsEnabled}
        navigation={navigation}
        setBudgetAlertsEnabled={setBudgetAlertsEnabled}
        onLayoutCapture={(y:number)=> { budgetsSectionYRef.current = y; }}
      />

      <Section title="Export">
        <Pressable onPress={() => setShowCsv(v => !v)} style={[styles.pill, styles.pillInline]}>
          <Text style={styles.pillText}>{showCsv ? 'Hide CSV' : 'Show CSV'}</Text>
        </Pressable>
        <Pressable onPress={onShareCsv} style={[styles.pill, styles.pillInline]}>
          <Text style={styles.pillText}>Share CSV</Text>
        </Pressable>
        {showCsv ? (
          <View style={styles.csvBox}>
            <Text selectable style={styles.csvText}>{csv}</Text>
          </View>
        ) : null}
      </Section>

          <Section title="Insights">
            <Pressable onPress={() => setInsightsModalOpen(true)} style={styles.collapseHeader}>
              <Text style={styles.collapseText}>View insights</Text>
            </Pressable>
          </Section>
          <InsightsModal
            visible={insightsModalOpen}
            onClose={() => setInsightsModalOpen(false)}
            largestReceipt30d={largestReceipt30d}
            topCatThisMonth={topCatThisMonth}
            latestMoM={latestMoM}
            fmtAmount={fmtAmount}
          />
      </ScrollView>
      {/* Floating Filters Action Button */}
      <Pressable accessibilityRole="button" accessibilityLabel="Open filters" onPress={() => setFiltersModalOpen(true)} style={styles.filtersFab}>
        <Ionicons name="funnel" size={22} color="#fff" />
      </Pressable>
      <FiltersModal
        visible={filtersModalOpen}
        onClose={() => setFiltersModalOpen(false)}
        currencies={currencies}
        dateFilter={dateFilter}
        setDateFilter={setDateFilter}
        currencyFilter={currencyFilter}
        setCurrencyFilter={setCurrencyFilter}
        q={q}
        setQ={setQ}
        minAmt={minAmt}
        setMinAmt={setMinAmt}
        maxAmt={maxAmt}
        setMaxAmt={setMaxAmt}
        onlyWithItems={onlyWithItems}
        setOnlyWithItems={setOnlyWithItems}
        archivedMode={archivedMode}
        setArchivedMode={setArchivedMode}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', position: 'relative' },
  screen: { backgroundColor: 'transparent' },
  c: { padding: 16 },
  t: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  activeFiltersWrap: { marginBottom: 12 },
  activeFiltersChip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#eef1f5', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20 },
  activeFiltersText: { color: '#334', fontSize: 12, fontWeight: '500' },
  activeFiltersIcon: { marginRight: 6 },
  filters: { marginBottom: 10 },
  pillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  pill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, backgroundColor: '#eef1f5' },
  pillActive: { backgroundColor: '#4f46e5' },
  pillText: { color: '#334' },
  pillTextActive: { color: '#fff', fontWeight: '600' },
  pillInline: { alignSelf: 'flex-start' },
  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  kpiCard: { flexGrow: 1, minWidth: 120, padding: 12, borderRadius: 8, backgroundColor: '#fff', elevation: 1, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  kpiLabel: { color: '#556' },
  kpiValue: { fontSize: 18, fontWeight: '700' },
  section: { marginBottom: 16 },
  sectionBox: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  sectionTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8, color: '#111827' },
  sectionContent: {},
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  rowBare: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  rowLabel: { width: 90, color: '#334' },
  rowBarWrap: { flex: 1, height: 8, backgroundColor: '#eef1f5', borderRadius: 6, overflow: 'hidden', marginHorizontal: 8 },
  rowVal: { width: 90, textAlign: 'right', fontVariant: ['tabular-nums'] as any },
  deltaUp: { color: '#166534', fontSize: 11 },
  deltaDown: { color: '#991b1b', fontSize: 11 },
  bar: { height: '100%', backgroundColor: '#4f46e5' },
  empty: { color: '#556' },
  csvBox: { marginTop: 8, padding: 10, backgroundColor: '#fff', borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb' },
  csvText: { fontFamily: 'monospace' as any, fontSize: 12 },
  input: { backgroundColor: '#fff', borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: '#cbd5e1', paddingHorizontal: 10, paddingVertical: 8, minWidth: 140 },
  inputSmall: { minWidth: 80 },
  smallNote: { color: '#556', marginBottom: 8 },
  collapseHeader: { paddingVertical: 6, marginBottom: 6 },
  collapseText: { color: '#334', fontWeight: '600' },
  alertText: { color: '#b91c1c' },
  alertsList: { marginTop: 4 },
  alertRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  alertAmt: { fontSize: 12, color: '#374151' },
  // Centered modal styles (75% height)
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalSheet: { backgroundColor: '#fff', maxHeight: '75%', width: '92%', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e7eb' },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalClose: { color: '#4f46e5', fontWeight: '600' },
  modalBody: { padding: 16 },
  filtersFab: { position: 'absolute', bottom: 28, right: 20, backgroundColor: '#4f46e5', height: 56, width: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
});

// Combined Budgets & Alerts inline section
type BudgetsAndAlertsSectionProps = {
  byCategory: { key: string; value: number }[];
  fullCategoryList: string[];
  maxCategory: number;
  totalAll: number;
  budgets: Record<string, number>;
  setBudget: (cat: string, amount: number | null) => void | Promise<void>;
  fmtAmount: (n: number) => string;
  overAlerts: { key: string; value: number }[];
  budgetAlertsEnabled: boolean;
  navigation: any;
  onLayoutCapture: (y: number) => void;
};
function BudgetsAndAlertsSection({ byCategory, fullCategoryList, maxCategory, totalAll, budgets, setBudget, fmtAmount, overAlerts, budgetAlertsEnabled, navigation, onLayoutCapture }: Readonly<BudgetsAndAlertsSectionProps>) {
  const { pushToast } = useAppState() as any;
  // Draft state for all categories
  const [drafts, setDrafts] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const k of Object.keys(budgets || {})) init[k] = String(budgets[k]);
    return init;
  });
  const [dirtySet, setDirtySet] = useState<Set<string>>(new Set());
  // Keep drafts synced if budgets change externally for untouched fields
  useEffect(() => {
    setDrafts(prev => {
      const next = { ...prev };
      for (const k of Object.keys(budgets || {})) {
        if (!dirtySet.has(k)) next[k] = String(budgets[k]);
      }
      // Remove deleted budgets if not dirty
      for (const k of Object.keys(next)) {
        if (!(k in budgets) && !dirtySet.has(k)) delete next[k];
      }
      return next;
    });
  }, [budgets, dirtySet]);

  const onChangeDraft = (cat: string, txt: string) => {
    setDrafts(d => ({ ...d, [cat]: txt }));
    setDirtySet(s => new Set([...Array.from(s), cat]));
  };
  const onClearAll = () => {
    if (!Object.keys(budgets || {}).length) return;
    Alert.alert('Clear all budgets', 'Remove all category limits?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => {
        for (const k of Object.keys(budgets || {})) setBudget(k, null);
        pushToast('All budgets cleared');
        setDrafts({});
        setDirtySet(new Set());
      } }
    ]);
  };
  const onCancelAll = () => {
    // Revert all dirty fields
    const reverted: Record<string, string> = {};
    for (const k of fullCategoryList) {
      if (k in budgets) reverted[k] = String(budgets[k]);
    }
    setDrafts(reverted);
    setDirtySet(new Set());
  };
  const onSaveAll = () => {
    let changed = 0;
    for (const cat of fullCategoryList) {
      if (!dirtySet.has(cat)) continue;
      const raw = drafts[cat]?.trim() || '';
      if (!raw) { setBudget(cat, null); changed++; continue; }
      const n = Number.parseFloat(raw);
      if (Number.isNaN(n)) { continue; }
      setBudget(cat, n); changed++;
    }
    setDirtySet(new Set());
    if (changed) pushToast('Budgets saved'); else pushToast('No changes');
  };
  // Map for quick spend lookup
  const spendMap: Record<string, number> = {};
  for (const c of byCategory) spendMap[c.key] = c.value;
  const anyDirty = dirtySet.size > 0;
  return (
    <View style={styles.section} onLayout={(e)=> onLayoutCapture(e.nativeEvent.layout.y)}>
      <View style={styles.sectionBox}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <Text style={styles.sectionTitle}>Budgets & Alerts</Text>
          <Pressable onPress={() => navigation?.navigate?.('AccountTab')} style={[styles.pill, budgetAlertsEnabled && styles.pillActive]} accessibilityLabel="Manage notification preference in Account settings">
            <Text style={[styles.pillText, budgetAlertsEnabled && styles.pillTextActive]}>{budgetAlertsEnabled ? 'Notifications: On' : 'Notifications: Off'}</Text>
          </Pressable>
        </View>
        <View style={{ marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Pressable onPress={onClearAll} disabled={!Object.keys(budgets || {}).length} style={[styles.pill, styles.pillInline, !Object.keys(budgets || {}).length && { opacity: 0.4 }]}>
              <Text style={styles.pillText}>Clear All</Text>
            </Pressable>
          </View>
          {overAlerts.length > 0 ? (
            <View style={{ marginTop: 8 }}>
              <Text style={[styles.alertText, { fontWeight: '600' }]}>Over Budget ({overAlerts.length}):</Text>
              {overAlerts.map(c => (
                <Text key={c.key} style={styles.alertAmt}>{c.key}: {fmtAmount(c.value)} / {fmtAmount(budgets[c.key])}</Text>
              ))}
            </View>
          ) : (
            <Text style={{ marginTop: 8, color: '#64748b' }}>No categories over budget.</Text>
          )}
        </View>
        {fullCategoryList.length === 0 ? <Text style={styles.empty}>No categories</Text> : fullCategoryList.map(cat => {
          const spend = spendMap[cat] || 0;
          const limit = budgets[cat];
          let color: string | undefined;
          if (limit) {
            const ratio = spend / limit;
            if (ratio >= 1) color = '#ef4444'; else if (ratio >= 0.8) color = '#f59e0b'; else color = '#10b981';
          }
          const draftVal = drafts[cat] ?? (limit ? String(limit) : '');
          const isDirty = dirtySet.has(cat);
          return (
            <View key={cat} style={[styles.row, { alignItems: 'center' }]}>
              <Text style={styles.rowLabel} numberOfLines={1}>{cat}</Text>
              <View style={styles.rowBarWrap}>
                <Bar pct={maxCategory ? (spend / maxCategory) * 100 : 0} color={color} />
              </View>
              <View style={{ width: 130 }}>
                <Text style={styles.rowVal}>{fmtAmount(spend)}{totalAll > 0 && spend > 0 ? ` (${((spend/totalAll)*100).toFixed(1)}%)` : ''}</Text>
                {limit ? <Text style={{ fontSize: 11, color: color || '#334' }}>{fmtAmount(limit)} limit</Text> : null}
              </View>
              <TextInput
                placeholder={limit ? 'Edit' : 'Set'}
                keyboardType="numeric"
                value={draftVal}
                onChangeText={(txt) => onChangeDraft(cat, txt)}
                style={[styles.inputSmall, { backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: isDirty ? '#4f46e5' : '#cbd5e1', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 6, minWidth: 70 }]}
              />
            </View>
          );
        })}
        {/* Global Save Button */}
        <View style={{ marginTop: 12, flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          {anyDirty && (
            <Pressable onPress={onCancelAll} style={[styles.pill, { backgroundColor: '#f43f5e' }]}> 
              <Text style={[styles.pillText, { color: '#fff' }]}>Cancel Changes</Text>
            </Pressable>
          )}
          <Pressable onPress={onSaveAll} disabled={!anyDirty} style={[styles.pill, { backgroundColor: anyDirty ? '#4f46e5' : '#94a3b8' }]}>
            <Text style={[styles.pillText, { color: '#fff' }]}>Save Changes</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

type InsightsModalProps = {
  visible: boolean;
  onClose: () => void;
  largestReceipt30d: { date: string; merchant: string; total: number } | null;
  topCatThisMonth?: [string, number];
  latestMoM: number;
  fmtAmount: (n: number) => string;
};

function InsightsModal({ visible, onClose, largestReceipt30d, topCatThisMonth, latestMoM, fmtAmount }: Readonly<InsightsModalProps>) {
  const formatDate = (s: string) => {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    try {
      return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' }).format(d);
    } catch {
      return d.toDateString();
    }
  };
  const now = new Date();
  const monthName = now.toLocaleString(undefined, { month: 'long' });
  const monthLabel = `${monthName} ${now.getFullYear()}`;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalBackdrop}>
          <TouchableWithoutFeedback>
            <SafeAreaView style={styles.modalSheet}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Insights</Text>
                <Pressable onPress={onClose}><Text style={styles.modalClose}>Close</Text></Pressable>
              </View>
              <ScrollView contentContainerStyle={styles.modalBody}>
                {largestReceipt30d ? (
                  <Text>
                    Largest (last 30 days): {largestReceipt30d.merchant || 'Unknown'} — {fmtAmount(largestReceipt30d.total)} — {formatDate(largestReceipt30d.date)}
                  </Text>
                ) : (
                  <Text>No purchases in the last 30 days</Text>
                )}
                <Text>
                  Top category ({monthLabel}): {topCatThisMonth ? topCatThisMonth[0] : 'n/a'} {topCatThisMonth ? `— ${fmtAmount(topCatThisMonth[1])}` : ''}
                </Text>
                <Text>
                  Latest MoM change: {latestMoM >= 0 ? '+' : ''}{latestMoM.toFixed(1)}%
                </Text>
              </ScrollView>
            </SafeAreaView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

// Simple keyword-based categorization
const CATEGORY_KEYWORDS: { key: string; keywords: string[] }[] = [
  { key: 'Groceries', keywords: ['grocery', 'market', 'mart', 'supermarket', 'whole foods', 'kroger', 'aldi', 'costco'] },
  { key: 'Food & Drink', keywords: ['restaurant', 'cafe', 'coffee', 'bar', 'pizza', 'burger', 'kitchen'] },
  { key: 'Electronics', keywords: ['electronics', 'device', 'phone', 'laptop', 'best buy', 'apple store'] },
  { key: 'Travel', keywords: ['airlines', 'uber', 'lyft', 'hotel', 'booking', 'airbnb'] },
  { key: 'Clothing', keywords: ['clothing', 'apparel', 'nike', 'adidas', 'zara', 'h&m'] },
  { key: 'Pharmacy', keywords: ['pharmacy', 'cvs', 'walgreens', 'rite aid', 'med'] },
  { key: 'Home', keywords: ['home depot', 'lowe', 'furniture', 'ikea', 'home'] },
];

function categorize(desc: string): string {
  const s = desc.toLowerCase();
  for (const c of CATEGORY_KEYWORDS) {
    for (const k of c.keywords) {
      if (s.includes(k)) return c.key;
    }
  }
  return 'Other';
}

// Compute insights: largest receipt in last 30d, top category this month, and latest MoM
function computeInsightsData(filtered: any[], byMonth: { key: string; value: number }[]) {
  const now = new Date();
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  let largestReceipt30d: { date: string; merchant: string; total: number } | null = null;
  for (const r of filtered) {
    const d: any = r?.data || r?.derived || {};
    const dt = resolveReceiptDate(r);
    if (dt && dt >= last30) {
      const total = safeNum(d.total);
      if (!largestReceipt30d || total > largestReceipt30d.total) {
        const iso = !Number.isNaN(dt.getTime()) ? dt.toISOString() : '';
        largestReceipt30d = { date: iso, merchant: safeStr(d.merchant), total };
      }
    }
  }

  const thisMonthStart = monthStart(now);
  const catTotalsThisMonth: Record<string, number> = {};
  for (const r of filtered) {
    const d: any = r?.data || r?.derived || {};
    const dt = resolveReceiptDate(r);
    if (dt && dt >= thisMonthStart && Array.isArray(d.items)) {
      for (const it of d.items) {
        const desc = safeStr(it?.desc) || safeStr(it?.name);
        const qty = safeNum(it?.qty) || 1;
        const price = safeNum(it?.price);
        const amount = Math.max(0, qty * price);
        const cat = categorize(desc);
        catTotalsThisMonth[cat] = (catTotalsThisMonth[cat] || 0) + amount;
      }
    }
  }
  const topCatThisMonth = Object.entries(catTotalsThisMonth).sort((a,b)=>b[1]-a[1])[0];

  const latestMoM = byMonth.length >= 2 ? ((byMonth[0].value - byMonth[1].value) / (byMonth[1].value || 1)) * 100 : 0;
  return { largestReceipt30d, topCatThisMonth, latestMoM };
}

// -------- Subcomponents ---------
type FiltersPanelProps = {
  currencies: string[];
  dateFilter: DateFilter;
  setDateFilter: (v: DateFilter) => void;
  currencyFilter: string;
  setCurrencyFilter: (v: string) => void;
  q: string;
  setQ: (v: string) => void;
  minAmt: string;
  setMinAmt: (v: string) => void;
  maxAmt: string;
  setMaxAmt: (v: string) => void;
  onlyWithItems: boolean;
  setOnlyWithItems: (v: boolean) => void;
  archivedMode: 'ALL' | 'ACTIVE' | 'ARCHIVED';
  setArchivedMode: (v: 'ALL' | 'ACTIVE' | 'ARCHIVED') => void;
};

function FiltersPanel({ currencies, dateFilter, setDateFilter, currencyFilter, setCurrencyFilter, q, setQ, minAmt, setMinAmt, maxAmt, setMaxAmt, onlyWithItems, setOnlyWithItems, archivedMode, setArchivedMode }: Readonly<FiltersPanelProps>) {
  return (
    <View style={styles.filters}>
      {/* Date range */}
      <View style={styles.pillsRow}>
        {(['ALL','L3','L6','YTD'] as DateFilter[]).map(v => (
          <Pressable key={v} onPress={() => setDateFilter(v)} style={[styles.pill, dateFilter === v && styles.pillActive]}>
            <Text style={[styles.pillText, dateFilter === v && styles.pillTextActive]}>{v}</Text>
          </Pressable>
        ))}
      </View>
      {/* Currency */}
      <View style={styles.pillsRow}>
        <Pressable key={'ALL'} onPress={() => setCurrencyFilter('ALL')} style={[styles.pill, currencyFilter === 'ALL' && styles.pillActive]}>
          <Text style={[styles.pillText, currencyFilter === 'ALL' && styles.pillTextActive]}>All</Text>
        </Pressable>
        {currencies.map(c => (
          <Pressable key={c} onPress={() => setCurrencyFilter(c)} style={[styles.pill, currencyFilter === c && styles.pillActive]}>
            <Text style={[styles.pillText, currencyFilter === c && styles.pillTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </View>
      {/* Search + amounts + items */}
      <View style={[styles.pillsRow, { alignItems: 'center' }] }>
        <TextInput
          placeholder="Search merchant/items"
          value={q}
          onChangeText={setQ}
          style={styles.input}
          autoCapitalize="none"
        />
        <TextInput
          placeholder="Min"
          value={minAmt}
          onChangeText={setMinAmt}
          style={[styles.input, styles.inputSmall]}
          keyboardType="numeric"
        />
        <TextInput
          placeholder="Max"
          value={maxAmt}
          onChangeText={setMaxAmt}
          style={[styles.input, styles.inputSmall]}
          keyboardType="numeric"
        />
        <Pressable onPress={() => setOnlyWithItems(!onlyWithItems)} style={[styles.pill, onlyWithItems && styles.pillActive]}>
          <Text style={[styles.pillText, onlyWithItems && styles.pillTextActive]}>Has items</Text>
        </Pressable>
      </View>
      {/* Archived */}
      <View style={styles.pillsRow}>
        {(['ALL','ACTIVE','ARCHIVED'] as ArchivedMode[]).map(v => {
          const label = archivedModeLabel(v);
          return (
            <Pressable key={v} onPress={() => setArchivedMode(v)} style={[styles.pill, archivedMode === v && styles.pillActive]}>
              <Text style={[styles.pillText, archivedMode === v && styles.pillTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// Summary chip showing currently active filters; press opens modal
function ActiveFiltersSummary({ dateFilter, currencyFilter, q, minAmt, maxAmt, onlyWithItems, archivedMode, total, filtered, onOpen }: Readonly<{ dateFilter: DateFilter; currencyFilter: string; q: string; minAmt: string; maxAmt: string; onlyWithItems: boolean; archivedMode: ArchivedMode; total: number; filtered: number; onOpen: () => void }>) {
  const parts: string[] = [];
  if (dateFilter !== 'ALL') parts.push(dateFilter);
  if (currencyFilter !== 'ALL') parts.push(currencyFilter);
  if (q.trim()) parts.push(`q:${q.trim()}`);
  if (minAmt.trim()) parts.push(`min:${minAmt.trim()}`);
  if (maxAmt.trim()) parts.push(`max:${maxAmt.trim()}`);
  if (onlyWithItems) parts.push('has-items');
  if (archivedMode === 'ACTIVE') parts.push('active-only'); else if (archivedMode === 'ARCHIVED') parts.push('archived-only');
  const countPart = `${filtered}/${total}`;
  const label = parts.length ? parts.join(' · ') : 'none';
  return (
    <Pressable onPress={onOpen} style={styles.activeFiltersChip} accessibilityRole="button" accessibilityLabel="Open filters">
      <Ionicons name="funnel" size={14} color="#4f46e5" style={styles.activeFiltersIcon} />
      <Text style={styles.activeFiltersText} numberOfLines={1}>Filters: {label}  •  {countPart}</Text>
    </Pressable>
  );
}

// Modal wrapper reusing FiltersPanel for FAB-triggered flow
type FiltersModalProps = FiltersPanelProps & { visible: boolean; onClose: () => void };
function FiltersModal({ visible, onClose, ...panelProps }: Readonly<FiltersModalProps>) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalBackdrop}>
          <TouchableWithoutFeedback>
            <SafeAreaView style={[styles.modalSheet, { maxHeight: '80%' }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Filters</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  <Pressable disabled={!(panelProps.dateFilter !== 'ALL' || panelProps.currencyFilter !== 'ALL' || panelProps.q.trim() || panelProps.minAmt.trim() || panelProps.maxAmt.trim() || panelProps.onlyWithItems || panelProps.archivedMode !== 'ALL')} onPress={() => {
                    panelProps.setDateFilter('ALL');
                    panelProps.setCurrencyFilter('ALL');
                    panelProps.setQ('');
                    panelProps.setMinAmt('');
                    panelProps.setMaxAmt('');
                    panelProps.setOnlyWithItems(false);
                    panelProps.setArchivedMode('ALL');
                  }}>
                    <Text style={[styles.modalClose, { color: (panelProps.dateFilter !== 'ALL' || panelProps.currencyFilter !== 'ALL' || panelProps.q.trim() || panelProps.minAmt.trim() || panelProps.maxAmt.trim() || panelProps.onlyWithItems || panelProps.archivedMode !== 'ALL') ? '#ef4444' : '#94a3b8' }]}>Clear All</Text>
                  </Pressable>
                  <Pressable onPress={onClose}><Text style={styles.modalClose}>Close</Text></Pressable>
                </View>
              </View>
              <ScrollView contentContainerStyle={styles.modalBody}>
                <FiltersPanel {...panelProps} />
              </ScrollView>
            </SafeAreaView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

type ByMonth = { key: string; value: number }[];
type ByKV = { key: string; value: number }[];

function MonthlySpendSection({ byMonth, maxMonth, fmtAmount }: Readonly<{ byMonth: ByMonth; maxMonth: number; fmtAmount: (n: number) => string }>) {
  return (
    <Section title="Monthly Spend">
      {byMonth.length === 0 ? <Text style={styles.empty}>No data yet</Text> : byMonth.map((m, idx) => {
        const prev = byMonth[idx + 1]?.value ?? 0;
        const deltaPct = prev ? ((m.value - prev) / prev) * 100 : 0;
        const sign = deltaPct > 0 ? '+' : '';
        return (
          <View key={m.key} style={styles.row}>
            <Text style={styles.rowLabel}>{m.key}</Text>
            <View style={styles.rowBarWrap}>
              <Bar pct={(m.value / maxMonth) * 100} />
            </View>
            <View style={{ width: 140 }}>
              <Text style={styles.rowVal}>{fmtAmount(m.value)}</Text>
              {prev ? <Text style={deltaPct >= 0 ? styles.deltaUp : styles.deltaDown}>{sign}{deltaPct.toFixed(1)}%</Text> : null}
            </View>
          </View>
        );
      })}
    </Section>
  );
}

function TopMerchantsSection({ byMerchant, maxMerchant, fmtAmount }: Readonly<{ byMerchant: ByKV; maxMerchant: number; fmtAmount: (n:number)=>string }>) {
  return (
    <Section title="Top Merchants">
      {byMerchant.length === 0 ? <Text style={styles.empty}>No data yet</Text> : byMerchant.map(m => (
        <View key={m.key} style={styles.row}>
          <Text style={styles.rowLabel} numberOfLines={1}>{m.key}</Text>
          <View style={styles.rowBarWrap}>
            <Bar pct={(m.value / maxMerchant) * 100} />
          </View>
          <Text style={styles.rowVal}>{fmtAmount(m.value)}</Text>
        </View>
      ))}
    </Section>
  );
}

function ByCurrencySection({ byCurrency, fmtAmountIn }: Readonly<{ byCurrency: ByKV; fmtAmountIn: (cur:string, n:number)=>string }>) {
  return (
    <Section title="By Currency">
      {byCurrency.length === 0 ? <Text style={styles.empty}>No data yet</Text> : byCurrency.map(c => (
        <View key={c.key} style={styles.rowBare}>
          <Text style={styles.rowLabel}>{c.key}</Text>
          <Text style={styles.rowVal}>{fmtAmountIn(c.key, c.value)}</Text>
        </View>
      ))}
    </Section>
  );
}

function ByCategorySection({ byCategory, maxCategory, totalAll, budgets, fmtAmount, months, activeMonth, onSelectMonth }: Readonly<{ byCategory: ByKV; maxCategory: number; totalAll: number; budgets: Record<string, number>; fmtAmount: (n:number)=>string; months: string[]; activeMonth: string; onSelectMonth: (m: string) => void }>) {
  return (
    <Section title="By Category (Top)">
      {/* Month filter embedded inside category section */}
      {months.length > 0 ? (
        <View style={{ marginBottom: 8 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable onPress={() => onSelectMonth('ALL')} style={[styles.pill, activeMonth === 'ALL' && styles.pillActive]}>
              <Text style={[styles.pillText, activeMonth === 'ALL' && styles.pillTextActive]}>All Months</Text>
            </Pressable>
            {months.map(m => (
              <Pressable key={m} onPress={() => onSelectMonth(m)} style={[styles.pill, activeMonth === m && styles.pillActive]}>
                <Text style={[styles.pillText, activeMonth === m && styles.pillTextActive]}>{m}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {byCategory.length === 0 ? <Text style={styles.empty}>No data yet</Text> : byCategory.map(c => (
        <View key={c.key} style={styles.row}>
          <Text style={styles.rowLabel} numberOfLines={1}>{c.key}</Text>
          <View style={styles.rowBarWrap}>
            {(() => {
              let color: string | undefined;
              if (budgets[c.key]) {
                const ratio = c.value / budgets[c.key];
                if (ratio >= 1) color = '#ef4444'; else if (ratio >= 0.8) color = '#f59e0b'; else color = '#10b981';
              }
              return <Bar pct={(c.value / maxCategory) * 100} color={color} />;
            })()}
          </View>
          <Text style={styles.rowVal}>{fmtAmount(c.value)}{totalAll > 0 ? ` (${((c.value/totalAll)*100).toFixed(1)}%)` : ''}</Text>
        </View>
      ))}
    </Section>
  );
}

// inlined month filter now part of ByCategorySection

// Extracted overview section component
function OverviewSection({ kpis, fmtAmount }: Readonly<{ kpis: Metric[]; fmtAmount: (n:number)=>string }>) {
  return (
    <Section title="Overview">
      <View style={styles.kpiRow}>
        {kpis.map(k => (
          <View key={k.label} style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{k.label}</Text>
            <Text style={styles.kpiValue}>{k.label === 'Receipts' ? k.value : fmtAmount(Number(k.value))}</Text>
          </View>
        ))}
      </View>
    </Section>
  );
}

// (Deprecated) BudgetAlertsSection replaced by BudgetsAndAlertsSection

// (Removed per-row buffered input; now using single form save at bottom)
