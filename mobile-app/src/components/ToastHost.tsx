import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { useAppState } from '../context/AppState';

const ToastHost: React.FC = () => {
  const { toastQueue } = useAppState();
  return (
    <View pointerEvents="none" style={styles.container}>
      {toastQueue.map(t => (
        <ToastItem key={t.id} msg={t.msg} />
      ))}
    </View>
  );
};

const ToastItem: React.FC<{ msg: string }> = ({ msg }) => {
  const opacity = new Animated.Value(0);
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[styles.toast, { opacity }]}> 
      <Text style={styles.text}>{msg}</Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: { position: 'absolute', left: 0, right: 0, bottom: 30, alignItems: 'center', zIndex: 9999, paddingHorizontal: 12 },
  toast: { backgroundColor: 'rgba(0,0,0,0.72)', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 6, elevation: 6 },
  text: { color: 'white', fontSize: 14, opacity: 0.98 },
});

export default ToastHost;
