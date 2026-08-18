import { useState, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, useWindowDimensions, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/authStore';

interface Tile {
  id: string;
  label: string;
  icon: string;
  route: string;
  permission: string | null;
  accent: string;
  bg: string;
  description: string;
}

const TILES: Tile[] = [
  {
    id: 'sell',
    label: 'Sell',
    icon: 'shopping-bag',
    route: '/(tabs)/sell',
    permission: 'takeOrders',
    accent: '#4338CA',
    bg: '#fff1f3',
    description: 'Take new orders',
  },
  {
    id: 'orders',
    label: 'Orders',
    icon: 'clipboard',
    route: '/(tabs)/orders',
    permission: null,
    accent: '#f59e0b',
    bg: '#fffbeb',
    description: 'View active orders',
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'bar-chart-2',
    route: '/(tabs)/reports',
    permission: 'viewAllReports',
    accent: '#6366f1',
    bg: '#f0f0ff',
    description: 'Sales & expenses',
  },
  {
    id: 'stock',
    label: 'Inventory',
    icon: 'package',
    route: '/(tabs)/stock',
    permission: 'viewInventory',
    accent: '#10b981',
    bg: '#ecfdf5',
    description: 'Stock levels',
  },
  {
    id: 'menu',
    label: 'Menu',
    icon: 'book-open',
    route: '/(tabs)/menu',
    permission: 'editMenu',
    accent: '#0ea5e9',
    bg: '#f0f9ff',
    description: 'Edit products',
  },
  {
    id: 'expenses',
    label: 'Expenses',
    icon: 'credit-card',
    route: '/(tabs)/expenses',
    permission: 'manageExpenses',
    accent: '#f97316',
    bg: '#fff7ed',
    description: 'Log expenses',
  },
  {
    id: 'debtors',
    label: 'Credit',
    icon: 'users',
    route: '/(tabs)/debtors',
    permission: 'viewDebtors',
    accent: '#8b5cf6',
    bg: '#faf5ff',
    description: 'Credit customers',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings',
    route: '/(tabs)/settings',
    permission: 'manageStaff',
    accent: '#64748b',
    bg: '#f8fafc',
    description: 'Staff & printers',
  },
];

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function DashboardScreen() {
  const { width } = useWindowDimensions();
  const numCols = width >= 768 ? 4 : width >= 480 ? 3 : 2;
  const tileSize = Math.floor((width - 32 - (numCols - 1) * 12) / numCols);

  const currentStaff = useAuthStore((s) => s.currentStaff);
  const currentShiftId = useAuthStore((s) => s.currentShiftId);
  const can = useAuthStore((s) => s.can);
  const logout = useAuthStore((s) => s.logout);

  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(tick);
  }, []);

  const handleTilePress = useCallback(
    (tile: Tile) => {
      const allowed = tile.permission === null ? true : can(tile.permission as any);
      if (!allowed) {
        Alert.alert(
          'Access Restricted',
          `You don't have permission to access ${tile.label}.\nAsk your manager to change your role.`,
          [{ text: 'OK' }]
        );
        return;
      }
      router.push(tile.route as any);
    },
    [can]
  );

  const roleLabel = currentStaff?.role
    ? currentStaff.role.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : '';

  return (
    <SafeAreaView className="flex-1 bg-[#1e1b4b]">
      {/* Header */}
      <View className="px-5 pt-4 pb-3 flex-row items-start justify-between">
        <View className="flex-1">
          <Text className="text-white text-2xl font-bold">Bar POS</Text>
          {currentStaff && (
            <Text className="text-slate-400 text-sm mt-0.5">
              {currentStaff.name} · {roleLabel}
            </Text>
          )}
        </View>
        <View className="items-end">
          <Text className="text-white text-xl font-semibold tabular-nums">{formatTime(now)}</Text>
          <Text className="text-slate-400 text-xs mt-0.5">{formatDate(now)}</Text>
          {/* Shift indicator */}
          <View className="flex-row items-center mt-1.5">
            <View
              className={`w-2 h-2 rounded-full mr-1.5 ${
                currentShiftId ? 'bg-green-400' : 'bg-gray-500'
              }`}
            />
            <Text className="text-slate-400 text-xs">
              {currentShiftId ? 'Shift open' : 'No shift'}
            </Text>
          </View>
          {!currentShiftId ? (
            <TouchableOpacity
              className="bg-green-600 px-3 py-1 rounded-lg mt-1"
              onPress={() => router.push('/shift/open')}
            >
              <Text className="text-white text-xs font-semibold">Open Shift</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              className="bg-red-700/70 px-3 py-1 rounded-lg mt-1"
              onPress={() => router.push('/shift/close')}
            >
              <Text className="text-white text-xs font-semibold">Close Shift</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Divider */}
      <View className="h-px bg-slate-700 mx-5 mb-4" />

      {/* Tile Grid */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {TILES.map((tile) => {
            const allowed = tile.permission === null ? true : can(tile.permission as any);
            return (
              <TouchableOpacity
                key={tile.id}
                style={{
                  width: tileSize,
                  height: tileSize,
                  backgroundColor: allowed ? tile.bg : '#1e1b4b',
                  borderRadius: 20,
                  padding: 16,
                  justifyContent: 'space-between',
                  borderWidth: 2,
                  borderColor: allowed ? tile.accent + '33' : '#334155',
                  opacity: allowed ? 1 : 0.65,
                }}
                onPress={() => handleTilePress(tile)}
                activeOpacity={0.8}
              >
                <View className="flex-row items-start justify-between">
                  <Feather
                    name={tile.icon as any}
                    size={Math.round(tileSize * 0.28)}
                    color={allowed ? tile.accent : '#64748b'}
                  />
                  {!allowed && (
                    <Feather name="lock" size={14} color="#64748b" />
                  )}
                </View>
                <View>
                  <Text
                    style={{
                      fontSize: tileSize < 120 ? 13 : 15,
                      fontWeight: '700',
                      color: allowed ? '#1e1b4b' : '#64748b',
                    }}
                    numberOfLines={1}
                  >
                    {tile.label}
                  </Text>
                  {tileSize >= 110 && (
                    <Text
                      style={{
                        fontSize: 11,
                        color: allowed ? '#64748b' : '#475569',
                        marginTop: 2,
                      }}
                      numberOfLines={1}
                    >
                      {tile.description}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      {/* Sign Out */}
      <TouchableOpacity
        className="mb-5 items-center py-2"
        onPress={logout}
      >
        <Text className="text-slate-500 text-sm">Sign Out</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
