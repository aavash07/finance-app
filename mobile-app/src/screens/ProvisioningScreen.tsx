import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAppState } from '../context/AppState';
import { FinanceKitClient, generateEd25519Keypair } from '@financekit/rn-sdk';

export default function ProvisioningScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { baseUrl, fetchWithAuth, setDeviceId, setPrivB64, setPubB64, setPem, setRegistered, accessToken } = useAppState() as any;
  const [step, setStep] = useState<string>('Preparing');
  const [err, setErr] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const client = useMemo(() => new FinanceKitClient(baseUrl, fetchWithAuth), [baseUrl, fetchWithAuth]);

  const withMinimum = async (fn: () => Promise<void> | void, ms: number) => {
    const start = Date.now();
    await Promise.resolve(fn());
    const elapsed = Date.now() - start;
    if (elapsed < ms) await new Promise(res => setTimeout(res, ms - elapsed));
  };

  const provision = async () => {
    setErr(null);
    try {
      setStep('Generating device keys');
      await withMinimum(async () => {
        const rand = new Uint8Array(8); crypto.getRandomValues(rand);
        const hex = Array.from(rand).map(b => b.toString(16).padStart(2, '0')).join('');
        const deviceId = `device-${hex}`;
        const kp = await generateEd25519Keypair();
        await Promise.all([
          setDeviceId?.(deviceId),
          setPubB64?.(kp.publicKeyB64),
          setPrivB64?.(kp.privateKeyB64),
        ]);
        // Stash on closure for next steps
        (provision as any)._deviceId = deviceId;
        (provision as any)._pubKey = kp.publicKeyB64;
      }, 700);
      setProgress(0.25);

      setStep('Fetching server key');
      const authHeaders = accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined;
      await withMinimum(async () => {
        const pk = await client.getServerPublicKey(authHeaders);
        await setPem?.(pk.pem);
      }, 700);
      setProgress(0.55);

      setStep('Registering device');
      const deviceId = (provision as any)._deviceId as string;
      const pubKey = (provision as any)._pubKey as string;
      await withMinimum(async () => {
        await client.registerDevice(deviceId, pubKey, authHeaders);
      }, 700);
      setProgress(0.85);

      setStep('Finalizing');
      await withMinimum(async () => {
        await setRegistered?.(true);
      }, 400);
      setProgress(1);
      // Small pause to let users see completion
      await new Promise(res => setTimeout(res, 250));
      nav.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    } catch (e: any) {
      const msg = e?.detail || e?.message || 'Provisioning failed';
      setErr(String(msg));
    }
  };

  useEffect(() => { provision(); }, []);

  return (
    <View style={styles.c}>
      <ActivityIndicator size="large" color="#4f46e5" />
      <Text style={styles.h}>Setting up your device…</Text>
      <Text style={styles.step}>{step}</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(1, progress)) * 100}%` }]} />
      </View>
      <Text style={styles.percent}>{Math.round(progress * 100)}%</Text>
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
  errBox: { marginTop: 16, alignItems: 'center' },
  err: { color: '#dc2626', marginBottom: 8, textAlign: 'center' },
  retry: { backgroundColor: '#4f46e5', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, marginTop: 6 },
  retryText: { color: '#fff', fontWeight: '700' },
  back: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, marginTop: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: '#cbd5e1' },
  backText: { color: '#334155', fontWeight: '600' },
});
