import { useEffect, useCallback } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppState, AppStateStatus, Alert } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { useDeviceStore } from '@/stores/deviceStore';
import { startSessionMonitor, stopSessionMonitor, registerActivity } from '@/lib/auth/session';
import { syncDatabase } from '@/lib/db/sync';
import { registerOrGetDevice } from '@/lib/auth/device';
import '../global.css';

export default function RootLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const logout = useAuthStore((s) => s.logout);
  const setDeviceId = useDeviceStore((s) => s.setDeviceId);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/(auth)/login');
    }
  }, [isAuthenticated]);

  // Session timeout auto-lock
  useEffect(() => {
    if (!isAuthenticated) return;

    // Register this device (creates a `devices` row if needed) so that orders
    // and audit_log records satisfy the Supabase FK constraint.
    registerOrGetDevice().then(setDeviceId).catch(() => {});

    startSessionMonitor(() => {
      Alert.alert('Session Expired', 'You have been logged out due to inactivity.');
      logout();
    });

    // Sync on startup and whenever the app comes to foreground
    syncDatabase().catch((e) => console.warn('Background sync error:', e?.message ?? e));

    // Register activity on app state changes
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        registerActivity();
        syncDatabase().catch((e) => console.warn('Background sync error:', e?.message ?? e));
      }
    });

    return () => {
      stopSessionMonitor();
      sub.remove();
    };
  }, [isAuthenticated, logout]);

  return (
    <>
      <StatusBar hidden={true} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="order/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="shift/open" options={{ presentation: 'modal' }} />
        <Stack.Screen name="shift/close" options={{ presentation: 'modal' }} />
        <Stack.Screen name="admin/audit-log" options={{ presentation: 'modal' }} />
        <Stack.Screen name="admin/end-of-day" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}
