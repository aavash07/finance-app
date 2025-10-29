import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import SettingsScreen from '../screens/SettingsScreen';
import DeviceSetupScreen from '../screens/DeviceSetupScreen';
import ReceiptsScreen from '../screens/ReceiptsScreen';
import ReceiptDetailScreen from '../screens/ReceiptDetailScreen';

export type RootStackParamList = {
  Settings: undefined;
  DeviceSetup: undefined;
  Receipts: undefined;
  ReceiptDetail: { id: number };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="Settings">
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="DeviceSetup" component={DeviceSetupScreen} options={{ title: 'Device Setup' }} />
        <Stack.Screen name="Receipts" component={ReceiptsScreen} />
        <Stack.Screen name="ReceiptDetail" component={ReceiptDetailScreen} options={{ title: 'Receipt' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
