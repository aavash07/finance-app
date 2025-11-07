import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Pressable } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { FinanceKitClient, generateDEK, mintGrantJWT, rsaOaepWrapDek } from '@financekit/rn-sdk';
import { useAppState } from '../context/AppState';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

type Receipt = { id: number; merchant?: string; total?: number; purchased_at?: string };

export default function ReceiptsScreen() {
  const navigation = useNavigation<any>();
  const { baseUrl, authHeaders, deviceId, pem, privB64, setReceiptDekWrap, receipts, setReceiptData, fetchWithAuth } = useAppState();
  const api = useMemo(() => new FinanceKitClient(baseUrl, fetchWithAuth), [baseUrl, fetchWithAuth]);
  const [items, setItems] = useState<Receipt[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
  const r = await fetchWithAuth(`${baseUrl.replace(/\/$/, '')}/api/v1/receipts`, { headers: authHeaders });
      const body = await r.json();
      if (!r.ok) throw body;
      setItems(body.results || body.items || []);
    } catch (e: any) {
      try {
        // Offline fallback: use locally cached receipts
        const cached = Object.values(receipts).map(rc => ({
          id: rc.id,
          merchant: rc.derived?.merchant || rc.data?.merchant || 'Receipt',
          total: rc.derived?.total || rc.data?.total || 0,
          purchased_at: rc.derived?.date_str || ''
        }));
        setItems(cached as any);
        console.warn('Receipts load failed, using offline cache:', e?.detail || e?.message || e);
      } catch (error_) {
        console.warn('Offline cache load failed:', error_);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [baseUrl]);

  const onPickAndIngest = async () => {
    try {
      if (!pem) return Alert.alert('Missing', 'Fetch server key in Device Setup first');
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
      if (res.canceled || !res.assets?.length) return;
      const image = { uri: res.assets[0].uri, name: 'receipt.jpg', type: 'image/jpeg' } as any;
      const dek = generateDEK(32);
      const dek_wrap_srv = rsaOaepWrapDek(pem, dek);
      const now = Math.floor(Date.now() / 1000);
      const token = await mintGrantJWT(deviceId, privB64, { sub: '1', scope: ['receipt:ingest'], jti: String(now), iat: now, nbf: now - 5, exp: now + 120 });
  const resp: any = await api.ingestReceipt({ token, dek_wrap_srv, year: new Date().getFullYear(), month: new Date().getMonth() + 1, category: 'Uncategorized', image, authHeaders });
      if (resp.receipt_id) {
        const merch = resp?.derived?.merchant || resp?.data?.merchant || 'Receipt';
        const total = resp?.derived?.total || resp?.data?.total || '';
        Alert.alert('Ingested', `#${resp.receipt_id} • ${merch}${total ? ' • $' + total : ''}`);
        await setReceiptDekWrap(resp.receipt_id, dek_wrap_srv);
        await setReceiptData(resp.receipt_id, resp.data, resp.derived);
        load();
      } else {
        Alert.alert('Error', resp?.detail || 'Ingest failed');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.detail || 'Ingest failed');
    }
  };

  const isEmpty = !loading && items.length === 0;

  return (
    <View style={styles.c}>
      {isEmpty ? (
        <View style={styles.empty}>
          <Ionicons name="document-text-outline" size={72} color="#94a3b8" />
          <Text style={styles.emptyTitle}>No receipts yet</Text>
          <Text style={styles.emptyText}>Tap the + button to ingest your first receipt.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          refreshing={loading}
          onRefresh={load}
          keyExtractor={x => String(x.id)}
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => navigation.navigate('ReceiptDetail', { id: item.id })} style={styles.item}>
              <Text style={styles.m}>{item.merchant || 'Unknown'}</Text>
              <Text>{item.total == null ? '' : `$${item.total}`}</Text>
              <Text>{item.purchased_at || ''}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Floating Action Button */}
      <Pressable accessibilityRole="button" accessibilityLabel="Pick and ingest receipt" onPress={onPickAndIngest} style={styles.fab}>
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, padding: 12 },
  item: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  m: { fontWeight: '600' },
  fab: {
    position: 'absolute', right: 20, bottom: 24,
    backgroundColor: '#4f46e5', height: 56, width: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: 12, fontSize: 18, fontWeight: '700', color: '#334155' },
  emptyText: { marginTop: 6, color: '#64748b' },
});
