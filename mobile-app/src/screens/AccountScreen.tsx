import React, { useState } from 'react';
import { View, Text, StyleSheet, TextInput, Button, Alert } from 'react-native';
import { useAppState } from '../context/AppState';

export default function AccountScreen() {
  const { username, password, save } = useAppState();
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

      <View style={styles.sep} />

      <Text style={styles.h}>Sign Up</Text>
      <Text style={styles.p}>
        Sign up via the server is not yet implemented in this backend. For now, create a user via
        the server admin or CLI, then enter credentials above.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  c: { flex: 1, padding: 16 },
  h: { fontSize: 18, fontWeight: '600', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 6, padding: 10, marginBottom: 10 },
  sep: { height: 24 },
  p: { color: '#444' },
});
