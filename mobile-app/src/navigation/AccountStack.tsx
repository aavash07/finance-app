import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import AccountScreen from '../screens/AccountScreen';
import DeviceSetupScreen from '../screens/DeviceSetupScreen';

export type AccountStackParamList = {
  AccountHome: undefined;
  DeviceSetup: undefined;
};

const Stack = createNativeStackNavigator<AccountStackParamList>();

export default function AccountStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="AccountHome" component={AccountScreen} options={{ title: 'Account' }} />
      <Stack.Screen name="DeviceSetup" component={DeviceSetupScreen} options={{ title: 'Device' }} />
    </Stack.Navigator>
  );
}
