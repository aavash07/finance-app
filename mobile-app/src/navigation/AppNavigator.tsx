import React, { useEffect } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ReceiptDetailScreen from '../screens/ReceiptDetailScreen';
import MainTabs from './MainTabs';
import SignInScreen from '../screens/SignInScreen';
import SignUpScreen from '../screens/SignUpScreen';
import ProvisioningScreen from '../screens/ProvisioningScreen';
import { useAppState } from '../context/AppState';

export type RootStackParamList = {
  SignIn: undefined;
  SignUp: undefined;
  Provisioning: { fresh?: boolean } | undefined;
  MainTabs: undefined;
  ReceiptDetail: { id: number };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  const { setOnAuthFailure, accessToken, refreshToken, registered, hydrated } = useAppState() as any;
  const navRef = React.useRef(createNavigationContainerRef<RootStackParamList>());
  useEffect(() => {
    // When auth fails (e.g., refresh can't renew), reset to SignIn
    setOnAuthFailure(() => () => {
      try {
        if (navRef.current?.isReady()) {
          navRef.current.reset({ index: 0, routes: [{ name: 'SignIn' }] });
        }
      } catch {}
    });
    return () => setOnAuthFailure(null);
  }, [setOnAuthFailure]);
  
  // Render nothing until hydration complete to avoid flicker
  if (!hydrated) return null;

  const hasAuth = !!(accessToken || refreshToken);
  const initial = hasAuth ? (registered ? 'MainTabs' : 'Provisioning') : 'SignIn';
  return (
    <NavigationContainer ref={navRef as any}>
      <Stack.Navigator initialRouteName={initial}>
        <Stack.Screen name="SignIn" component={SignInScreen} options={{ headerShown: false }} />
        <Stack.Screen name="SignUp" component={SignUpScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Provisioning" component={ProvisioningScreen} options={{ headerShown: false }} />
        <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
        <Stack.Screen name="ReceiptDetail" component={ReceiptDetailScreen} options={{ title: 'Receipt' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
