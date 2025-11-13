import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAppState } from '../context/AppState';
import { FinanceKitClient, generateEd25519Keypair } from '@financekit/rn-sdk';

import type { RouteProp } from '@react-navigation/native';

export default function ProvisioningScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Provisioning'>>();
  const fresh = route.params?.fresh;
  const { baseUrl, fetchWithAuth, setDeviceId, setPrivB64, setPubB64, setPem, setRegistered, accessToken } = useAppState() as any;
  const [step, setStep] = useState<string>('Preparing');
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [statuses, setStatuses] = useState<{ label: string; state: 'pending'|'ok'|'fail'}[]>([
    { label: 'Generate device keypair', state: 'pending' },
    { label: 'Fetch server public key', state: 'pending' },
    { label: 'Register device', state: 'pending' },
    { label: 'Persist settings', state: 'pending' },
  ]);
  const client = useMemo(() => new FinanceKitClient(baseUrl, fetchWithAuth), [baseUrl, fetchWithAuth]);

  const withMinimum = async (fn: () => Promise<void> | void, ms: number) => {
    const start = Date.now();
    await Promise.resolve(fn());
    const elapsed = Date.now() - start;
    if (elapsed < ms) await new Promise(res => setTimeout(res, ms - elapsed));
  };

  const mark = (i: number, state: 'ok'|'fail') => {
    setStatuses(prev => prev.map((s, idx) => idx === i ? { ...s, state } : s));
  };

  const provision = async () => {
    setErr(null);
    setCurrentIdx(0);
    setStatuses(prev => prev.map(p => ({ ...p, state: 'pending' })));
    let deviceId: string = '';
    let pubKey: string = '';
    try {
      // Step 1: generate device keys
      setStep('Generating device keys');
      await withMinimum(async () => {
        const rand = new Uint8Array(8); crypto.getRandomValues(rand);
        const hex = Array.from(rand).map(b => b.toString(16).padStart(2, '0')).join('');
        deviceId = `device-${hex}`;
        const kp = await generateEd25519Keypair();
        pubKey = kp.publicKeyB64;
        await Promise.all([
          setDeviceId?.(deviceId),
          setPubB64?.(kp.publicKeyB64),
          setPrivB64?.(kp.privateKeyB64),
        ]);
      }, 700);
      setProgress(0.25);
      mark(0, 'ok'); setCurrentIdx(1);

      // Step 2: fetch server key
      setStep('Fetching server key');
      const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
      await withMinimum(async () => {
        const pk = await client.getServerPublicKey(authHeaders);
        await setPem?.(pk.pem);
      }, 700);
      setProgress(0.55);
      mark(1, 'ok'); setCurrentIdx(2);

      // Step 3: register device
      setStep('Registering device');
      await withMinimum(async () => {
        await client.registerDevice(deviceId, pubKey, authHeaders);
      }, 700);
      setProgress(0.85);
      mark(2, 'ok'); setCurrentIdx(3);

      // Step 4: finalize
      setStep('Finalizing');
      await withMinimum(async () => {
        await setRegistered?.(true);
      }, 400);
      setProgress(1);
      mark(3, 'ok');
      await new Promise(res => setTimeout(res, 250));
      nav.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    } catch (e: any) {
      const msg = e?.detail || e?.message || 'Provisioning failed';
      setErr(String(msg));
      mark(currentIdx, 'fail');
    }
  };

  useEffect(() => { provision(); }, []);

  return (
    <View style={styles.c}>
      <ActivityIndicator size="large" color="#4f46e5" />
      <Text style={styles.h}>{fresh ? 'Setting up your device…' : 'Ensuring settings…'}</Text>
      <Text style={styles.step}>{step}</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(1, progress)) * 100}%` }]} />
      </View>
      <Text style={styles.percent}>{Math.round(progress * 100)}%</Text>
      <View style={styles.checklist}>
        {statuses.map((s, i) => (
          <View key={s.label} style={styles.checkRow}>
            <View style={styles.iconWrap}>
              {s.state === 'pending' && i === currentIdx ? <ActivityIndicator size={16} color="#4f46e5" /> : null}
              {s.state === 'ok' && <Ionicons name="checkmark-circle" size={20} color="#10b981" />}
              {s.state === 'fail' && <Ionicons name="alert-circle" size={20} color="#dc2626" />}
              {s.state === 'pending' && i !== currentIdx && <Ionicons name="ellipse-outline" size={20} color="#94a3b8" />}
            </View>
            <Text style={[styles.checkText, s.state === 'ok' && styles.checkTextOk, s.state === 'fail' && styles.checkTextFail]}>{s.label}</Text>
          </View>
        ))}
      </View>
      {err && (
        <View style={styles.errBox}>
          <Text style={styles.err}>{err}</Text>
          <Pressable onPress={provision} style={styles.retry}><Text style={styles.retryText}>Retry</Text></Pressable>
          <Pressable onPress={() => nav.reset({ index: 0, routes: [{ name: 'SignIn' }] })} style={styles.back}><Text style={styles.backText}>Back to Sign In</Text></Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  h: { marginTop: 16, fontSize: 18, fontWeight: '700' },
  step: { marginTop: 6, color: '#475569' },
  progressTrack: { width: '80%', height: 10, borderRadius: 8, backgroundColor: '#e5e7eb', marginTop: 16, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#4f46e5' },
  percent: { marginTop: 6, color: '#64748b', fontVariant: ['tabular-nums'] },
  checklist: { marginTop: 18, width: '85%' },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  iconWrap: { width: 28, alignItems: 'center' },
  checkText: { flex: 1, color: '#475569' },
  checkTextOk: { color: '#065f46' },
  checkTextFail: { color: '#dc2626' },
  errBox: { marginTop: 16, alignItems: 'center' },
  err: { color: '#dc2626', marginBottom: 8, textAlign: 'center' },
  retry: { backgroundColor: '#4f46e5', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, marginTop: 6 },
  retryText: { color: '#fff', fontWeight: '700' },
  back: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#cbd5e1' },
  backText: { color: '#334155', fontWeight: '600' },
});
