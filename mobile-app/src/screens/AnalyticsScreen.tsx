import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, TextInput } from 'react-native';
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
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export default function AnalyticsScreen() {
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

  return (
    <ScrollView contentContainerStyle={styles.c}>
      <Text style={styles.t}>Analytics</Text>

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
          <Pressable onPress={() => setOnlyWithItems(v => !v)} style={[styles.pill, onlyWithItems && styles.pillActive]}>
            <Text style={[styles.pillText, onlyWithItems && styles.pillTextActive]}>Has items</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.kpiRow}>
        {kpis.map(k => (
          <View key={k.label} style={styles.kpiCard}>
            <Text style={styles.kpiLabel}>{k.label}</Text>
            <Text style={styles.kpiValue}>{k.label === 'Receipts' ? k.value : fmtAmount(Number(k.value))}</Text>
          </View>
        ))}
      </View>

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

      <Section title="By Currency">
        {byCurrency.length === 0 ? <Text style={styles.empty}>No data yet</Text> : byCurrency.map(c => (
          <View key={c.key} style={styles.rowBare}>
            <Text style={styles.rowLabel}>{c.key}</Text>
            <Text style={styles.rowVal}>{fmtAmount(c.value)}</Text>
          </View>
        ))}
      </Section>

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

      <Section title="Budget Alerts">
        {byCategory.filter(c => !!budgets[c.key] && c.value >= budgets[c.key]).length === 0 ? (
          <Text style={styles.empty}>No categories over budget</Text>
        ) : (
          byCategory.filter(c => !!budgets[c.key] && c.value >= budgets[c.key]).map(c => (
            <Text key={c.key} style={{ color: '#b91c1c' }}>Over budget: {c.key} — {fmtAmount(c.value)} / {fmtAmount(budgets[c.key])}</Text>
          ))
        )}
      </Section>

      <Section title="Budgets (Monthly)">
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
                if (!v) { void setBudget(cat, null); return; }
                if (Number.isNaN(n)) return; // ignore invalid
                void setBudget(cat, n);
              }}
              style={[styles.input, styles.inputSmall]}
            />
          </View>
        ))}
      </Section>

      <Section title="Export">
        <Pressable onPress={() => setShowCsv(v => !v)} style={[styles.pill, styles.pillInline]}>
          <Text style={styles.pillText}>{showCsv ? 'Hide CSV' : 'Show CSV'}</Text>
        </Pressable>
        {showCsv ? (
          <View style={styles.csvBox}>
            <Text selectable style={styles.csvText}>{csv}</Text>
          </View>
        ) : null}
      </Section>

          <Section title="Insights">
            {largestReceipt30d ? (
              <Text>
                Largest (30d): {largestReceipt30d.merchant || 'Unknown'} — {fmtAmount(largestReceipt30d.total)} — {largestReceipt30d.date}
              </Text>
            ) : (
              <Text>No purchases in last 30 days</Text>
            )}
            <Text>
              Top category (this month): {topCatThisMonth ? topCatThisMonth[0] : 'n/a'} {topCatThisMonth ? `— ${fmtAmount(topCatThisMonth[1])}` : ''}
            </Text>
            <Text>
              Latest MoM change: {latestMoM >= 0 ? '+' : ''}{latestMoM.toFixed(1)}%
            </Text>
          </Section>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  c: { padding: 16 },
  t: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
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
  sectionTitle: { fontSize: 16, fontWeight: '600', marginBottom: 8 },
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
});

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
