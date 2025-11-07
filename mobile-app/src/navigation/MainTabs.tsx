import React, { useCallback } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import ReceiptsScreen from '../screens/ReceiptsScreen';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import AccountStack from './AccountStack';
import Ionicons from '@expo/vector-icons/Ionicons';

export type TabsParamList = {
  ReceiptsTab: undefined;
  AnalyticsTab: undefined;
  AccountTab: undefined; // nested stack with account/settings/device
};

const Tab = createBottomTabNavigator<TabsParamList>();

export default function MainTabs() {
  const renderIcon = useCallback((routeName: string, color: string, size: number, focused: boolean) => {
    let icon: React.ComponentProps<typeof Ionicons>['name'] = 'ellipse-outline';
    switch (routeName) {
      case 'ReceiptsTab':
        icon = focused ? 'receipt' : 'receipt-outline';
        break;
      case 'AnalyticsTab':
        icon = focused ? 'stats-chart' : 'stats-chart-outline';
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
        tabBarIcon: ({ color, size, focused }) => renderIcon(route.name, color, size, focused),
      })}
    >
      <Tab.Screen name="ReceiptsTab" component={ReceiptsScreen} options={{ title: 'Receipts' }} />
      <Tab.Screen name="AnalyticsTab" component={AnalyticsScreen} options={{ title: 'Analytics' }} />
  <Tab.Screen name="AccountTab" component={AccountStack} options={{ title: 'Account' }} />
    </Tab.Navigator>
  );
}
