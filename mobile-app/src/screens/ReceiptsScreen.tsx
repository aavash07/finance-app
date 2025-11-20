import React, { useEffect, useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Pressable, Animated, Easing, LayoutAnimation, Platform, UIManager, Modal, TouchableWithoutFeedback, SafeAreaView, Image, TextInput, ScrollView, NativeModules } from 'react-native';
import PillButton from '../components/PillButton';
// Native DateTimePicker removed due to RNCMaterialDatePicker crashes; using JS calendar.
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import * as ImagePicker from 'expo-image-picker';
import { FinanceKitClient, generateDEK, mintGrantJWT, rsaOaepWrapDek } from '@financekit/rn-sdk';
import InlineCalendarPicker from '../components/InlineCalendarPicker';
import { useAppState } from '../context/AppState';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
// Haptics (now installed) – static import for type safety
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
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
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay >= 7) return d.toLocaleDateString();
  if (diffDay >= 1) return `${diffDay}d ago`;
  if (diffHr >= 1) return `${diffHr}h ago`;
  if (diffMin >= 1) return `${diffMin}m ago`;
  return 'Just now';
}

function formatAbsolute(dateStr?: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString();
}

function hashColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h << 5) - h + (seed.codePointAt(i) || 0);
  const colors = ['#4f46e5', '#0ea5e9', '#16a34a', '#f59e0b', '#d946ef', '#0f766e', '#ef4444', '#9333ea'];
  const idx = Math.abs(h) % colors.length;
  return colors[idx];
}

function amountColor(total?: number) {
  if (typeof total !== 'number') return '#0f172a';
  return total < 0 ? '#ef4444' : '#0f172a';
}

const SwipeActionLeft = ({ archived }: Readonly<{ archived?: boolean }>) => (
  <View style={styles.swipeActionLeftWrap}>
    <View style={archived ? styles.swipePillNeutral : styles.swipePillPrimary}>
      <Ionicons name={archived ? 'arrow-undo' : 'archive'} size={22} color="#fff" />
    </View>
  </View>
);

const SwipeActionRight = () => (
  <View style={styles.swipeActionRightWrap}>
    <View style={styles.swipePillDanger}>
      <Ionicons name="trash" size={22} color="#fff" />
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
  const { baseUrl, authHeaders, deviceId, pem, privB64, setReceiptDekWrap, receipts, setReceiptData, fetchWithAuth, removeReceipt, username, queueDelete, dequeueDelete, outboxDeletes } = useAppState();
  const api = useMemo(() => new FinanceKitClient(baseUrl, fetchWithAuth), [baseUrl, fetchWithAuth]);
  const [items, setItems] = useState<Receipt[]>([]);
  const itemsRef = useRef(items);
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const isOnlineRef = useRef<boolean | null>(null);
  const [firstLoadComplete, setFirstLoadComplete] = useState(false);
  // Archived receipts (persisted UI state)
  const [archivedIds, setArchivedIds] = useState<Set<number>>(new Set());
  const [archivedOpen, setArchivedOpen] = useState(false);
  // Ingest confirmation modal state
  const [ingestConfirm, setIngestConfirm] = useState<{ id: number; merchant: string; total: number|string; currency: string; imageUri: string; date: string } | null>(null);
  // Inline quick edit working copy
  const [ingestEdit, setIngestEdit] = useState<{ merchant: string; total: string; currency: string; date: string; subtotal: string; tax_total: string; discount_total: string; fees_total: string; tip_total: string }>({ merchant: '', total: '', currency: 'USD', date: '', subtotal: '', tax_total: '', discount_total: '', fees_total: '', tip_total: '' });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const [expandFull, setExpandFull] = useState(false);
  // Items no longer carry per-line category (simplified classification to receipt-level only)
  const [ingestItems, setIngestItems] = useState<{ id?: number; desc: string; qty: string; price: string }[]>([]);
  const fetchedItemsRef = useRef(false);
  // Determine if native picker is safely available (avoid RNCMaterialDatePicker crash on some Expo Android builds)
  // Force JS calendar path (no native dependency)
  useEffect(() => {
    if (ingestConfirm) {
      setIngestEdit({
        merchant: ingestConfirm.merchant || '',
        total: String(ingestConfirm.total ?? ''),
        currency: ingestConfirm.currency || 'USD',
        date: ingestConfirm.date || '',
        subtotal: '', tax_total: '', discount_total: '', fees_total: '', tip_total: ''
      });
    }
  }, [ingestConfirm]);

  // ---------------- Refactor helpers (reduce cognitive complexity) ----------------
  const buildPatchPayload = () => {
    if (!ingestConfirm) return null;
    const patch: any = {};
    const putNumber = (val: string, key: string) => {
      if (!val?.trim()) return;
      const num = Number(val.trim());
      if (Number.isFinite(num)) patch[key] = num;
    };
    if (ingestEdit.merchant.trim()) patch.merchant = ingestEdit.merchant.trim();
    if (ingestEdit.currency.trim()) patch.currency = ingestEdit.currency.trim().toUpperCase();
    putNumber(ingestEdit.total, 'total');
    if (ingestEdit.date.trim()) patch.date_str = ingestEdit.date.trim();
    if (expandFull) {
      putNumber(ingestEdit.subtotal, 'subtotal');
      putNumber(ingestEdit.tax_total, 'tax_total');
      putNumber(ingestEdit.discount_total, 'discount_total');
      putNumber(ingestEdit.fees_total, 'fees_total');
      putNumber(ingestEdit.tip_total, 'tip_total');
      if (ingestItems.length) {
        patch.items = ingestItems.map(it => ({
          id: it.id,
          desc: it.desc.trim(),
          qty: Number(it.qty) || 1,
          price: Number(it.price) || 0,
        })).filter(x => x.desc);
      }
    }
    return patch;
  };

  const toggleExpandFull = () => {
    setExpandFull(prev => {
      const next = !prev;
      if (next && !fetchedItemsRef.current) loadIngestItems();
      return next;
    });
  };

  const updateIngestItem = (index: number, patch: Partial<{ desc: string; qty: string; price: string }>) => {
    setIngestItems(arr => arr.map((x,i) => i === index ? { ...x, ...patch } : x));
  };

  const quickSave = async () => {
    if (!ingestConfirm) return;
    try {
      const id = ingestConfirm.id;
      const patch = buildPatchPayload();
      if (!patch || Object.keys(patch).length === 0) { Alert.alert('Nothing to save', 'Enter a value first'); return; }
      const resp = await fetchWithAuth(`${baseUrl.replace(/\/$/, '')}/api/v1/receipts/${id}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) throw body;
      try { await setReceiptData(id, body.data || body, body.derived || {}); } catch {}
      setIngestConfirm(c => {
        if (!c) return c;
        return {
          ...c,
            merchant: patch.merchant ?? c.merchant,
            total: patch.total ?? c.total,
            currency: patch.currency ?? c.currency,
        };
      });
      await load(true, { silent: true });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      // Navigate to detail after brief tick so modal state clears first
      setTimeout(() => {
        setIngestConfirm(null);
        navigation.navigate('ReceiptDetail', { id });
      }, 60);
    } catch (e: any) {
      Alert.alert('Save failed', e?.detail || e?.message || 'Failed to save changes');
    }
  };

  const loadIngestItems = useCallback(async () => {
    if (!ingestConfirm) return;
    if (fetchedItemsRef.current) return;
    try {
      const r = await fetchWithAuth(`${baseUrl.replace(/\/$/, '')}/api/v1/receipts/${ingestConfirm.id}`, { headers: authHeaders });
      const body = await r.json();
      if (r.ok && body.items) {
        const mapped = (body.items || []).map((it: any) => ({
          id: it.id,
          desc: String(it.desc || ''),
          qty: String(it.qty ?? '1'),
          price: String(it.price ?? '0'),
        }));
        if (mapped.length) setIngestItems(mapped);
      } else if (body.ocr_json?.items) {
        const mapped = (body.ocr_json.items || []).map((it: any) => ({
          id: undefined,
          desc: String(it.desc || ''),
          qty: String(it.qty ?? '1'),
          price: String(it.price ?? '0'),
        }));
        if (mapped.length) setIngestItems(mapped);
      }
    } catch {/* ignore */}
    fetchedItemsRef.current = true;
  }, [ingestConfirm, fetchWithAuth, baseUrl, authHeaders]);
  const ARCHIVE_KEY = `archived_receipt_ids_v1:${username}`;
  
  // Build list from local cache (offline-first)
  const buildFromCache = useCallback((): Receipt[] => {
    const cached = Object.values(receipts).map(rc => ({
      id: rc.id,
      merchant: rc.derived?.merchant || rc.data?.merchant || 'Receipt',
      total: rc.derived?.total || rc.data?.total || 0,
      purchased_at: rc.derived?.date_str || '',
      currency: rc.derived?.currency || rc.data?.currency || 'USD'
    }));
    return cached as any;
  }, [receipts]);

  // Helper: filter out ids queued for deletion (outbox) so they stay hidden until server confirms
  const filterQueuedDeletes = useCallback((list: Receipt[]): Receipt[] => {
    if (!outboxDeletes || outboxDeletes.length === 0) return list;
    const exclude = new Set(outboxDeletes);
    return list.filter(r => !exclude.has(r.id));
  }, [outboxDeletes]);

  // Load receipts; by default use cache; pass true to force server fetch
  const mergeAndFilter = (serverList: Receipt[]) => {
    const exclude = new Set(pendingRef.current.map(p => p.id));
    if (serverList.length === 0) {
      const cached = filterQueuedDeletes(buildFromCache());
      return exclude.size ? cached.filter(r => !exclude.has(r.id)) : cached;
    }
    const map = new Map<number, Receipt>();
    for (const r of serverList) map.set(Number(r.id), r);
    for (const r of itemsRef.current || []) if (!map.has(Number(r.id))) map.set(Number(r.id), r);
    let merged = Array.from(map.values());
    merged = filterQueuedDeletes(merged);
    return exclude.size ? merged.filter(r => !exclude.has(r.id)) : merged;
  };

  const persistServerPayloads = async (rawList: any[]) => {
    try {
      const tasks: Promise<any>[] = [];
      for (const rec of rawList) if (rec && (rec.data || rec.derived)) tasks.push(setReceiptData?.(Number(rec.id), rec.data, rec.derived));
      if (tasks.length) await Promise.allSettled(tasks);
    } catch {/* ignore */}
  };

  const load = async (forceRemote: boolean = false, opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      if (!forceRemote) {
        const cached = filterQueuedDeletes(buildFromCache());
        const exclude = new Set(pendingRef.current.map(p => p.id));
        setItems(exclude.size ? cached.filter(r => !exclude.has(r.id)) : cached);
        setFirstLoadComplete(true);
        return;
      }
      const r = await fetchWithAuth(`${baseUrl.replace(/\/$/, '')}/api/v1/receipts`, { headers: authHeaders });
      const body = await r.json();
      if (!r.ok) throw body;
      let list: any[] = Array.isArray(body) ? body : (body.results || body.items || []);
      if (!Array.isArray(list)) list = [];
      const normalized = list.map(rec => ({
        ...rec,
        id: Number(rec.id),
        merchant: rec?.derived?.merchant || rec?.data?.merchant || rec?.merchant,
        total: rec?.derived?.total || rec?.data?.total || rec?.total,
        purchased_at: rec?.derived?.date_str || rec?.data?.date || rec?.date_str || rec?.purchased_at,
        currency: rec?.derived?.currency || rec?.data?.currency || rec?.currency || 'USD'
      })) as Receipt[];
      setItems(mergeAndFilter(normalized));
      await persistServerPayloads(list);
      setFirstLoadComplete(true);
    } catch (e: any) {
      const cached = filterQueuedDeletes(buildFromCache());
      setItems(cached);
      setFirstLoadComplete(true);
      console.warn('Receipts load failed, using offline cache:', e?.detail || e?.message || e);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  };
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
  }, [ARCHIVE_KEY]);
  const persistArchived = React.useCallback(async (ids: Set<number>) => {
    try { await AsyncStorage.setItem(ARCHIVE_KEY, JSON.stringify(Array.from(ids))); } catch {/* ignore */}
  }, []);

  // Header chip similar to Analytics headerRight
  const HeaderRight = React.useCallback(() => {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 12 }}>
        {isOnline === false && (
          <View style={styles.hdrChipOffline}>
            <Ionicons name="cloud-offline" size={14} color="#fff" />
            <Text style={styles.hdrChipText}>Offline</Text>
          </View>
        )}
        {isOnline === true && (
          <View style={styles.hdrChipOnline}>
            <Ionicons name="cloud-done" size={14} color="#065f46" />
            <Text style={[styles.hdrChipText, { color: '#065f46' }]}>Online</Text>
          </View>
        )}
        {outboxDeletes?.length > 0 && (
          <View style={styles.hdrChipQueued}>
            <Ionicons name="swap-vertical" size={14} color="#fff" />
            <Text style={styles.hdrChipText}>Queued {outboxDeletes.length}</Text>
          </View>
        )}
        {archivedIds.size > 0 && (
          <Pressable
            onPress={() => setArchivedOpen(true)}
            style={[styles.archivedChip, { marginBottom: 0, marginLeft: 8 }]}
            accessibilityRole="button"
            accessibilityLabel={`Open archived receipts (${archivedIds.size})`}
          >
            <Ionicons name="archive" size={16} color="#fff" />
            <Text style={styles.archivedChipText}>Archived ({archivedIds.size})</Text>
          </Pressable>
        )}
      </View>
    );
  }, [isOnline, archivedIds.size, outboxDeletes?.length]);

  useLayoutEffect(() => {
    navigation?.setOptions?.({ headerTitle: 'Receipts', headerRight: HeaderRight });
  }, [navigation, HeaderRight]);

  

  // Initial: server-first when online, else cache-first; and listen for reconnect to sync
  useEffect(() => {
    let unsub: any;
    (async () => {
      try {
        const state = await NetInfo.fetch();
        const online = !!state.isConnected;
        setIsOnline(online);
        isOnlineRef.current = online; // keep ref in sync for later deferred actions (delete timers)
        if (online) await load(true);
        else await load(false);
      } catch {
        await load(false);
      }
      const processOutboxDeletes = async () => {
        for (const rid of outboxDeletes || []) {
          try {
            const r = await fetchWithAuth(`${baseUrl.replace(/\/$/, '')}/api/v1/receipts/${rid}`, { method: 'DELETE', headers: authHeaders });
            if (r.status === 204 || r.status === 200 || r.status === 404) await dequeueDelete(rid);
          } catch { /* keep in outbox */ }
        }
      };
      unsub = NetInfo.addEventListener(s => {
        const prev = isOnline;
        const now = !!s.isConnected;
        setIsOnline(now);
        isOnlineRef.current = now;
        if (prev === false && now === true) {
          load(true, { silent: true });
          processOutboxDeletes();
        }
      });
    })();
    return () => { try { unsub?.(); } catch {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  // Auto-process queued deletions whenever we are online and queue changes
  useEffect(() => {
    if (!isOnline) return;
    if (!outboxDeletes || outboxDeletes.length === 0) return;
    (async () => {
      for (const rid of outboxDeletes) {
        try {
          const r = await fetchWithAuth(`${baseUrl.replace(/\/$/, '')}/api/v1/receipts/${rid}`, { method: 'DELETE', headers: authHeaders });
          if (r.status === 204 || r.status === 200 || r.status === 404) {
            await dequeueDelete(rid);
          }
        } catch {/* keep for next attempt */}
      }
      // Refresh list silently after attempts
      load(true, { silent: true });
    })();
  }, [isOnline, outboxDeletes, baseUrl, authHeaders, fetchWithAuth, dequeueDelete]);
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

  // Restore delayed finalize with undo window
  const scheduleDeletion = (id: number) => {
    let snapshot = itemsRef.current;
    if (!snapshot || snapshot.length === 0) snapshot = buildFromCache();
    let target = snapshot.find(x => x.id === id);
    if (!target) {
      const rLocal = receipts[String(id)];
      if (!rLocal) return;
      target = {
        id: rLocal.id,
        merchant: rLocal.derived?.merchant || rLocal.data?.merchant || 'Receipt',
        total: rLocal.derived?.total || rLocal.data?.total || 0,
        purchased_at: rLocal.derived?.date_str || ''
      };
    }
    const originalIndex = Math.max(0, snapshot.findIndex(x => x.id === id));
    // Optimistic remove
    try { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); } catch {}
    setItems(prev => prev.filter(x => x.id !== id));
    startProgress();
    const timer = setTimeout(async () => {
      let ok = false;
      const online = (isOnlineRef.current === true) || (isOnline === true);
      if (online) {
        try {
          const r = await fetchWithAuth(`${baseUrl.replace(/\/$/, '')}/api/v1/receipts/${id}`, { method: 'DELETE', headers: authHeaders });
          if (r.status === 204 || r.status === 200 || r.status === 404) {
            ok = true;
            await removeReceipt(id);
          } else {
            const body = await r.text();
            Alert.alert('Error', body || 'Failed to delete (restoring)');
          }
        } catch (e: any) {
          const msg = e?.message || '';
            const isNetFail = /Network request failed|Failed to fetch|ECONNREFUSED|ENETUNREACH/i.test(msg);
            if (isNetFail) {
              ok = true;
              await queueDelete(id);
              await removeReceipt(id);
            } else {
              Alert.alert('Error', msg || 'Failed to delete (restoring)');
            }
        }
      } else {
        ok = true;
        await queueDelete(id);
        await removeReceipt(id);
      }
      if (ok) {
        // Refresh silently (remote if online, local if offline)
        load(online, { silent: true });
      } else {
        // Restore at original position
        const filtered = itemsRef.current.filter(x => x.id !== id);
        const idx = Math.min(originalIndex >= 0 ? originalIndex : filtered.length, filtered.length);
        const next = [...filtered.slice(0, idx), target, ...filtered.slice(idx)];
        setItems(next);
      }
      setPending(pendingRef.current.filter(x => x.id !== id));
    }, UNDO_MS);
    setPending([...pendingRef.current.filter(p => p.id !== id), { id, merchant: target.merchant || 'Receipt', timer, item: target, index: originalIndex } as any]);
    // Remove from archive set immediately so undo resurrects in main list if needed
    setArchivedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev); next.delete(id); persistArchived(next); return next;
    });
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
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
    const entry: any = pendingRef.current.find(x => x.id === id);
    if (entry) clearTimeout(entry.timer);
    setPending(pendingRef.current.filter(x => x.id !== id));
    if (entry?.item) {
      // Deduplicate before restoring and insert at original index to preserve order
      const filtered = itemsRef.current.filter(x => x.id !== id);
      const idx = Math.min(typeof entry.index === 'number' ? entry.index : filtered.length, filtered.length);
      const next = [...filtered.slice(0, idx), entry.item, ...filtered.slice(idx)];
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
      // Use a unique jti per ingest to avoid replay collisions (second-level timestamp can collide)
      const rand = Math.random().toString(36).slice(2);
      const token = await mintGrantJWT(deviceId, privB64, { sub: '1', scope: ['receipt:ingest'], jti: `${now}-${rand}`, iat: now, nbf: now - 5, exp: now + 180 });
      const resp: any = await api.ingestReceipt({ token, dek_wrap_srv, year: new Date().getFullYear(), month: new Date().getMonth() + 1, category: 'Uncategorized', image, authHeaders });
      if (resp.receipt_id) {
        const merch = resp?.derived?.merchant || resp?.data?.merchant || 'Receipt';
        const total = resp?.derived?.total || resp?.data?.total || '';
        const cur = resp?.derived?.currency || resp?.data?.currency || 'USD';
        // Show modal instead of alert
        const dateStr = String(resp?.derived?.date_str || resp?.data?.date || '').split('T')[0];
        setIngestConfirm({ id: Number(resp.receipt_id), merchant: merch, total, currency: cur, imageUri: uri, date: dateStr });
        await setReceiptDekWrap(resp.receipt_id, dek_wrap_srv);
        await setReceiptData(resp.receipt_id, resp.data, resp.derived);
        // Show immediately by injecting the new item into UI
        const newItem: Receipt = {
          id: Number(resp.receipt_id),
          merchant: merch,
          total: typeof total === 'number' ? total : Number(total) || 0,
          purchased_at: String(resp?.derived?.date_str || resp?.data?.date || ''),
          currency: cur,
        } as any;
        setItems(prev => {
          const filtered = prev.filter(x => x.id !== newItem.id);
          return [newItem, ...filtered];
        });
        // Then reconcile with server; do a brief delay to let server commit and return updated list
        // Try to show server-confirmed list; retry once if needed for eventual consistency
        try { await new Promise(r => setTimeout(r, 600)); } catch {}
        await load(true); // non-silent to ensure visible refresh
        // If the newly created receipt isn't present yet, retry once after a short delay
        try {
          const present = (itemsRef.current || []).some(x => Number(x.id) === Number(resp.receipt_id));
          if (!present) {
            await new Promise(r => setTimeout(r, 1000));
            await load(true);
          }
        } catch {}
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
    // Render a FlatList even when empty so pull-to-refresh works
    content = (
      <FlatList
        data={[] as any[]}
        refreshing={loading}
        onRefresh={() => load(true)}
        keyExtractor={(x, i) => String(i)}
        renderItem={() => null as any}
        contentContainerStyle={[styles.listContent, { flex: 1 }]}
        ListEmptyComponent={(
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={72} color="#94a3b8" />
            <Text style={styles.emptyTitle}>No receipts yet</Text>
            <Text style={styles.emptyText}>Pull to refresh or tap + to ingest.</Text>
            <View style={{ marginTop: 12 }}>
              <Pressable onPress={() => load(true)} style={styles.refreshButton}>
                <Text style={styles.refreshButtonText}>Refresh</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    );
  } else {
    const active = items.filter(x => !archivedIds.has(x.id));
    if (active.length === 0 && items.length > 0) {
      content = (
        <View style={styles.empty}> 
          <Ionicons name="archive-outline" size={72} color="#94a3b8" />
          <Text style={styles.emptyTitle}>All receipts are archived</Text>
          <Text style={styles.emptyText}>Open archived or unarchive to see them here.</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <Pressable onPress={() => setArchivedOpen(true)} style={styles.undoBtn}><Text style={styles.undoBtnText}>View archived</Text></Pressable>
            <Pressable onPress={() => { const next = new Set<number>(); setArchivedIds(next); persistArchived(next); }} style={[styles.undoBtn, { backgroundColor: '#0ea5e9' }]}><Text style={styles.undoBtnText}>Unarchive all</Text></Pressable>
          </View>
        </View>
      );
    } else {
      content = (
        <FlatList
          data={active}
          refreshing={loading}
          onRefresh={() => load(true)}
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

      {/* Ingest confirmation modal */}
      <Modal visible={!!ingestConfirm} animationType="fade" transparent onRequestClose={() => setIngestConfirm(null)}>
        <View style={styles.modalBackdrop}>
          {/* Separate backdrop hit layer to avoid closing on scroll inside sheet */}
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setIngestConfirm(null)} accessibilityLabel="Dismiss ingest modal" />
          <SafeAreaView style={[styles.modalSheet, { height: '95%', maxHeight: '95%' }]}> 
                {ingestConfirm && (
                  <View style={{ flex: 1 }}>
                    <View style={styles.modalHeader}>
                      <Text style={styles.modalTitle}>Ingest Complete</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        <PillButton title="Detail" accessibilityLabel="View receipt detail" onPress={() => { const id = ingestConfirm.id; navigation.navigate('ReceiptDetail', { id }); setIngestConfirm(null); }} color="#0f766e" />
                        <Pressable onPress={() => setIngestConfirm(null)} accessibilityLabel="Close ingest confirmation">
                          <Text style={styles.modalClose}>Close</Text>
                        </Pressable>
                      </View>
                    </View>
                    <View style={[styles.modalBody, { flex: 1 }]}> 
                      <Text style={{ fontSize: 16, fontWeight: '600', marginBottom: 8 }}>#{ingestConfirm.id} • {ingestConfirm.merchant}</Text>
                      <Text style={{ color: '#475569', marginBottom: 12 }}>Total: {ingestConfirm.currency} {String(ingestConfirm.total)}</Text>
                      <View style={{ height: 260, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e2e8f0', borderRadius: 12, overflow: 'hidden', backgroundColor: '#f8fafc', marginBottom: 16 }}>
                        <Image source={{ uri: ingestConfirm.imageUri }} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
                      </View>
                      {/* Inline quick edit form */}
                      <ScrollView
                        style={{ flex: 1 }}
                        contentContainerStyle={{ paddingBottom: 24 }}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        scrollEventThrottle={16}
                      >
                        <View style={styles.editorSection}>
                          <View style={styles.editorHeaderRow}>
                            <Text style={styles.editorSectionTitle}>Receipt Meta</Text>
                            <Pressable onPress={toggleExpandFull} style={styles.editorToggleBtn}>
                              <Text style={styles.editorToggleText}>{expandFull ? 'Collapse' : 'Expand Full'}</Text>
                            </Pressable>
                          </View>
                          <View style={styles.fieldRow}> 
                            <Text style={styles.fieldLabel}>Merchant</Text>
                            <TextInput style={styles.inlineInput} placeholder="Merchant" value={ingestEdit.merchant} onChangeText={(t) => setIngestEdit(p => ({ ...p, merchant: t }))} />
                          </View>
                          <View style={styles.fieldInlineGroup}> 
                            <View style={{ flex: 1 }}>
                              <Text style={styles.fieldLabel}>Total</Text>
                              <TextInput style={styles.inlineInput} placeholder="Total" keyboardType="decimal-pad" value={ingestEdit.total} onChangeText={(t) => setIngestEdit(p => ({ ...p, total: t }))} />
                            </View>
                            <View style={{ width: 100 }}>
                              <Text style={styles.fieldLabel}>Currency</Text>
                              <TextInput style={styles.inlineInput} placeholder="Cur" autoCapitalize="characters" value={ingestEdit.currency} onChangeText={(t) => setIngestEdit(p => ({ ...p, currency: t }))} />
                            </View>
                          </View>
                          <View style={styles.fieldRow}> 
                            <Text style={styles.fieldLabel}>Date</Text>
                            <Pressable onPress={() => setShowDatePicker(s => !s)} style={[styles.inlineInput, { justifyContent: 'center' }]} accessibilityLabel="Toggle calendar">
                              <Text style={{ color: ingestEdit.date ? '#0f172a' : '#94a3b8' }}>{ingestEdit.date || 'Select date'}</Text>
                            </Pressable>
                            {showDatePicker && (
                              <View style={{ marginTop: 8 }}>
                                <InlineCalendarPicker
                                  value={ingestEdit.date}
                                  year={calendarYear}
                                  month={calendarMonth}
                                  onNavigate={(y,m) => { setCalendarYear(y); setCalendarMonth(m); }}
                                  onChange={(next) => { setIngestEdit(p => ({ ...p, date: next })); setShowDatePicker(false); }}
                                />
                              </View>
                            )}
                          </View>
                        </View>
                        {expandFull && (
                          <View style={styles.editorSection}>
                            <Text style={styles.editorSectionTitle}>Breakdown</Text>
                            <View style={styles.fieldInlineGroup}> 
                              <View style={{ flex: 1 }}>
                                <Text style={styles.fieldLabel}>Subtotal</Text>
                                <TextInput style={styles.inlineInput} placeholder="0.00" keyboardType="decimal-pad" value={ingestEdit.subtotal} onChangeText={(t) => setIngestEdit(p => ({ ...p, subtotal: t }))} />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.fieldLabel}>Tax</Text>
                                <TextInput style={styles.inlineInput} placeholder="0.00" keyboardType="decimal-pad" value={ingestEdit.tax_total} onChangeText={(t) => setIngestEdit(p => ({ ...p, tax_total: t }))} />
                              </View>
                            </View>
                            <View style={styles.fieldInlineGroup}> 
                              <View style={{ flex: 1 }}>
                                <Text style={styles.fieldLabel}>Discounts</Text>
                                <TextInput style={styles.inlineInput} placeholder="0.00" keyboardType="decimal-pad" value={ingestEdit.discount_total} onChangeText={(t) => setIngestEdit(p => ({ ...p, discount_total: t }))} />
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.fieldLabel}>Fees</Text>
                                <TextInput style={styles.inlineInput} placeholder="0.00" keyboardType="decimal-pad" value={ingestEdit.fees_total} onChangeText={(t) => setIngestEdit(p => ({ ...p, fees_total: t }))} />
                              </View>
                            </View>
                            <View style={styles.fieldRow}> 
                              <Text style={styles.fieldLabel}>Tip</Text>
                              <TextInput style={styles.inlineInput} placeholder="0.00" keyboardType="decimal-pad" value={ingestEdit.tip_total} onChangeText={(t) => setIngestEdit(p => ({ ...p, tip_total: t }))} />
                            </View>
                          </View>
                        )}
                        {expandFull && (
                          <View style={styles.editorSection}>
                            <Text style={styles.editorSectionTitle}>Items</Text>
                                  {ingestItems.map((it, idx) => {
                                const itemKey = it.id == null ? `tmp-${idx}` : String(it.id);
                                return (
                              <View key={itemKey} style={styles.itemEditBlock}> 
                                <TextInput style={[styles.inlineInput, styles.itemDescInput]} placeholder="Description" value={it.desc} onChangeText={(t) => updateIngestItem(idx, { desc: t })} />
                                <View style={styles.fieldInlineGroup}> 
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.fieldLabel}>Qty</Text>
                                    <TextInput style={styles.inlineInput} placeholder="1" keyboardType="decimal-pad" value={it.qty} onChangeText={(t) => updateIngestItem(idx, { qty: t })} />
                                  </View>
                                  <View style={{ flex: 1 }}>
                                    <Text style={styles.fieldLabel}>Price</Text>
                                    <TextInput style={styles.inlineInput} placeholder="0.00" keyboardType="decimal-pad" value={it.price} onChangeText={(t) => updateIngestItem(idx, { price: t })} />
                                  </View>
                                </View>
                              </View>
                            );})}
                            <PillButton
                              title="Add Item"
                              accessibilityLabel="Add item"
                              onPress={() => setIngestItems(arr => [...arr, { desc: '', qty: '1', price: '0' }])}
                              color="#4f46e5"
                              style={{ marginTop: 8 }}
                            />
                          </View>
                        )}
                        <PillButton title="Save Changes" accessibilityLabel="Save inline edit" onPress={quickSave} color="#4f46e5" style={{ marginTop: 4 }} />
                      </ScrollView>
                      {/* Action buttons moved to header; bottom row removed for cleaner editor space */}
                    </View>
                  </View>
                )}
          </SafeAreaView>
        </View>
      </Modal>

      {/* Undo toast (show most recent pending deletion) */}
      {pending.length > 0 && (() => {
        const last = pending.at(-1);
        if (!last) return null;
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
  hdrChipOffline: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#ef4444', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999 },
  hdrChipOnline: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#a7f3d0', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: '#34d399', marginLeft: 0 },
  hdrChipQueued: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f59e0b', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, marginLeft: 8 },
  hdrChipText: { color: '#fff', fontWeight: '600', marginLeft: 6 },
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
  avatarText: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
  skelLine: { height: 12, backgroundColor: '#cbd5e1', borderRadius: 6, width: '60%' },
  fab: {
    backgroundColor: '#4f46e5', height: 56, width: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 3 },
    elevation: 8, zIndex: 100,
  },
  fabStackWrap: { position: 'absolute', right: 20, bottom: 28, alignItems: 'center', zIndex: 100, pointerEvents: 'box-none' },
  fabSmallWrap: { position: 'absolute', right: 0, bottom: 0 },
  fabSmall: { height: 48, width: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 5, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: 12, fontSize: 18, fontWeight: '700', color: '#334155' },
  emptyText: { marginTop: 6, color: '#64748b' },
  refreshButton: { alignSelf: 'center', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#4f46e5', borderRadius: 6 },
  refreshButtonText: { color: '#fff', fontWeight: '700' },
  swipeAction: { flex: 1, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'flex-end', marginVertical: 6 },
  swipeActionRightWrap: { flex: 1, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'flex-end', marginVertical: 6 },
  swipeActionLeftWrap: { flex: 1, backgroundColor: 'transparent', justifyContent: 'center', alignItems: 'flex-start', marginVertical: 6 },
  swipePillDanger: { backgroundColor: '#ef4444', height: 44, minWidth: 56, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', alignItems: 'center', marginRight: 12,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  swipePillPrimary: { backgroundColor: '#3b82f6', height: 44, minWidth: 56, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', alignItems: 'center', marginLeft: 12,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  swipePillNeutral: { backgroundColor: '#64748b', height: 44, minWidth: 56, paddingHorizontal: 16, borderRadius: 999, justifyContent: 'center', alignItems: 'center', marginLeft: 12,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  undoBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#1f2937', zIndex: 10 },
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
  confirmBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  confirmBtnText: { color: '#fff', fontWeight: '600' },
  inlineInput: { backgroundColor: '#f1f5f9', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  inlineSaveBtn: { backgroundColor: '#4f46e5', paddingVertical: 12, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  itemEditBlock: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, backgroundColor: '#f8fafc' },
  removeItemBtn: { marginTop: 8, backgroundColor: '#ef4444', paddingVertical: 8, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  addItemBtn: { backgroundColor: '#0f766e', paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  removeItemBtnText: { color: '#fff', fontWeight: '600' },
  addItemBtnText: { color: '#fff', fontWeight: '600' },
  editorSection: { marginBottom: 18, padding: 14, backgroundColor: '#ffffff', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#e2e8f0',
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  editorHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  editorSectionTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  editorToggleBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  editorToggleText: { color: '#4f46e5', fontWeight: '600' },
  fieldRow: { marginBottom: 12 },
  fieldInlineGroup: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: '#475569', marginBottom: 4 },
  editorSaveBtn: { marginTop: 4 },
  editorSaveBtnText: { color: '#fff', fontWeight: '700' },
  itemDescInput: { marginBottom: 10 },
  hdrActionBtn: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#0f766e', borderRadius: 8 },
  hdrActionBtnText: { color: '#ffffff', fontWeight: '600', fontSize: 13 },
  hdrActionBtnClose: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#64748b', borderRadius: 8 },
  hdrDetailBtnSmall: { paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#0f766e', borderRadius: 6 },
  // Unified modal button styles
  modalBtnPrimary: { backgroundColor: '#4f46e5', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  modalBtnSecondary: { backgroundColor: '#0f766e', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  modalBtnGhost: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
  modalBtnText: { color: '#ffffff', fontWeight: '600', fontSize: 14 },
  modalBtnGhostText: { color: '#4f46e5', fontWeight: '600', fontSize: 14 },
});
