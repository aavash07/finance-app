import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Pressable, Animated, Easing } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';
import { FinanceKitClient, generateDEK, mintGrantJWT, rsaOaepWrapDek } from '@financekit/rn-sdk';
import { useAppState } from '../context/AppState';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';

type Receipt = { id: number; merchant?: string; total?: number; purchased_at?: string };

// --------- Helpers & Subcomponents (top-level) ---------
function relativeDate(dateStr?: string) {
  if (!dateStr) return '';
  const dt = new Date(dateStr);
  if (Number.isNaN(dt.getTime())) return dateStr;
  const now = Date.now();
  const diffMs = now - dt.getTime();
  const diffDays = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) {
    const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
    if (diffHours === 0) {
      const diffMin = Math.max(0, Math.floor(diffMs / (60 * 1000)));
      return diffMin <= 1 ? 'just now' : `${diffMin}m ago`;
    }
    return `${diffHours}h ago`;
  }
  if (diffDays < 7) return `${diffDays}d ago`;
  const weeks = Math.floor(diffDays / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(diffDays / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(diffDays / 365);
  return `${years}y ago`;
}

function formatAbsolute(dateStr?: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  try {
    return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' }).format(d);
  } catch {
    return d.toDateString();
  }
}

function hashColor(input: string) {
  let hash = 0;
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    hash = (hash * 31 + cp) >>> 0;
  }
  const r = (hash & 0xff0000) >> 16;
  const g = (hash & 0x00ff00) >> 8;
  const b = (hash & 0x0000ff);
  const lr = Math.floor((r + 255) / 2);
  const lg = Math.floor((g + 255) / 2);
  const lb = Math.floor((b + 255) / 2);
  return `rgb(${lr}, ${lg}, ${lb})`;
}

function amountColor(total: number | undefined) {
  if (total == null) return '#334155';
  if (total < 25) return '#059669';
  if (total < 100) return '#f59e0b';
  return '#dc2626';
}

const SwipeAction = () => (
  <View style={styles.swipeAction}>
    <Pressable style={styles.swipeBtn}> 
      <Text style={styles.swipeText}>Delete</Text>
    </Pressable>
  </View>
);

function SkeletonCard({ shimmerBg }: Readonly<{ shimmerBg: any }>) {
  return (
    <Animated.View style={[styles.itemCard, { backgroundColor: shimmerBg }]}> 
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={[styles.avatar, { backgroundColor: '#cbd5e1' }]} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <View style={styles.skelLine} />
          <View style={[styles.skelLine, { width: '40%', marginTop: 6 }]} />
        </View>
        <View style={[styles.skelLine, { width: 48 }]} />
      </View>
    </Animated.View>
  );
}

function ReceiptItem({ item, merchant, dateDisplay, onPress, onToggleDate }: Readonly<{ item: Receipt; merchant: string; dateDisplay: string; onPress: () => void; onToggleDate: () => void }>) {
  const avatarBg = hashColor(merchant);
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const onPressIn = () => Animated.spring(scaleAnim, { toValue: 0.97, useNativeDriver: true }).start();
  const onPressOut = () => Animated.spring(scaleAnim, { toValue: 1, friction: 5, useNativeDriver: true }).start();
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      style={styles.touchWrap}
    >
      <Animated.View style={[styles.itemCard, { transform: [{ scale: scaleAnim }] }]}> 
        <View style={styles.row}>
          <View style={styles.avatarWrap}>
            <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
              <Text style={styles.avatarText}>{merchant.charAt(0).toUpperCase()}</Text>
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.m}>{merchant}</Text>
            <Pressable onPress={onToggleDate}>
              <Text style={styles.sub}>{dateDisplay}</Text>
            </Pressable>
          </View>
          <Text style={[styles.amount, { color: amountColor(item.total) }]}>{item.total == null ? '' : `$${item.total}`}</Text>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

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

  // Track which receipts show absolute date instead of relative
  const [absoluteDateIds, setAbsoluteDateIds] = useState<Set<number>>(new Set());
  const toggleDateMode = (id: number) => {
    setAbsoluteDateIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Skeleton shimmer animation when loading & no items yet
  const shimmerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (loading && items.length === 0) {
      shimmerAnim.setValue(0);
      Animated.loop(
        Animated.timing(shimmerAnim, { toValue: 1, duration: 1200, easing: Easing.linear, useNativeDriver: false })
      ).start();
    } else {
      shimmerAnim.stopAnimation();
    }
  }, [loading, items.length, shimmerAnim]);

  const shimmerBg = shimmerAnim.interpolate({ inputRange: [0, 0.5, 1], outputRange: ['#e2e8f0', '#f8fafc', '#e2e8f0'] });

  let content: React.ReactNode;
  if (loading && items.length === 0) {
    content = (
      <FlatList
        data={Array.from({ length: 6 }).map((_, i) => i)}
        keyExtractor={(x) => `${x}`}
        contentContainerStyle={styles.listContent}
        renderItem={() => <SkeletonCard shimmerBg={shimmerBg} />}
      />
    );
  } else if (isEmpty) {
    content = (
      <View style={styles.empty}>
        <Ionicons name="document-text-outline" size={72} color="#94a3b8" />
        <Text style={styles.emptyTitle}>No receipts yet</Text>
        <Text style={styles.emptyText}>Tap the + button to ingest your first receipt.</Text>
      </View>
    );
  } else {
    content = (
      <FlatList
        data={items}
        refreshing={loading}
        onRefresh={load}
        keyExtractor={x => String(x.id)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const showAbs = absoluteDateIds.has(item.id);
          const dateDisplay = showAbs ? formatAbsolute(item.purchased_at) : relativeDate(item.purchased_at);
          const merchant = item.merchant || 'Unknown';
          return (
            <Swipeable
              renderLeftActions={SwipeAction}
              renderRightActions={SwipeAction}
              overshootLeft={false}
              overshootRight={false}
              onSwipeableOpen={() => onDelete(item.id)}
            >
              <ReceiptItem
                item={item}
                merchant={merchant}
                dateDisplay={dateDisplay}
                onPress={() => navigation.navigate('ReceiptDetail', { id: item.id })}
                onToggleDate={() => toggleDateMode(item.id)}
              />
            </Swipeable>
          );
        }}
      />
    );
  }

  return (
    <View style={styles.c}>
      {content}

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
  c: { flex: 1, backgroundColor: '#f1f5f9' },
  listContent: { padding: 12, paddingBottom: 120 },
  touchWrap: { borderRadius: 14 },
  itemCard: { padding: 12, borderRadius: 14, backgroundColor: '#fff', marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e2e8f0',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  row: { flexDirection: 'row', alignItems: 'center' },
  m: { fontWeight: '600' },
  sub: { color: '#64748b', marginTop: 2 },
  amount: { fontWeight: '600' },
  avatarWrap: { marginRight: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#0f172a', fontWeight: '700', fontSize: 16 },
  skelLine: { height: 12, backgroundColor: '#cbd5e1', borderRadius: 6, width: '60%' },
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
  swipeAction: { flex: 1, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'flex-end', marginVertical: 6 },
  swipeBtn: { backgroundColor: '#ef4444', height: '88%', aspectRatio: 1, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 8,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  swipeText: { color: '#fff', fontWeight: '700' },
  undoBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#1f2937' },
  undoContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  undoText: { color: '#f1f5f9', flex: 1, marginRight: 12 },
  undoBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#4f46e5', borderRadius: 4 },
  undoBtnText: { color: '#fff', fontWeight: '700' },
  progressBar: { height: 4, backgroundColor: '#4f46e5', borderRadius: 2 },
});
