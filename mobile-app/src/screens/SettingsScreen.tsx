import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ScrollView } from 'react-native';
import PillButton from '../components/PillButton';
import { useAppState } from '../context/AppState';
 
export default function SettingsScreen() {
  const { baseUrl, username, password, deviceId, save, logout } = useAppState();
  const [b, setB] = useState(baseUrl);
  const [u, setU] = useState(username);
  const [p, setP] = useState(password);
  const [d, setD] = useState(deviceId);

  const onSave = async () => { await save({ baseUrl: b, username: u, password: p, deviceId: d }); };
  const onLogout = async () => { await logout(); };

  return (
    <ScrollView contentContainerStyle={styles.c}>
      <Text style={styles.t}>Settings</Text>
      <Text>Base URL</Text>
      <TextInput style={styles.i} value={b} onChangeText={setB} />
      <Text>Username</Text>
      <TextInput style={styles.i} value={u} onChangeText={setU} />
      <Text>Password</Text>
      <TextInput style={styles.i} value={p} onChangeText={setP} secureTextEntry />
      <Text>Device ID</Text>
      <TextInput style={styles.i} value={d} onChangeText={setD} />
  <View style={styles.row}><PillButton title="Save" onPress={onSave} /></View>
  <View style={styles.row}><PillButton title="Log out" onPress={onLogout} color="#dc2626" /></View>
  {/* Device Setup and Receipts are available via bottom tabs now */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  c: { padding: 16 },
  t: { fontSize: 22, fontWeight: 'bold', marginBottom: 12 },
  i: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 8, marginBottom: 8 },
  row: { marginVertical: 6 },
});
