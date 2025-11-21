import React from 'react';
import { View, Text, StyleSheet, Pressable, Switch } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AccountStackParamList } from '../navigation/AccountStack';
import { useAppState } from '../context/AppState';

export default function AccountScreen() {
  const { username, logout, budgetAlertsEnabled, setBudgetAlertsEnabled } = useAppState() as any;
  const nav = useNavigation<NativeStackNavigationProp<AccountStackParamList>>();

  return (
    <View style={styles.c}>
      <Text style={styles.welcome}>Welcome, <Text style={styles.user}>{username}</Text></Text>
      <Text style={styles.subtitle}>Manage your account and device below.</Text>

      <View style={styles.links}>
        <Pressable onPress={() => nav.navigate('DeviceSetup')} style={styles.linkBtn}><Text style={styles.linkTxt}>Device Setup</Text></Pressable>
        <Pressable onPress={logout} style={[styles.linkBtn, styles.danger]}><Text style={[styles.linkTxt, styles.dangerTxt]}>Log Out</Text></Pressable>
      </View>

      <View style={styles.sep} />
      <Text style={styles.sectionH}>Preferences</Text>
      <View style={styles.prefRow} accessibilityRole="adjustable" accessibilityLabel="Budget alert notifications">
        <View style={{ flex: 1 }}>
          <Text style={styles.prefLabel}>Budget Alerts</Text>
          <Text style={styles.prefHint}>Notify when a category exceeds monthly limit.</Text>
        </View>
        <Switch value={budgetAlertsEnabled} onValueChange={setBudgetAlertsEnabled} />
      </View>

      <View style={styles.sep} />
      <Text style={styles.sectionH}>Security</Text>
      <Text style={styles.p}>Rotate your device keys or review permissions in Device Setup.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, padding: 16 },
  welcome: { fontSize: 22, fontWeight: '700', marginBottom: 6 },
  user: { color: '#4f46e5' },
  subtitle: { color: '#555', marginBottom: 16 },
  sep: { height: 24 },
  p: { color: '#444' },
  links: { marginTop: 16 },
  linkBtn: { paddingVertical: 12 },
  linkTxt: { color: '#4f46e5', fontWeight: '600' },
  danger: { },
  dangerTxt: { color: '#dc2626', fontWeight: '700' },
  sectionH: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  prefRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  prefLabel: { fontSize: 16, color: '#334' },
  prefValue: { fontSize: 16, fontWeight: '600', color: '#334' },
  prefOn: { color: '#16a34a' },
  prefOff: { color: '#64748b' },
  prefHint: { color: '#555', fontSize: 12, marginTop: -4, marginBottom: 8 },
});
