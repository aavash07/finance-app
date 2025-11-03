import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Button, Alert, ScrollView } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import { FinanceKitClient, mintGrantJWT } from '@financekit/rn-sdk';
import { useAppState } from '../context/AppState';

type Props = NativeStackScreenProps<RootStackParamList, 'ReceiptDetail'>;
type DecryptResponse = { data?: Record<string, unknown>; processed_at?: string } | { code: string; detail: string };

export default function ReceiptDetailScreen({ route }: Readonly<Props>) {
  const { id } = route.params;
  const { baseUrl, authHeaders, deviceId, privB64, dekWraps, receipts } = useAppState();
  const api = useMemo(() => new FinanceKitClient(baseUrl), [baseUrl]);
  const [body, setBody] = useState<DecryptResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const onDecrypt = async () => {
    // If we have cached data for this receipt, show it immediately without server call
    const cached = receipts[String(id)];
    if (cached && (cached.data || cached.derived)) {
      setBody({ data: cached.data || cached.derived, processed_at: cached.updatedAt });
      return;
    }
    const savedWrap = dekWraps[String(id)];
    if (!savedWrap) {
      return Alert.alert('Missing key', 'No DEK wrap found for this receipt. Ingest the receipt from this device first.');
    }
    setBusy(true);
    try {
      const now = Math.floor(Date.now() / 1000);
      const token = await mintGrantJWT(deviceId, privB64, { sub: '1', scope: ['receipt:decrypt'], jti: String(now), iat: now, nbf: now - 5, exp: now + 120, targets: [id] });
      const resp = await api.decryptProcess({ token, dek_wrap_srv: savedWrap, targets: [id], authHeaders }) as DecryptResponse;
      const maybeErr = resp as { code?: string; detail?: string };
      if (maybeErr && typeof maybeErr === 'object' && 'code' in maybeErr && maybeErr.code) {
        Alert.alert('Error', `${maybeErr.code}: ${maybeErr.detail}`);
      } else {
        setBody(resp);
      }
    } catch (e: any) {
      Alert.alert('Error', e?.detail || 'Decrypt failed');
    } finally { setBusy(false); }
  };

  return (
    <ScrollView contentContainerStyle={styles.c}>
      <Text style={styles.t}>Receipt #{id}</Text>
      <View style={styles.row}><Button title="Decrypt" onPress={onDecrypt} disabled={busy} /></View>
      {body && 'data' in (body as any) ? (
        <View>
          <Text>Processed at: {(body as any).processed_at || ''}</Text>
          <Text selectable>{JSON.stringify((body as any).data, null, 2)}</Text>
        </View>
      ) : (
        <Text>Tap Decrypt to fetch and process this receipt.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  c: { padding: 16 },
  t: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  row: { marginVertical: 6 },
});
