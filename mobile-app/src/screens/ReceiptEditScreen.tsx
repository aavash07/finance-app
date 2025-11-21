import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet, Alert, ScrollView, TouchableOpacity, Pressable } from 'react-native';
import PillButton from '../components/PillButton';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useAppState } from '../context/AppState';
import { FinanceKitClient } from '../../sdk/client';
import InlineCalendarPicker from '../components/InlineCalendarPicker';

interface Props extends NativeStackScreenProps<RootStackParamList, 'ReceiptEdit'> {}

export default function ReceiptEditScreen({ route, navigation }: Props) {
  const { id } = route.params;
  const { baseUrl, authHeaders, receipts, setReceiptData, bumpAnalytics } = useAppState() as any;
  const cacheEntry = receipts[String(id)] || {} as any;
  const existing = cacheEntry.derived || cacheEntry.data;
  const [loaded, setLoaded] = useState(false);
  const [merchant, setMerchant] = useState(existing?.merchant || '');
  const [dateStr, setDateStr] = useState(existing?.date_str || existing?.date || '');
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarYear, setCalendarYear] = useState(() => {
    if (dateStr) {
      const parts = dateStr.split('-');
      const y = Number(parts[0]);
      if (Number.isFinite(y)) return y;
    }
    return new Date().getFullYear();
  });
  const [calendarMonth, setCalendarMonth] = useState(() => {
    if (dateStr) {
      const parts = dateStr.split('-');
      const m = Number(parts[1]);
      if (Number.isFinite(m)) return m - 1;
    }
    return new Date().getMonth();
  });
  const [category, setCategory] = useState(existing?.category || 'Other');
  const CATEGORY_OPTIONS = useMemo(() => [
    'Food','Groceries','Travel','Utilities','Shopping','Entertainment','Health','Other'
  ], []);
  const [currency, setCurrency] = useState(existing?.currency || 'USD');
  const [total, setTotal] = useState(String(existing?.total || ''));
  const [subtotal, setSubtotal] = useState(String(existing?.subtotal || ''));
  const [taxTotal, setTaxTotal] = useState(String(existing?.tax_total || ''));
  const [discountTotal, setDiscountTotal] = useState(String(existing?.discount_total || ''));
  const [feesTotal, setFeesTotal] = useState(String(existing?.fees_total || ''));
  const [tipTotal, setTipTotal] = useState(String(existing?.tip_total || ''));
  const cachedItems = (cacheEntry?.data?.items || existing?.items || []) as any[];
  const initItems = cachedItems.map((it: any) => ({ id: String(it.id || Math.random()), desc: it.desc || '', qty: String(it.qty || '1'), price: String(it.price || '0.00') }));
  const [items, setItems] = useState<Array<{ id: string; desc: string; qty: string; price: string }>>(initItems.length ? initItems : []);
  const [saving, setSaving] = useState(false);

  const handleItemChange = (id: string, field: 'desc'|'qty'|'price', value: string) => {
    setItems(arr => arr.map(x => x.id === id ? { ...x, [field]: value } : x));
  };
  const handleItemRemove = (id: string) => {
    setItems(arr => arr.filter(x => x.id !== id));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = new FinanceKitClient(baseUrl);
        const detail = await client.getReceipt(id, authHeaders);
        if (cancelled) return;
        // Populate fields only once if not already edited
        setMerchant(detail.merchant || '');
        setDateStr(detail.date_str || '');
        setCategory(detail.category || '');
        setCurrency(detail.currency || 'USD');
        setTotal(String(detail.total || ''));
        setSubtotal(String(detail.subtotal || ''));
        setTaxTotal(String(detail.tax_total || ''));
        setDiscountTotal(String(detail.discount_total || ''));
        setFeesTotal(String(detail.fees_total || ''));
        setTipTotal(String(detail.tip_total || ''));
        let arr = (detail.items || []).map((it: any, idx: number) => ({ id: String(it.id || `srv-${idx}-${Math.random()}`), desc: it.desc || '', qty: String(it.qty || '1'), price: String(it.price || '0.00') }));
        if (!arr.length) {
          const fallback = (cacheEntry?.data?.items || []) as any[];
          arr = fallback.map((it: any, idx: number) => ({ id: String(it.id || `cache-${idx}-${Math.random()}`), desc: it.desc || '', qty: String(it.qty || '1'), price: String(it.price || '0.00') }));
        }
        setItems(arr);
        setLoaded(true);
      } catch (e:any) {
        if (!existing && !cancelled) Alert.alert('Load failed', e?.detail || 'Could not load receipt');
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const onSave = async () => {
    setSaving(true);
    try {
      const client = new FinanceKitClient(baseUrl);
      const patch: any = {};
      if (merchant) patch.merchant = merchant;
      if (dateStr) patch.date_str = dateStr;
      if (category) patch.category = category;
      if (currency) patch.currency = currency;
      if (total) patch.total = total;
      if (subtotal) patch.subtotal = subtotal;
      if (taxTotal) patch.tax_total = taxTotal;
      if (discountTotal) patch.discount_total = discountTotal;
      if (feesTotal) patch.fees_total = feesTotal;
      if (tipTotal) patch.tip_total = tipTotal;
      patch.items = items.filter(i => i.desc.trim()).map(i => {
        const rawQty = i.qty?.trim() || '1';
        const n = Number(rawQty);
        let normQty: string;
        if (Number.isFinite(n) && n > 0) {
          if (Math.abs(n - Math.round(n)) < 1e-9) normQty = String(Math.round(n));
          else normQty = String(n);
        } else {
          normQty = '1';
        }
        return { desc: i.desc.trim(), qty: normQty, price: i.price || '0.00' };
      });
      await client.updateReceipt(id, patch, authHeaders);
      // Fetch full, fresh detail to ensure cache 'data' reflects server state
      const fresh = await client.getReceipt(id, authHeaders);
      await setReceiptData(id, fresh, fresh);
      try { bumpAnalytics?.(); } catch {}
      navigation.replace('ReceiptDetail', { id });
    } catch (e: any) {
      console.log('[ReceiptEdit] save error', e);
      Alert.alert('Save failed', e?.detail || e?.message || 'Unknown error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.c}>
      <Text style={styles.title}>Edit Receipt #{id}{loaded ? '' : ' (loading...)'}</Text>
      <TextInput style={styles.input} placeholder="Merchant" value={merchant} onChangeText={setMerchant} autoCapitalize="words" />
      <View style={{ marginBottom: 12 }}>
        <Pressable onPress={() => setShowCalendar(s => !s)} style={styles.input} accessibilityLabel="Toggle date calendar">
          <Text style={{ color: dateStr ? '#111827' : '#6b7280' }}>{dateStr || 'Select date'}</Text>
        </Pressable>
        {showCalendar && (
          <View style={{ marginTop: 8 }}>
            <InlineCalendarPicker
              value={dateStr}
              year={calendarYear}
              month={calendarMonth}
              onNavigate={(y,m) => { setCalendarYear(y); setCalendarMonth(m); }}
              onChange={(next) => { setDateStr(next); setShowCalendar(false); }}
            />
          </View>
        )}
      </View>
      <View style={{ marginBottom: 12 }}>
        <Text style={styles.fieldLabel}>Category</Text>
        <CategoryScroller
          categories={CATEGORY_OPTIONS}
          active={category}
          onSelect={(cat) => setCategory(cat)}
        />
      </View>
      <View style={styles.row}> 
        <TextInput style={[styles.input, styles.currency]} placeholder="Currency" value={currency} onChangeText={setCurrency} />
        <TextInput style={[styles.input, styles.total]} placeholder="Total" value={total} onChangeText={setTotal} keyboardType="decimal-pad" />
      </View>
      <Text style={styles.section}>Breakdown</Text>
      <View style={styles.gridRow}>
        <LabeledField label="Subtotal">
          <TextInput style={styles.input} placeholder="Subtotal" value={subtotal} onChangeText={setSubtotal} keyboardType="decimal-pad" />
        </LabeledField>
        <LabeledField label="Tax">
          <TextInput style={styles.input} placeholder="Tax" value={taxTotal} onChangeText={setTaxTotal} keyboardType="decimal-pad" />
        </LabeledField>
        <LabeledField label="Discount">
          <TextInput style={styles.input} placeholder="Discount" value={discountTotal} onChangeText={setDiscountTotal} keyboardType="decimal-pad" />
        </LabeledField>
      </View>
      <View style={styles.gridRow}>
        <LabeledField label="Fees">
          <TextInput style={styles.input} placeholder="Fees" value={feesTotal} onChangeText={setFeesTotal} keyboardType="decimal-pad" />
        </LabeledField>
        <LabeledField label="Tip">
          <TextInput style={styles.input} placeholder="Tip" value={tipTotal} onChangeText={setTipTotal} keyboardType="decimal-pad" />
        </LabeledField>
        <View style={styles.gridItem} />
      </View>
      <Text style={styles.section}>Items</Text>
      {loaded && items.length === 0 && (
        <Text style={styles.emptyText}>No items found on receipt.</Text>
      )}
      {items.map((it, idx) => (
        <ItemEditor key={it.id} index={idx+1} item={it} onChange={handleItemChange} onRemove={handleItemRemove} />
      ))}
      <TouchableOpacity style={styles.addBtn} onPress={()=> setItems(arr => [...arr, { id: String(Date.now()+Math.random()), desc: '', qty: '1', price: '0.00' }])}>
        <Text style={styles.addText}>+ Add Item</Text>
      </TouchableOpacity>
      <PillButton title={saving ? 'Saving...' : 'Save'} disabled={saving} onPress={onSave} />
    </ScrollView>
  );
}

interface EditableItem { id: string; desc: string; qty: string; price: string }
interface ItemEditorProps { readonly item: EditableItem; readonly index: number; readonly onChange: (id: string, field: 'desc'|'qty'|'price', value: string) => void; readonly onRemove: (id: string) => void }
function ItemEditor({ item, index, onChange, onRemove }: ItemEditorProps){
  return (
    <View style={styles.itemRow}>
      <Text style={styles.itemIndex}>{index}</Text>
      <TextInput style={[styles.input, styles.itemDesc]} placeholder="Desc" value={item.desc} onChangeText={v => onChange(item.id,'desc',v)} />
      <TextInput style={[styles.input, styles.itemQty]} placeholder="Qty" value={item.qty} onChangeText={v => onChange(item.id,'qty',v)} keyboardType="decimal-pad" />
      <TextInput style={[styles.input, styles.itemPrice]} placeholder="Price" value={item.price} onChangeText={v => onChange(item.id,'price',v)} keyboardType="decimal-pad" />
      <TouchableOpacity onPress={() => onRemove(item.id)} style={styles.delBtn}><Text style={styles.delText}>✕</Text></TouchableOpacity>
    </View>
  );
}

interface LabeledFieldProps { readonly label: string; readonly children: React.ReactNode }
function LabeledField({ label, children }: LabeledFieldProps){
  return (
    <View style={styles.gridItem}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

// Horizontal scroller that auto-focuses the active category (mirrors ReceiptsScreen)
function CategoryScroller({ categories, active, onSelect }: Readonly<{ categories: string[]; active: string; onSelect: (c: string) => void }>) {
  const scrollRef = React.useRef<ScrollView|null>(null);
  const posRef = React.useRef<Record<string, number>>({});
  const containerWRef = React.useRef(0);
  const contentWRef = React.useRef(0);
  const scrolledRef = React.useRef(false);

  const scrollToActive = React.useCallback(() => {
    const x = posRef.current[active];
    const containerW = containerWRef.current || 0;
    const contentW = contentWRef.current || 0;
    if (scrollRef.current && typeof x === 'number') {
      const clampMax = Math.max(0, contentW - containerW);
      const target = Math.max(0, Math.min(x - 24, clampMax));
      try { scrollRef.current.scrollTo({ x: target, animated: true }); scrolledRef.current = true; } catch {}
    }
  }, [active]);

  React.useEffect(() => {
    const id = setTimeout(scrollToActive, 50);
    return () => clearTimeout(id);
  }, [active, scrollToActive]);

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.categoryScroll}
      onLayout={(e) => { containerWRef.current = e.nativeEvent.layout.width; }}
      onContentSizeChange={(w) => { contentWRef.current = w; if (!scrolledRef.current) scrollToActive(); }}
    >
      {categories.map((cat) => {
        const isActive = cat === active;
        return (
          <Pressable
            key={cat}
            onPress={() => onSelect(cat)}
            onLayout={(e) => {
              posRef.current[cat] = e.nativeEvent.layout.x;
              if (cat === active && !scrolledRef.current) scrollToActive();
            }}
            style={[styles.categoryChip, isActive && styles.categoryChipActive]}
            accessibilityLabel={`Select category ${cat}`}
          >
            <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>{cat}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  c: { padding: 16 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 12 },
  input: { backgroundColor: '#fff', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  row2: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  section: { fontSize: 16, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  small: { flex: 1, marginRight: 8 },
  itemRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  itemIndex: { width: 22, textAlign: 'center', fontWeight: '600', color: '#374151' },
  itemDesc: { flex: 3, marginRight: 8 },
  itemQty: { flex: 1, marginRight: 8 },
  itemPrice: { flex: 1.2, marginRight: 8 },
  delBtn: { paddingHorizontal: 8, paddingVertical: 6, backgroundColor: '#fee2e2', borderRadius: 6 },
  delText: { color: '#b91c1c', fontSize: 12, fontWeight: '700' },
  addBtn: { alignSelf: 'flex-start', backgroundColor: '#e0f2fe', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, marginBottom: 16 },
  addText: { color: '#0369a1', fontWeight: '600' },
  currency: { flex: 1, marginRight: 8 },
  total: { flex: 1 },
  gridRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  gridItem: { flex: 1, marginRight: 8 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginBottom: 4, color: '#6b7280' },
  emptyText: { fontStyle: 'italic', color: '#6b7280', marginBottom: 8 },
  categoryScroll: { flexDirection: 'row', gap: 8 },
  categoryChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', marginRight: 8 },
  categoryChipActive: { backgroundColor: '#4f46e5', borderColor: '#4f46e5' },
  categoryChipText: { color: '#475569', fontSize: 12, fontWeight: '600' },
  categoryChipTextActive: { color: '#ffffff' },
});
