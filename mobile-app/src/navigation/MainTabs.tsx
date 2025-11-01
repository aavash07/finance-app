import React, { useCallback } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import ReceiptsScreen from '../screens/ReceiptsScreen';
import DeviceSetupScreen from '../screens/DeviceSetupScreen';
import SettingsScreen from '../screens/SettingsScreen';
import AccountScreen from '../screens/AccountScreen';
import Ionicons from '@expo/vector-icons/Ionicons';

export type TabsParamList = {
  ReceiptsTab: undefined;
  DeviceTab: undefined;
  SettingsTab: undefined;
  AccountTab: undefined;
};

const Tab = createBottomTabNavigator<TabsParamList>();

export default function MainTabs() {
  const renderIcon = useCallback((routeName: keyof TabsParamList, color: string, size: number, focused: boolean) => {
    let icon: React.ComponentProps<typeof Ionicons>['name'] = 'ellipse-outline';
    switch (routeName) {
      case 'ReceiptsTab':
        icon = focused ? 'receipt' : 'receipt-outline';
        break;
      case 'DeviceTab':
        icon = focused ? 'hardware-chip' : 'hardware-chip-outline';
        break;
      case 'SettingsTab':
        icon = focused ? 'settings' : 'settings-outline';
        break;
      case 'AccountTab':
        icon = focused ? 'person-circle' : 'person-circle-outline';
        break;
    }
    return <Ionicons name={icon} size={size} color={color} />;
  }, []);
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ color, size, focused }) => renderIcon(route.name as keyof TabsParamList, color, size, focused),
      })}
    >
      <Tab.Screen name="ReceiptsTab" component={ReceiptsScreen} options={{ title: 'Receipts' }} />
      <Tab.Screen name="DeviceTab" component={DeviceSetupScreen} options={{ title: 'Device' }} />
      <Tab.Screen name="SettingsTab" component={SettingsScreen} options={{ title: 'Settings' }} />
      <Tab.Screen name="AccountTab" component={AccountScreen} options={{ title: 'Account' }} />
    </Tab.Navigator>
  );
}
