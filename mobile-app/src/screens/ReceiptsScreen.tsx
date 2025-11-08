import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Pressable, Animated, Easing } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';
import { FinanceKitClient, generateDEK, mintGrantJWT, rsaOaepWrapDek } from '@financekit/rn-sdk';
import { useAppState } from '../context/AppState';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

type Receipt = { id: number; merchant?: string; total?: number; purchased_at?: string };

export default function ReceiptsScreen() {
  const navigation = useNavigation<any>();
  const { baseUrl, authHeaders, deviceId, pem, privB64, setReceiptDekWrap, receipts, setReceiptData, fetchWithAuth, removeReceipt } = useAppState();
  const api = useMemo(() => new FinanceKitClient(baseUrl, fetchWithAuth), [baseUrl, fetchWithAuth]);
  const [items, setItems] = useState<Receipt[]>([]);
  const itemsRef = useRef(items);
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
  useEffect(() => { itemsRef.current = items; }, [items]);

  // Pending (soft) deletions with undo window
  const [pending, setPending] = useState<{ id: number; merchant: string; timer: any }[]>([]);
  const pendingRef = useRef(pending);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  const UNDO_MS = 5000;
  // Animated countdown progress (0 -> 1 over UNDO_MS)
  const progressAnim = useRef(new Animated.Value(0)).current;
  const startProgress = () => {
    progressAnim.setValue(0);
    Animated.timing(progressAnim, { toValue: 1, duration: UNDO_MS, easing: Easing.linear, useNativeDriver: false }).start();
  };
  const scheduleDeletion = (id: number) => {
    const target = items.find(x => x.id === id);
    if (!target) return;
    // Optimistically remove from list
    setItems(itemsRef.current.filter(x => x.id !== id));
    // Start countdown animation
    startProgress();
    // Set timer to finalize
    const timer = setTimeout(async () => {
      let ok = false;
      try {
        const r = await fetchWithAuth(`${baseUrl.replace(/\/$/, '')}/api/v1/receipts/${id}`, { method: 'DELETE', headers: authHeaders });
        ok = r.status === 204 || r.status === 200;
        if (ok) await removeReceipt(id);
        else {
          const body = await r.text();
          Alert.alert('Error', body || 'Failed to delete (restoring)');
        }
      } catch (e: any) {
        Alert.alert('Error', e?.message || 'Failed to delete (restoring)');
      }
      if (!ok) {
        // Restore item
        const next = [...itemsRef.current, target];
        next.sort((a,b) => b.id - a.id);
        setItems(next);
      }
      setPending(pendingRef.current.filter(x => x.id !== id));
    }, UNDO_MS);
    setPending([...pendingRef.current, { id, merchant: target.merchant || 'Receipt', timer }]);
  };

  const undoDelete = (id: number) => {
    const entry = pendingRef.current.find(x => x.id === id);
    if (entry) clearTimeout(entry.timer);
    setPending(pendingRef.current.filter(x => x.id !== id));
    // Restore item from local receipts cache (still present because not permanently deleted yet)
    const rLocal = receipts[String(id)];
    if (rLocal) {
      const restored: Receipt = {
        id: rLocal.id,
        merchant: rLocal.derived?.merchant || rLocal.data?.merchant || 'Receipt',
        total: rLocal.derived?.total || rLocal.data?.total || 0,
        purchased_at: rLocal.derived?.date_str || ''
      };
      const next = [...itemsRef.current, restored];
      next.sort((a,b)=>b.id-a.id);
      setItems(next);
    }
    // Reset progress for potential next deletion
    progressAnim.stopAnimation();
    progressAnim.setValue(0);
  };

  const onDelete = (id: number) => {
    Alert.alert('Delete receipt', `Temporarily delete #${id}? You can undo for ${UNDO_MS/1000}s.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => scheduleDeletion(id) }
    ]);
  };

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
          renderItem={({ item }) => {
            const Action = () => (
              <View style={styles.swipeAction}>
                <Text style={styles.swipeText}>Delete</Text>
              </View>
            );
            return (
              <Swipeable
                renderLeftActions={Action}
                renderRightActions={Action}
                onSwipeableOpen={() => onDelete(item.id)}
              >
                <TouchableOpacity
                  onPress={() => navigation.navigate('ReceiptDetail', { id: item.id })}
                  style={styles.item}
                >
                  <View style={styles.row}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.m}>{item.merchant || 'Unknown'}</Text>
                      <Text style={styles.sub}>{item.purchased_at || ''}</Text>
                    </View>
                    <Text style={styles.amount}>{item.total == null ? '' : `$${item.total}`}</Text>
                  </View>
                </TouchableOpacity>
              </Swipeable>
            );
          }}
        />
      )}

      {/* Floating Action Button */}
      <Pressable accessibilityRole="button" accessibilityLabel="Pick and ingest receipt" onPress={onPickAndIngest} style={styles.fab}>
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>

      {/* Undo toast (show most recent pending deletion) */}
      {pending.length > 0 && (() => {
        const last = pending.at(-1)!;
        const remaining = Math.max(0, UNDO_MS - Math.round((progressAnim as any)._value * UNDO_MS));
        const secondsLeft = Math.ceil(remaining / 1000);
        const widthInterpolate = progressAnim.interpolate({ inputRange: [0,1], outputRange: ['100%','0%'] });
        return (
          <View style={styles.undoBar}>
            <View style={styles.undoContent}>
              <Text style={styles.undoText}>Deleted #{last.id} ({last.merchant}) · Undo ({secondsLeft}s)</Text>
              <Pressable onPress={() => undoDelete(last.id)} style={styles.undoBtn}>
                <Text style={styles.undoBtnText}>UNDO</Text>
              </Pressable>
            </View>
            <Animated.View style={[styles.progressBar, { width: widthInterpolate }]} />
          </View>
        );
      })()}
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, padding: 12 },
  item: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#ddd' },
  row: { flexDirection: 'row', alignItems: 'center' },
  m: { fontWeight: '600' },
  sub: { color: '#64748b', marginTop: 2 },
  amount: { fontWeight: '600' },
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
  swipeAction: { backgroundColor: '#ef4444', justifyContent: 'center', alignItems: 'flex-end', paddingHorizontal: 20 },
  swipeText: { color: '#fff', fontWeight: '700' },
  undoBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#1f2937' },
  undoContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  undoText: { color: '#f1f5f9', flex: 1, marginRight: 12 },
  undoBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#4f46e5', borderRadius: 4 },
  undoBtnText: { color: '#fff', fontWeight: '700' },
  progressBar: { height: 4, backgroundColor: '#4f46e5', borderRadius: 2 },
});
