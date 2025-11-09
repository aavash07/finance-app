import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Alert, Button } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { useNavigation } from '@react-navigation/native';
import { useAppState } from '../context/AppState';

type Props = NativeStackScreenProps<RootStackParamList, 'ReceiptDetail'>;
type DecryptResponse = { data?: Record<string, unknown>; processed_at?: string } | { code: string; detail: string };

function hasData(b: DecryptResponse | null): b is { data: Record<string, unknown>; processed_at?: string } {
  return !!b && typeof b === 'object' && 'data' in (b as any);
}

export default function ReceiptDetailScreen({ route }: Readonly<Props>) {
  const { id } = route.params;
  const { receipts, baseUrl, authHeaders, fetchWithAuth, removeReceipt } = useAppState();
  const navigation = useNavigation<any>();
  const [body, setBody] = useState<DecryptResponse | null>(null);

  useEffect(() => {
    const cached = receipts[String(id)];
    if (cached && (cached.data || cached.derived)) {
      setBody({ data: (cached.data || cached.derived) as unknown as Record<string, unknown>, processed_at: cached.updatedAt });
    } else {
      setBody(null);
    }
  }, [id, receipts]);

  const d: any = hasData(body) ? (body.data as any) : null;
  const processedAt = (body && (body as any).processed_at) || '';
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  const numStr = (v: unknown) => (typeof v === 'number' || typeof v === 'string' ? String(v) : '');
  const formatDateTime = (s: string) => {
    if (!s) { return ''; }
    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) { return s; }
    try {
      return new Intl.DateTimeFormat(undefined, {
        year: 'numeric', month: 'short', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).format(dt);
    } catch {
      // Fallback: ISO formatted, more readable spacing
      return dt.toISOString().replace('T', ' ').replace('Z', ' UTC');
    }
  };

  const onDelete = () => {
    Alert.alert('Delete receipt', `Delete receipt #${id}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        // Redirect to Receipts list and trigger the same deletion flow used there
        navigation.reset({
          index: 0,
          routes: [
            { name: 'MainTabs', params: { screen: 'ReceiptsTab', params: { scheduleDeleteId: id, nonce: Date.now() } } as any },
          ],
        });
      } }
    ]);
  };
  return (
    <ScrollView contentContainerStyle={styles.c}>
      <Text style={styles.t}>Receipt #{id}</Text>
      {d ? (
        <View style={styles.card}>
          <Text style={styles.h1}>{str(d.merchant) || 'Receipt'}</Text>
          <Text style={styles.meta}>{str(d.date_str) || str(d.date) || ''}</Text>
          <Text style={styles.total}>Total: {str(d.currency) || 'USD'} {numStr(d.total)}</Text>
          {Array.isArray(d.items) && d.items.length > 0 ? (
            <View style={styles.items}>
              <Text style={styles.h2}>Items</Text>
              {d.items.map((it: any, idx: number) => {
                const stableKey = String(it.id ?? `${it.desc || it.name || ''}-${it.price}-${it.qty ?? 1}-${idx}`);
                return (
                <View key={stableKey} style={styles.itemRow}>
                  <Text style={styles.itemDesc}>{String(it.desc || it.name || '')}</Text>
                  <Text style={styles.itemMeta}>x{String(it.qty ?? 1)}</Text>
                  <Text style={styles.itemPrice}>{String(it.price ?? '')}</Text>
                </View>
              );})}
            </View>
          ) : null}
          <Text style={styles.meta}>Processed: {formatDateTime(processedAt)}</Text>
          <View style={styles.deleteBtn}><Button title="Delete" color="#ef4444" onPress={onDelete} /></View>
        </View>
      ) : (
        <Text>No local data for this receipt. Ingest from this device to cache it for offline viewing.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  c: { padding: 16 },
  t: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  card: { padding: 12, borderRadius: 8, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  h1: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  h2: { fontSize: 16, fontWeight: '600', marginTop: 10, marginBottom: 6 },
  total: { fontSize: 16, fontWeight: '600', marginVertical: 6 },
  meta: { color: '#556', marginBottom: 4 },
  items: { marginTop: 4 },
  itemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
  itemDesc: { flex: 1, marginRight: 8 },
  itemMeta: { width: 40, textAlign: 'right', color: '#556' },
  itemPrice: { width: 80, textAlign: 'right' },
  deleteBtn: { marginTop: 12 },
  undoWrap: { marginTop: 16, backgroundColor: '#1f2937', padding: 12, borderRadius: 6 },
  undoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  undoText: { color: '#f1f5f9', flex: 1, marginRight: 12 },
  undoBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#4f46e5', borderRadius: 4 },
  undoBtnText: { color: '#fff', fontWeight: '700' },
  undoProgress: { height: 4, backgroundColor: '#4f46e5', borderRadius: 2 },
});
