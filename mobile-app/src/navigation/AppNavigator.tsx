import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ReceiptDetailScreen from '../screens/ReceiptDetailScreen';
import MainTabs from './MainTabs';
import SignInScreen from '../screens/SignInScreen';

export type RootStackParamList = {
  SignIn: undefined;
  MainTabs: undefined;
  ReceiptDetail: { id: number };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
  <Stack.Navigator initialRouteName="SignIn">
    <Stack.Screen name="SignIn" component={SignInScreen} options={{ headerShown: false }} />
        <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="ReceiptDetail" component={ReceiptDetailScreen} options={{ title: 'Receipt' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
