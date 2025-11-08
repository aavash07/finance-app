import React, { useMemo, useState, useLayoutEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput, Modal, SafeAreaView, Alert, Share, TouchableWithoutFeedback } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useAppState } from '../context/AppState';

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

type DateFilter = 'ALL' | 'L3' | 'L6' | 'YTD';

function monthStart(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), 1); }
function addMonths(d: Date, delta: number): Date { return new Date(d.getFullYear(), d.getMonth() + delta, 1); }

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
  const { receipts, budgets, setBudget } = useAppState();
  const baseList = useMemo(() => Object.values(receipts || {}), [receipts]);

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
  // Removed collapsible inline filters; using FAB + modal instead
  const [filtersModalOpen, setFiltersModalOpen] = useState(false);

  const filtered = useMemo(() => {
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
      const dateStr = safeStr(d.date_str) || safeStr(d.date) || r.updatedAt || '';
      const dt = new Date(dateStr);
      const total = safeNum(d.total);
      const itemsArr: any[] = Array.isArray(d.items) ? d.items : [];
      const merchant = safeStr(d.merchant).toLowerCase();
      const itemHit = qLower ? itemsArr.some(it => ((safeStr(it?.desc) || safeStr(it?.name)).toLowerCase().includes(qLower))) : true;

      const isDateOk = !minDate || dt >= minDate;
      const isCurrencyOk = currencyFilter === 'ALL' || safeStr(d.currency) === currencyFilter;
      const isQueryOk = !qLower || merchant.includes(qLower) || itemHit;
      const isAmtOk = (Number.isNaN(minV) || total >= minV) && (Number.isNaN(maxV) || total <= maxV);
      const isItemsOk = !onlyWithItems || itemsArr.length > 0;

      return isDateOk && isCurrencyOk && isQueryOk && isAmtOk && isItemsOk;
    };
    return baseList.filter(matches);
  }, [baseList, dateFilter, currencyFilter, q, minAmt, maxAmt, onlyWithItems]);

  const { kpis, byMonth, byMerchant, byCurrency, byCategory, csv } = useMemo(() => {
    const totals: number[] = [];
    const months: Record<string, number> = {};
    const merchants: Record<string, number> = {};
    const currencies: Record<string, number> = {};
    const categories: Record<string, number> = {};

    for (const r of filtered) {
      const d: any = r?.data || r?.derived || {};
      const total = safeNum(d.total);
      const cur = safeStr(d.currency) || 'USD';
      const merchant = safeStr(d.merchant) || 'Unknown';
      const dateStr = safeStr(d.date_str) || safeStr(d.date) || r.updatedAt || '';
    const dt = new Date(dateStr);
    const mKey = Number.isNaN(dt.getTime()) ? 'Unknown' : monthKey(dt);

      totals.push(total);
      months[mKey] = (months[mKey] || 0) + total;
      merchants[merchant] = (merchants[merchant] || 0) + total;
      currencies[cur] = (currencies[cur] || 0) + total;

      // Category rollup from items
      if (Array.isArray(d.items)) {
        for (const it of d.items) {
          const desc = safeStr(it?.desc) || safeStr(it?.name);
          const qty = safeNum(it?.qty) || 1;
          const price = safeNum(it?.price);
          const amount = qty * price;
          const cat = categorize(desc);
          categories[cat] = (categories[cat] || 0) + Math.max(0, amount);
        }
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
      .slice(0, 8)
      .map(([k, v]) => ({ key: k, value: v }));

    // CSV (basic): date,merchant,currency,total
    const rows = filtered.map(r => {
      const d: any = r?.data || r?.derived || {};
      const dateStr = safeStr(d.date_str) || safeStr(d.date) || r.updatedAt || '';
      const merchant = safeStr(d.merchant).replaceAll(',', ' ');
      const cur = safeStr(d.currency);
      const total = safeNum(d.total).toFixed(2);
      return `${dateStr},${merchant},${cur},${total}`;
    });
    const csv = ['date,merchant,currency,total', ...rows].join('\n');

    return { kpis, byMonth, byMerchant, byCurrency, byCategory, csv };
  }, [filtered]);

  

  const maxMonth = Math.max(1, ...byMonth.map(x => x.value));
  const maxMerchant = Math.max(1, ...byMerchant.map(x => x.value));
  const maxCategory = Math.max(1, ...byCategory.map(x => x.value));
  const categoriesAll = useMemo(() => {
    const set = new Set<string>();
    for (const c of byCategory) set.add(c.key);
    for (const k of Object.keys(budgets || {})) set.add(k);
    for (const def of CATEGORY_KEYWORDS) set.add(def.key);
    return Array.from(set.values()).sort((a, b) => a.localeCompare(b));
  }, [byCategory, budgets]);

  const overAlerts = useMemo(() => byCategory.filter(c => !!budgets[c.key] && c.value >= budgets[c.key]), [byCategory, budgets]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [budgetModalOpen, setBudgetModalOpen] = useState(false);
  const [insightsModalOpen, setInsightsModalOpen] = useState(false);

  const fmtAmount = (n: number) => {
    try {
      if (currencyFilter !== 'ALL') {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyFilter }).format(n);
      }
      return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
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
    const dateStr = safeStr(d.date_str) || safeStr(d.date) || r.updatedAt || '';
    const dt = new Date(dateStr);
    if (dt >= last30) {
      const total = safeNum(d.total);
      if (!largestReceipt30d || total > largestReceipt30d.total) {
        largestReceipt30d = { date: dateStr, merchant: safeStr(d.merchant), total };
      }
    }
  }

  const thisMonthStart = monthStart(now);
  const catTotalsThisMonth: Record<string, number> = {};
  for (const r of filtered) {
    const d: any = r?.data || r?.derived || {};
    const dateStr = safeStr(d.date_str) || safeStr(d.date) || r.updatedAt || '';
    const dt = new Date(dateStr);
    if (dt >= thisMonthStart && Array.isArray(d.items)) {
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

  // Navigation header chip
  const HeaderRight = useCallback(() => (
    <ActiveFiltersSummary
      dateFilter={dateFilter}
      currencyFilter={currencyFilter}
      q={q}
      minAmt={minAmt}
      maxAmt={maxAmt}
      onlyWithItems={onlyWithItems}
      total={baseList.length}
      filtered={filtered.length}
      onOpen={() => setFiltersModalOpen(true)}
    />
  ), [dateFilter, currencyFilter, q, minAmt, maxAmt, onlyWithItems, baseList.length, filtered.length]);

  useLayoutEffect(() => {
    navigation?.setOptions?.({ headerTitle: 'Analytics', headerRight: HeaderRight });
  }, [navigation, HeaderRight]);

  return (
    <View style={styles.container}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.c}>
        <Text style={styles.t}>Analytics</Text>

      {/* Inline filters section removed (superseded by FAB + modal) */}

      <OverviewSection kpis={kpis} fmtAmount={fmtAmount} />

      <MonthlySpendSection byMonth={byMonth} maxMonth={maxMonth} fmtAmount={fmtAmount} />

      <TopMerchantsSection byMerchant={byMerchant} maxMerchant={maxMerchant} fmtAmount={fmtAmount} />

      <ByCurrencySection byCurrency={byCurrency} fmtAmount={fmtAmount} />

      <ByCategorySection byCategory={byCategory} maxCategory={maxCategory} budgets={budgets} fmtAmount={fmtAmount} />

      <BudgetAlertsSection
        overAlerts={overAlerts}
        alertsOpen={alertsOpen}
        setAlertsOpen={setAlertsOpen}
        budgets={budgets}
        fmtAmount={fmtAmount}
      />

      <Section title="Budgets (Monthly)">
        <Pressable onPress={() => setBudgetModalOpen(true)} style={styles.collapseHeader}>
          <Text style={styles.collapseText}>Open budget editor ({Object.keys(budgets || {}).length})</Text>
        </Pressable>
      </Section>
      <BudgetsEditorModal
        visible={budgetModalOpen}
        onClose={() => setBudgetModalOpen(false)}
        categoriesAll={categoriesAll}
        budgets={budgets}
        setBudget={setBudget}
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

type SetBudgetFn = (category: string, amount: number | null) => Promise<void> | void;

type BudgetsEditorModalProps = {
  visible: boolean;
  onClose: () => void;
  categoriesAll: string[];
  budgets: Record<string, number>;
  setBudget: SetBudgetFn;
};

function BudgetsEditorModal({ visible, onClose, categoriesAll, budgets, setBudget }: Readonly<BudgetsEditorModalProps>) {
  const count = Object.keys(budgets || {}).length;
  const onClearAll = () => {
    if (!count) return;
    Alert.alert(
      'Clear all budgets',
      'This will remove all category budget limits.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear All', style: 'destructive',
          onPress: () => {
            for (const k of Object.keys(budgets || {})) {
              setBudget(k, null);
            }
          }
        }
      ]
    );
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.modalBackdrop}>
          <TouchableWithoutFeedback>
            <SafeAreaView style={styles.modalSheet}>
              <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Budgets (Monthly)</Text>
          <View style={{ flexDirection: 'row', gap: 16 }}>
            <Pressable onPress={onClearAll} disabled={count === 0}>
              <Text style={[styles.modalClose, { color: count ? '#ef4444' : '#94a3b8' }]}>Clear All</Text>
            </Pressable>
            <Pressable onPress={onClose}>
              <Text style={styles.modalClose}>Close</Text>
            </Pressable>
          </View>
              </View>
              <ScrollView contentContainerStyle={styles.modalBody}>
          <Text style={styles.smallNote}>Set a monthly limit per category. Leave blank or 0 to remove.</Text>
          {categoriesAll.map(cat => (
            <View key={cat} style={styles.rowBare}>
              <Text style={styles.rowLabel} numberOfLines={1}>{cat}</Text>
              <TextInput
                placeholder="Amount"
                keyboardType="numeric"
                value={budgets[cat] ? String(budgets[cat]) : ''}
                onChangeText={(txt) => {
                  const v = txt.trim();
                  const n = v ? Number.parseFloat(v) : Number.NaN;
                  if (!v) { setBudget(cat, null); return; }
                  if (Number.isNaN(n)) return; // ignore invalid
                  setBudget(cat, n);
                }}
                style={[styles.input, styles.inputSmall]}
              />
            </View>
          ))}
              </ScrollView>
            </SafeAreaView>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
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
};

function FiltersPanel({ currencies, dateFilter, setDateFilter, currencyFilter, setCurrencyFilter, q, setQ, minAmt, setMinAmt, maxAmt, setMaxAmt, onlyWithItems, setOnlyWithItems }: Readonly<FiltersPanelProps>) {
  return (
    <View style={styles.filters}>
      <View style={styles.pillsRow}>
        {(['ALL','L3','L6','YTD'] as DateFilter[]).map(v => (
          <Pressable key={v} onPress={() => setDateFilter(v)} style={[styles.pill, dateFilter === v && styles.pillActive]}>
            <Text style={[styles.pillText, dateFilter === v && styles.pillTextActive]}>{v}</Text>
          </Pressable>
        ))}
      </View>
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
    </View>
  );
}

// Summary chip showing currently active filters; press opens modal
function ActiveFiltersSummary({ dateFilter, currencyFilter, q, minAmt, maxAmt, onlyWithItems, total, filtered, onOpen }: Readonly<{ dateFilter: DateFilter; currencyFilter: string; q: string; minAmt: string; maxAmt: string; onlyWithItems: boolean; total: number; filtered: number; onOpen: () => void }>) {
  const parts: string[] = [];
  if (dateFilter !== 'ALL') parts.push(dateFilter);
  if (currencyFilter !== 'ALL') parts.push(currencyFilter);
  if (q.trim()) parts.push(`q:${q.trim()}`);
  if (minAmt.trim()) parts.push(`min:${minAmt.trim()}`);
  if (maxAmt.trim()) parts.push(`max:${maxAmt.trim()}`);
  if (onlyWithItems) parts.push('has-items');
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
                  <Pressable disabled={!(panelProps.dateFilter !== 'ALL' || panelProps.currencyFilter !== 'ALL' || panelProps.q.trim() || panelProps.minAmt.trim() || panelProps.maxAmt.trim() || panelProps.onlyWithItems)} onPress={() => {
                    panelProps.setDateFilter('ALL');
                    panelProps.setCurrencyFilter('ALL');
                    panelProps.setQ('');
                    panelProps.setMinAmt('');
                    panelProps.setMaxAmt('');
                    panelProps.setOnlyWithItems(false);
                  }}>
                    <Text style={[styles.modalClose, { color: (panelProps.dateFilter !== 'ALL' || panelProps.currencyFilter !== 'ALL' || panelProps.q.trim() || panelProps.minAmt.trim() || panelProps.maxAmt.trim() || panelProps.onlyWithItems) ? '#ef4444' : '#94a3b8' }]}>Clear All</Text>
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

function ByCurrencySection({ byCurrency, fmtAmount }: Readonly<{ byCurrency: ByKV; fmtAmount: (n:number)=>string }>) {
  return (
    <Section title="By Currency">
      {byCurrency.length === 0 ? <Text style={styles.empty}>No data yet</Text> : byCurrency.map(c => (
        <View key={c.key} style={styles.rowBare}>
          <Text style={styles.rowLabel}>{c.key}</Text>
          <Text style={styles.rowVal}>{fmtAmount(c.value)}</Text>
        </View>
      ))}
    </Section>
  );
}

function ByCategorySection({ byCategory, maxCategory, budgets, fmtAmount }: Readonly<{ byCategory: ByKV; maxCategory: number; budgets: Record<string, number>; fmtAmount: (n:number)=>string }>) {
  return (
    <Section title="By Category (Top)">
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
          <Text style={styles.rowVal}>{fmtAmount(c.value)}</Text>
        </View>
      ))}
    </Section>
  );
}

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

type BudgetAlertsSectionProps = {
  overAlerts: { key: string; value: number }[];
  alertsOpen: boolean;
  setAlertsOpen: (v: boolean | ((prev: boolean) => boolean)) => void;
  budgets: Record<string, number>;
  fmtAmount: (n:number)=>string;
};
function BudgetAlertsSection({ overAlerts, alertsOpen, setAlertsOpen, budgets, fmtAmount }: Readonly<BudgetAlertsSectionProps>) {
  return (
    <Section title="Budget Alerts">
      <Pressable onPress={() => setAlertsOpen(v => !v)} style={styles.collapseHeader}>
        <Text style={styles.collapseText}>{alertsOpen ? 'Hide' : 'Show'} alerts ({overAlerts.length})</Text>
      </Pressable>
      {alertsOpen ? (
        <View style={styles.alertsList}>
          {overAlerts.length === 0 ? (
            <Text style={styles.empty}>No categories over budget</Text>
          ) : (
            overAlerts.map(c => (
              <View key={c.key} style={styles.alertRow}>
                <Text style={styles.alertText}>Over: {c.key}</Text>
                <Text style={styles.alertAmt}>{fmtAmount(c.value)} / {fmtAmount(budgets[c.key])}</Text>
              </View>
            ))
          )}
        </View>
      ) : null}
    </Section>
  );
}
