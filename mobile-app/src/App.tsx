import React from 'react';
import { SafeAreaView, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import { AppStateProvider } from './context/AppState';
import AppNavigator from './navigation/AppNavigator';
import { useFonts } from 'expo-font';

export default function App() {
  const [fontsLoaded] = useFonts({
    Ionicons: require('@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Ionicons.ttf'),
  });
  if (!fontsLoaded) return null;
  return (
    <SafeAreaView style={styles.container}>
      <AppStateProvider>
        <AppNavigator />
      </AppStateProvider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: Constants.statusBarHeight },
});
