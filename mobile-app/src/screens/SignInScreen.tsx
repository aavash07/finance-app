import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { useAppState } from '../context/AppState';
// No direct provisioning here; we navigate to a provisioning screen after auth

export default function SignInScreen() {
  const { baseUrl, setTokens, setUsername, setPassword, save } = useAppState() as any;
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const parseErrorMessage = async (res: Response): Promise<string> => {
    let message = `HTTP ${res.status}`;
    try {
      const text = await res.text();
      if (!text) return message;
      try {
        const j = JSON.parse(text);
        const detail: string | undefined = j.detail || j.error || j.message;
        if (detail) {
          if (detail.includes('No active account')) {
            return 'Incorrect username or password (or account not created yet). Tap "Create an account" first.';
          }
          return detail;
        }
        if (j.code) return `${j.code}: ${detail || ''}`.trim();
        return message;
      } catch {
        if (text.length < 160) return text;
      }
    } catch {}
    return message;
  };

  const onSignIn = async () => {
    const url = `${baseUrl.replace(/\/$/, '')}/api/v1/auth/token`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.trim(), password: pass })
      });
      if (!res.ok) throw new Error(await parseErrorMessage(res));
      const j = await res.json();
      if (!j?.access) throw new Error('Malformed auth response');
      const uTrim = user.trim();
      await setTokens(j.access, j.refresh);
      setUsername(uTrim);
      setPassword(pass);
      // Persist credentials so Basic fallback & refresh remain valid after restart
      await save({ username: uTrim, password: pass });
      nav.reset({ index: 0, routes: [{ name: 'Provisioning', params: { fresh: true } }] });
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
      <Text style={styles.hint}>Tip: If you see "No active account" just create one first on the sign up screen.</Text>
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
  hint: { marginTop: 14, fontSize: 12, color: '#64748b', textAlign: 'center' },
});
