import React, { useEffect, useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Pressable, Animated, Easing, LayoutAnimation, Platform, UIManager, Modal, TouchableWithoutFeedback, SafeAreaView } from 'react-native';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';
import { FinanceKitClient, generateDEK, mintGrantJWT, rsaOaepWrapDek } from '@financekit/rn-sdk';
import { useAppState } from '../context/AppState';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
// Haptics (now installed) – static import for type safety
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFxRates } from '../hooks/useFxRates';

// --- Local expandable FAB stack component ---
function FabStack({ onCamera, onLibrary }: Readonly<{ onCamera: () => Promise<void> | void; onLibrary: () => Promise<void> | void }>) {
  const [open, setOpen] = useState(false);
  const rot = useRef(new Animated.Value(0)).current; // 0 closed, 1 open
  const offset1 = useRef(new Animated.Value(0)).current; // for first action
  const offset2 = useRef(new Animated.Value(0)).current; // for second action

  const toggle = () => {
    const next = !open;
    setOpen(next);
    Haptics.selectionAsync().catch(() => {});
    Animated.parallel([
      Animated.spring(rot, { toValue: next ? 1 : 0, useNativeDriver: true, friction: 6 }),
      Animated.spring(offset1, { toValue: next ? -76 : 0, useNativeDriver: true, friction: 6 }),
      Animated.spring(offset2, { toValue: next ? -140 : 0, useNativeDriver: true, friction: 6 }),
    ]).start();
  };

  const rotate = rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] });

  return (
    <View pointerEvents="box-none" style={styles.fabStackWrap}>
      {/* Library FAB */}
      <Animated.View style={[
        styles.fabSmallWrap,
        {
          transform: [
            { translateY: offset1 },
            { scale: rot.interpolate({ inputRange: [0,1], outputRange: [0.01,1] }) }
          ],
          opacity: rot.interpolate({ inputRange: [0, 0.01, 1], outputRange: [0, 0, 1] })
        }
      ]}> 
        <Pressable
          pointerEvents={open ? 'auto' : 'none'}
          onPress={() => { setOpen(false); Animated.spring(rot, { toValue: 0, useNativeDriver: true }).start(); onLibrary?.(); }}
          style={[styles.fabSmall, { backgroundColor: '#1f2937' }]} accessibilityLabel="Choose from photos"
        >
          <Ionicons name="images" size={22} color="#fff" />
        </Pressable>
      </Animated.View>
      {/* Camera FAB */}
      <Animated.View style={[
        styles.fabSmallWrap,
        {
          transform: [
            { translateY: offset2 },
            { scale: rot.interpolate({ inputRange: [0,1], outputRange: [0.01,1] }) }
          ],
          opacity: rot.interpolate({ inputRange: [0, 0.01, 1], outputRange: [0, 0, 1] })
        }
      ]}> 
        <Pressable
          pointerEvents={open ? 'auto' : 'none'}
          onPress={() => { setOpen(false); Animated.spring(rot, { toValue: 0, useNativeDriver: true }).start(); onCamera?.(); }}
          style={[styles.fabSmall, { backgroundColor: '#0f766e' }]} accessibilityLabel="Open camera"
        >
          <Ionicons name="camera" size={22} color="#fff" />
        </Pressable>
      </Animated.View>
      {/* Main FAB */}
      <Pressable accessibilityRole="button" accessibilityLabel="Add receipt" onPress={toggle} style={styles.fab}>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <Ionicons name="add" size={28} color="#fff" />
        </Animated.View>
      </Pressable>
    </View>
  );
}

type Receipt = { id: number; merchant?: string; total?: number; purchased_at?: string; currency?: string };

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

const SwipeActionRight = () => (
  <View style={styles.swipeActionRightWrap}>
    <View style={styles.swipePillDanger}>
      <Ionicons name="trash" size={22} color="#fff" />
    </View>
  </View>
);

const SwipeActionLeft = ({ archived }: Readonly<{ archived?: boolean }>) => (
  <View style={styles.swipeActionLeftWrap}>
    <View style={archived ? styles.swipePillNeutral : styles.swipePillPrimary}>
      <Ionicons name={archived ? 'arrow-undo' : 'archive'} size={22} color="#fff" />
    </View>
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

function ReceiptItem({ item, merchant, dateDisplay, onPress, onToggleDate, formatTotal }: Readonly<{ item: Receipt; merchant: string; dateDisplay: string; onPress: () => void; onToggleDate: () => void; formatTotal: (r: Receipt) => string }>) {
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
          <Text style={[styles.amount, { color: amountColor(item.total) }]}>{item.total == null ? '' : formatTotal(item)}</Text>
        </View>
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function ReceiptsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { baseUrl, authHeaders, deviceId, pem, privB64, setReceiptDekWrap, receipts, setReceiptData, fetchWithAuth, removeReceipt } = useAppState();
  const api = useMemo(() => new FinanceKitClient(baseUrl, fetchWithAuth), [baseUrl, fetchWithAuth]);
  const [items, setItems] = useState<Receipt[]>([]);
  const itemsRef = useRef(items);
  const [loading, setLoading] = useState(false);
  const [firstLoadComplete, setFirstLoadComplete] = useState(false);
  // Archived receipts (persisted UI state)
  const [archivedIds, setArchivedIds] = useState<Set<number>>(new Set());
  const [archivedOpen, setArchivedOpen] = useState(false);
  const ARCHIVE_KEY = 'archived_receipt_ids_v1';
  // Load archived IDs once on mount
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(ARCHIVE_KEY);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            // Normalize to numbers and filter out non-finite values
            setArchivedIds(new Set(arr.map(Number).filter((n: number) => Number.isFinite(n))));
          }
        }
      } catch {/* ignore */}
    })();
  }, []);
  const persistArchived = React.useCallback(async (ids: Set<number>) => {
    try { await AsyncStorage.setItem(ARCHIVE_KEY, JSON.stringify(Array.from(ids))); } catch {/* ignore */}
  }, []);

  // Header chip similar to Analytics headerRight
  const HeaderRight = React.useCallback(() => {
    if (archivedIds.size === 0) return null;
    return (
      <Pressable
        onPress={() => setArchivedOpen(true)}
        style={[styles.archivedChip, { marginBottom: 0 }]}
        accessibilityRole="button"
        accessibilityLabel={`Open archived receipts (${archivedIds.size})`}
      >
        <Ionicons name="archive" size={16} color="#fff" />
        <Text style={styles.archivedChipText}>Archived ({archivedIds.size})</Text>
      </Pressable>
    );
  }, [archivedIds.size]);

  useLayoutEffect(() => {
    navigation?.setOptions?.({ headerTitle: 'Receipts', headerRight: HeaderRight });
  }, [navigation, HeaderRight]);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetchWithAuth(`${baseUrl.replace(/\/$/, '')}/api/v1/receipts`, { headers: authHeaders });
      const body = await r.json();
      if (!r.ok) throw body;
      let list: any[] = body.results || body.items || [];
      if (!Array.isArray(list)) list = [];
      // Normalize id to number for consistent archivedId matching
      const normalized = list.map(rec => ({
        ...rec,
        id: Number(rec.id),
        merchant: rec?.derived?.merchant || rec?.data?.merchant || rec?.merchant,
        total: rec?.derived?.total || rec?.data?.total || rec?.total,
        purchased_at: rec?.derived?.date_str || rec?.data?.date || rec?.purchased_at,
        currency: rec?.derived?.currency || rec?.data?.currency || rec?.currency || 'USD'
      })) as Receipt[];
      setItems(normalized);
      setFirstLoadComplete(true);
    } catch (e: any) {
      try {
        // Offline fallback: use locally cached receipts
        const cached = Object.values(receipts).map(rc => ({
          id: rc.id,
          merchant: rc.derived?.merchant || rc.data?.merchant || 'Receipt',
          total: rc.derived?.total || rc.data?.total || 0,
          purchased_at: rc.derived?.date_str || '',
          currency: rc.derived?.currency || rc.data?.currency || 'USD'
        }));
        setItems(cached as any);
        setFirstLoadComplete(true);
        console.warn('Receipts load failed, using offline cache:', e?.detail || e?.message || e);
      } catch (error_) {
        console.warn('Offline cache load failed:', error_);
      }
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [baseUrl]);
  useEffect(() => { itemsRef.current = items; }, [items]);
  // Enable LayoutAnimation on Android
  useEffect(() => {
    if (Platform.OS === 'android' && (UIManager as any).setLayoutAnimationEnabledExperimental) {
      (UIManager as any).setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  // Pending (soft) deletions with undo window
  const [pending, setPending] = useState<{ id: number; merchant: string; timer: any; item: Receipt }[]>([]);
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
    // Work on a local snapshot to avoid race conditions between multiple setState calls
    let snapshot = itemsRef.current;
    let target = snapshot.find(x => x.id === id);
    if (!target) {
      const rLocal = receipts[String(id)];
      if (!rLocal) return; // nothing to delete
      target = {
        id: rLocal.id,
        merchant: rLocal.derived?.merchant || rLocal.data?.merchant || 'Receipt',
        total: rLocal.derived?.total || rLocal.data?.total || 0,
        purchased_at: rLocal.derived?.date_str || ''
      };
      // Treat as if part of the current list for optimistic removal
      snapshot = [...snapshot, target];
    }
    // Optimistically remove target (ensure single instance removed)
    const afterRemoval = snapshot.filter(x => x.id !== id);
    try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } catch (e) { console.warn('LayoutAnimation unavailable:', (e as Error).message); }
    setItems(afterRemoval);
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
  setPending([...pendingRef.current.filter(p => p.id !== id), { id, merchant: target.merchant || 'Receipt', timer, item: target }]);
  // If this was archived, drop it from archived set so state stays consistent
    setArchivedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      persistArchived(next);
      return next;
    });
    // Haptic feedback (non-blocking)
    // Fire-and-forget haptic feedback (Promise handled explicitly to satisfy lint)
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      .catch(e => console.warn('Haptics notification failed:', (e as Error).message));
  };

  const onArchive = (id: number) => {
    try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } catch (e) { console.warn('LayoutAnimation unavailable:', (e as Error).message); }
    setArchivedIds(prev => {
      const next = new Set(prev).add(id);
      persistArchived(next);
      return next;
    });
    // Light haptic
    Haptics.selectionAsync().catch(() => {});
  };

  const onUnarchive = (id: number) => {
    try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } catch (e) { console.warn('LayoutAnimation unavailable:', (e as Error).message); }
  setArchivedIds(prev => { const next = new Set(prev); next.delete(id); persistArchived(next); return next; });
    Haptics.selectionAsync().catch(() => {});
  };

  // Handle deletion requested from detail screen via navigation params
  useFocusEffect(
    React.useCallback(() => {
      const reqId = route?.params?.scheduleDeleteId;
      if (reqId) {
        scheduleDeletion(reqId);
        // Clear param so it doesn't repeat
        try { navigation.setParams({ scheduleDeleteId: undefined }); } catch {}
      }
    }, [route?.params?.scheduleDeleteId])
  );

  const undoDelete = (id: number) => {
    const entry = pendingRef.current.find(x => x.id === id);
    if (entry) clearTimeout(entry.timer);
    setPending(pendingRef.current.filter(x => x.id !== id));
    if (entry?.item) {
      // Deduplicate before restoring
      const filtered = itemsRef.current.filter(x => x.id !== id);
      const next = [...filtered, entry.item].sort((a, b) => b.id - a.id);
      setItems(next);
    }
    progressAnim.stopAnimation();
    progressAnim.setValue(0);
  };

  const onDelete = (id: number) => {
    // Confirm by full swipe; no dialog. Show haptic and schedule deletion.
    scheduleDeletion(id);
  };

  // Ingestion helpers (gallery & camera)
  const ingestImage = async (uri: string) => {
    if (!pem) { Alert.alert('Missing', 'Fetch server key in Device Setup first'); return; }
    try {
      const image = { uri, name: 'receipt.jpg', type: 'image/jpeg' } as any;
      const dek = generateDEK(32);
      const dek_wrap_srv = rsaOaepWrapDek(pem, dek);
      const now = Math.floor(Date.now() / 1000);
      const token = await mintGrantJWT(deviceId, privB64, { sub: '1', scope: ['receipt:ingest'], jti: String(now), iat: now, nbf: now - 5, exp: now + 120 });
      const resp: any = await api.ingestReceipt({ token, dek_wrap_srv, year: new Date().getFullYear(), month: new Date().getMonth() + 1, category: 'Uncategorized', image, authHeaders });
      if (resp.receipt_id) {
        const merch = resp?.derived?.merchant || resp?.data?.merchant || 'Receipt';
        const total = resp?.derived?.total || resp?.data?.total || '';
        const cur = resp?.derived?.currency || resp?.data?.currency || 'USD';
        Alert.alert('Ingested', `#${resp.receipt_id} • ${merch}${total ? ' • ' + cur + ' ' + total : ''}`);
        await setReceiptDekWrap(resp.receipt_id, dek_wrap_srv);
        await setReceiptData(resp.receipt_id, resp.data, resp.derived);
        load();
      } else {
        Alert.alert('Error', resp?.detail || 'Ingest failed');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.detail || e?.message || 'Ingest failed');
    }
  };

  const chooseFromLibrary = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.9 });
    if (res.canceled || !res.assets?.length) return;
    ingestImage(res.assets[0].uri);
  };

  const captureAndIngest = async () => {
    // Request permission first (idempotent)
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Camera access is required to take a photo.'); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.9 });
    if (res.canceled || !res.assets?.length) return;
    ingestImage(res.assets[0].uri);
  };

  // Deprecated: old single FAB handler (kept for reference)
  // const onFabPress = () => {}; // replaced by FabStack

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

  // FX rates via shared hook
  const { convertToUSD, formatUSD, ensureRates: ensureFxRates } = useFxRates();
  useEffect(() => { ensureFxRates(); }, [ensureFxRates]);
  useFocusEffect(useCallback(() => { ensureFxRates(); }, [ensureFxRates]));

  const formatTotalUsd = useCallback((r: Receipt) => {
    const total = typeof r.total === 'number' ? r.total : Number(r.total);
    if (!Number.isFinite(total)) return '';
    const usd = convertToUSD(total, r.currency);
    return formatUSD(usd);
  }, [convertToUSD, formatUSD]);
  // Optional prune ONLY after first successful load and when there are items; skip on empty to avoid wiping persisted archive set
  useEffect(() => {
    if (!firstLoadComplete) return;
    if (loading) return;
    if (items.length === 0) return; // nothing to compare yet
    // If an archived id no longer exists in items, assume it was permanently deleted and drop it
    const existingIds = new Set(items.map(r => r.id));
    const stillValid = Array.from(archivedIds).filter(id => existingIds.has(id));
    if (stillValid.length !== archivedIds.size) {
      const next = new Set(stillValid);
      setArchivedIds(next);
      persistArchived(next);
    }
  }, [firstLoadComplete, loading, items, archivedIds, persistArchived]);

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
    const active = items.filter(x => !archivedIds.has(x.id));
    content = (
      <FlatList
        data={active}
        refreshing={loading}
        onRefresh={load}
        keyExtractor={(x) => String(x.id)}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const showAbs = absoluteDateIds.has(item.id);
          const dateDisplay = showAbs ? formatAbsolute(item.purchased_at) : relativeDate(item.purchased_at);
          const merchant = item.merchant || 'Unknown';
          return (
            <Swipeable
              renderLeftActions={() => <SwipeActionLeft archived={false} />}
              renderRightActions={SwipeActionRight}
              overshootLeft={false}
              overshootRight={false}
              onSwipeableOpen={(direction: any) => {
                if (direction === 'left') onArchive(item.id);
                else onDelete(item.id);
              }}
            >
              <ReceiptItem
                item={item}
                merchant={merchant}
                dateDisplay={dateDisplay}
                onPress={() => navigation.navigate('ReceiptDetail', { id: item.id })}
                onToggleDate={() => toggleDateMode(item.id)}
                formatTotal={formatTotalUsd}
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
      {/* Archived modal */}
      <Modal visible={archivedOpen} animationType="fade" transparent onRequestClose={() => setArchivedOpen(false)}>
        <TouchableWithoutFeedback onPress={() => setArchivedOpen(false)}>
          <View style={styles.modalBackdrop}>
            <TouchableWithoutFeedback>
              <SafeAreaView style={styles.modalSheet}>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Archived</Text>
                  <Pressable onPress={() => setArchivedOpen(false)} accessibilityLabel="Close archived">
                    <Text style={styles.modalClose}>Close</Text>
                  </Pressable>
                </View>
                <GestureHandlerRootView style={{ flex: 1 }}>
                  <FlatList
                    style={{ flex: 1 }}
                    data={items.filter(x => archivedIds.has(x.id))}
                    keyExtractor={(x) => String(x.id)}
                    contentContainerStyle={styles.modalBody}
                    ListEmptyComponent={<Text style={{ color: '#64748b' }}>No archived receipts</Text>}
                    renderItem={({ item }) => {
                      const showAbs = absoluteDateIds.has(item.id);
                      const dateDisplay = showAbs ? formatAbsolute(item.purchased_at) : relativeDate(item.purchased_at);
                      const merchant = item.merchant || 'Unknown';
                      return (
                        <Swipeable
                          renderLeftActions={() => <SwipeActionLeft archived />}
                          renderRightActions={SwipeActionRight}
                          overshootLeft={false}
                          overshootRight={false}
                          onSwipeableOpen={(direction: any) => {
                            if (direction === 'left') onUnarchive(item.id);
                            else onDelete(item.id);
                          }}
                        >
                          <ReceiptItem
                            item={item}
                            merchant={merchant}
                            dateDisplay={dateDisplay}
                            onPress={() => {}}
                            onToggleDate={() => toggleDateMode(item.id)}
                            formatTotal={formatTotalUsd}
                          />
                        </Swipeable>
                      );
                    }}
                  />
                </GestureHandlerRootView>
              </SafeAreaView>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Floating Action Buttons (Expandable) */}
      <FabStack
        onCamera={captureAndIngest}
        onLibrary={chooseFromLibrary}
      />

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
  itemCard: { padding: 12, borderRadius: 18, backgroundColor: '#fff', marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e2e8f0',
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
    backgroundColor: '#4f46e5', height: 56, width: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  fabStackWrap: { position: 'absolute', right: 20, bottom: 28, alignItems: 'center' },
  fabSmallWrap: { position: 'absolute', right: 0, bottom: 0 },
  fabSmall: { height: 48, width: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: 12, fontSize: 18, fontWeight: '700', color: '#334155' },
  emptyText: { marginTop: 6, color: '#64748b' },
  swipeAction: { flex: 1, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'flex-end', marginVertical: 6 },
  swipeActionRightWrap: { flex: 1, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'flex-end', marginVertical: 6 },
  swipeActionLeftWrap: { flex: 1, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'flex-start', marginVertical: 6 },
  swipePillDanger: { backgroundColor: '#ef4444', height: 44, minWidth: 56, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', alignItems: 'center', marginRight: 12,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  swipePillPrimary: { backgroundColor: '#3b82f6', height: 44, minWidth: 56, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', alignItems: 'center', marginLeft: 12,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  swipePillNeutral: { backgroundColor: '#64748b', height: 44, minWidth: 56, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', alignItems: 'center', marginLeft: 12,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  undoBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#1f2937' },
  undoContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  undoText: { color: '#f1f5f9', flex: 1, marginRight: 12 },
  undoBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#4f46e5', borderRadius: 4 },
  undoBtnText: { color: '#fff', fontWeight: '700' },
  progressBar: { height: 4, backgroundColor: '#4f46e5', borderRadius: 2 },
  archivedChip: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', backgroundColor: '#64748b', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 8 },
  archivedChipText: { color: '#fff', fontWeight: '700', marginLeft: 6 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalSheet: { backgroundColor: '#fff', height: '60%', maxHeight: '75%', width: '92%', borderRadius: 16, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#e5e7eb' },
  modalTitle: { fontSize: 18, fontWeight: '700' },
  modalClose: { color: '#4f46e5', fontWeight: '600' },
  modalBody: { padding: 16 },
});
