import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAppState } from '../context/AppState';
import { FinanceKitClient, generateEd25519Keypair } from '@financekit/rn-sdk';

export default function SignInScreen() {
  const { baseUrl, setTokens, setUsername, setPassword, setDeviceId, setPubB64, setPrivB64, setPem, setRegistered, fetchWithAuth } = useAppState() as any;
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const onSignIn = async () => {
    try {
      const res = await fetch(`${baseUrl}/api/v1/auth/token`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user, password: pass })
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || res.statusText);
      }
  const j = await res.json();
  await setTokens(j.access, j.refresh);
      setUsername(user);
      setPassword(pass);
      // Auto device setup
  const client = new FinanceKitClient(baseUrl, fetchWithAuth);
      const rand = new Uint8Array(8); crypto.getRandomValues(rand);
      const hex = Array.from(rand).map(b => b.toString(16).padStart(2, '0')).join('');
      const deviceId = `device-${hex}`;
      const kp = await generateEd25519Keypair();
      await Promise.all([
        setDeviceId?.(deviceId),
        setPubB64?.(kp.publicKeyB64),
        setPrivB64?.(kp.privateKeyB64),
      ]);
  const authHeaders = { Authorization: `Bearer ${j.access}` };
  const pk = await client.getServerPublicKey(authHeaders);
      await setPem?.(pk.pem);
  await client.registerDevice(deviceId, kp.publicKeyB64, authHeaders);
      await setRegistered?.(true);
  nav.reset({ index: 0, routes: [{ name: 'MainTabs' }] });
    } catch (e: any) {
      Alert.alert('Sign in failed', e?.message || 'Unknown error');
    }
  };

  return (
    <View style={styles.c}>
      <Text style={styles.title}>Sign in</Text>
      <TextInput placeholder="Username" value={user} onChangeText={setUser} style={styles.input} autoCapitalize="none" />
      <TextInput placeholder="Password" value={pass} onChangeText={setPass} style={styles.input} secureTextEntry />
      <Pressable onPress={onSignIn} style={styles.btn}><Text style={styles.btnText}>Sign in</Text></Pressable>
      <Pressable onPress={() => nav.navigate('SignUp')} style={styles.link}><Text style={styles.linkText}>New here? Create an account</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, padding: 16, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 12 },
  input: { backgroundColor: '#fff', padding: 10, borderRadius: 8, marginBottom: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: '#cbd5e1' },
  btn: { backgroundColor: '#4f46e5', padding: 12, borderRadius: 8, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700' },
  link: { marginTop: 10, alignItems: 'center' },
  linkText: { color: '#4f46e5', fontWeight: '600' },
});
