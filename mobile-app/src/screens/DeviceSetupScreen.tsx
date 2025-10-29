import React, { useEffect, useState } from 'react';
import { View, Text, Button, StyleSheet, Alert } from 'react-native';
import { FinanceKitClient, generateEd25519Keypair } from '@financekit/rn-sdk';
import { useAppState } from '../context/AppState';

export default function DeviceSetupScreen() {
  const { baseUrl, authHeaders, deviceId, pubB64, privB64, setPubB64, setPrivB64, save, setPem, registered, setRegistered, pem } = useAppState();
  const [busy, setBusy] = useState(false);
  const api = new FinanceKitClient(baseUrl);

  const onGen = async () => {
    const { publicKeyB64, privateKeyB64 } = await generateEd25519Keypair();
    setPubB64(publicKeyB64); setPrivB64(privateKeyB64);
    await save({ pubB64: publicKeyB64, privB64: privateKeyB64 });
  };

  const onRegister = async () => {
    if (!pubB64) return Alert.alert('Missing key', 'Generate a key first');
    setBusy(true);
    try {
      await api.registerDevice(deviceId, pubB64, authHeaders);
      Alert.alert('Success', 'Device registered');
      await setRegistered(true);
    } catch (e: any) {
      Alert.alert('Error', e?.detail || 'Register failed');
    } finally { setBusy(false); }
  };

  const onFetchPem = async () => {
    setBusy(true);
    try {
      const { pem } = await api.getServerPublicKey(authHeaders);
      setPem(pem); await save({ pem });
      Alert.alert('Fetched', 'Server RSA public key saved');
    } catch (e: any) {
      Alert.alert('Error', e?.detail || 'Fetch failed');
    } finally { setBusy(false); }
  };

  const ensureSetup = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // 1) Keys
      if (!pubB64 || !privB64) {
        const { publicKeyB64, privateKeyB64 } = await generateEd25519Keypair();
        setPubB64(publicKeyB64); setPrivB64(privateKeyB64);
        await save({ pubB64: publicKeyB64, privB64: privateKeyB64 });
      }
      // 2) Register (idempotent server-side)
      if (!registered && (pubB64 || privB64)) {
        await api.registerDevice(deviceId, pubB64 || '', authHeaders);
        await setRegistered(true);
      }
      // 3) Fetch server PEM if missing
      if (!pem) {
        const { pem: fetched } = await api.getServerPublicKey(authHeaders);
        setPem(fetched); await save({ pem: fetched });
      }
    } catch (e: any) {
      // Silent here to avoid noisy alerts on auto-run; users can press buttons for detail
      console.warn('ensureSetup error', e?.detail || e?.message || e);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void ensureSetup(); }, []);

  return (
    <View style={styles.c}>
      <Text style={styles.t}>Device Setup</Text>
      <View style={styles.row}><Button title="Ensure Setup" onPress={ensureSetup} disabled={busy} /></View>
      <View style={styles.row}><Button title="Generate Keypair" onPress={onGen} disabled={busy} /></View>
      <View style={styles.row}><Button title="Register Device" onPress={onRegister} disabled={busy || !pubB64} /></View>
      <View style={styles.row}><Button title="Fetch Server Key" onPress={onFetchPem} disabled={busy} /></View>
      <Text>Device ID: {deviceId}</Text>
      <Text>Keys: {pubB64 && privB64 ? 'Present' : 'Missing'}</Text>
      <Text>Registered: {registered ? 'Yes' : 'No'}</Text>
      <Text>Server Key: {pem ? 'Present' : 'Missing'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { padding: 16 },
  t: { fontSize: 22, fontWeight: 'bold', marginBottom: 12 },
  row: { marginVertical: 6 },
});
