import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Button, Alert, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AccountStackParamList } from '../navigation/AccountStack';
import { useAppState } from '../context/AppState';

export default function AccountScreen() {
  const { username, password, save, logout } = useAppState();
  const nav = useNavigation<NativeStackNavigationProp<AccountStackParamList>>();
  const [user, setUser] = useState(username);
  const [pass, setPass] = useState(password);
  const [busy, setBusy] = useState(false);

  const onSave = async () => {
    setBusy(true);
    try {
      await save({ username: user, password: pass });
      Alert.alert('Saved', 'Credentials updated');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.c}>
      <Text style={styles.h}>Sign In</Text>
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        placeholder="Username"
        value={user}
        onChangeText={setUser}
      />
      <TextInput
        style={styles.input}
        autoCapitalize="none"
        placeholder="Password"
        value={pass}
        onChangeText={setPass}
        secureTextEntry
      />
      <Button title="Save" onPress={onSave} disabled={busy} />

      <View style={styles.links}>
        <Pressable onPress={() => nav.navigate('Settings')} style={styles.linkBtn}><Text style={styles.linkTxt}>App Settings</Text></Pressable>
        <Pressable onPress={() => nav.navigate('DeviceSetup')} style={styles.linkBtn}><Text style={styles.linkTxt}>Device Setup</Text></Pressable>
        <Pressable onPress={logout} style={[styles.linkBtn, styles.danger]}><Text style={[styles.linkTxt, styles.dangerTxt]}>Log Out</Text></Pressable>
      </View>

      <View style={styles.sep} />

      <Text style={styles.h}>Security</Text>
      <Text style={styles.p}>Rotate your device keys or review permissions in Device Setup.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, padding: 16 },
  h: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10, marginBottom: 10 },
  sep: { height: 24 },
  p: { color: '#444' },
  links: { marginTop: 16 },
  linkBtn: { paddingVertical: 12 },
  linkTxt: { color: '#4f46e5', fontWeight: '600' },
  danger: { },
  dangerTxt: { color: '#dc2626', fontWeight: '700' },
});
