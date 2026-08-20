import { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useAuthStore } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { getPendingShifts } from '@/lib/db/actions';

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

export default function DashboardScreen() {
  const { width } = useWindowDimensions();
  const numCols = width >= 768 ? 4 : width >= 480 ? 3 : 2;
  const tileSize = Math.floor((width - 32 - (numCols - 1) * 12) / numCols);

  const currentStaff = useAuthStore((s) => s.currentStaff);
  const currentShiftId = useAuthStore((s) => s.currentShiftId);
  const can = useAuthStore((s) => s.can);
  const logout = useAuthStore((s) => s.logout);

  const logoUri = useSettingsStore((s) => s.logoUri);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => { loadSettings(); }, []);

  useFocusEffect(useCallback(() => {
    if (can('approveShiftClosure')) {
      getPendingShifts().then((list) => setPendingCount(list.length)).catch(() => {});
    }
  }, [can]));

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
      {/* Header — compact */}
      <View className="px-4 pt-3 pb-2 flex-row items-center justify-between">
        {/* Logo or app name */}
        <View className="flex-row items-center flex-1">
          {logoUri ? (
            <Image source={{ uri: logoUri }} style={{ width: 40, height: 40, borderRadius: 8, marginRight: 10 }} resizeMode="contain" />
          ) : (
            <Text className="text-white text-xl font-bold mr-2">Bar POS</Text>
          )}
          {currentStaff && (
            <View>
              <Text className="text-white text-sm font-semibold">{currentStaff.name}</Text>
              <Text className="text-slate-400 text-xs">{roleLabel}</Text>
            </View>
          )}
        </View>

        {/* Right side: shift indicator + open shift + sign-out icon */}
        <View className="flex-row items-center">
          <View className="flex-row items-center mr-3">
            <View className={`w-2 h-2 rounded-full mr-1.5 ${currentShiftId ? 'bg-green-400' : 'bg-gray-500'}`} />
            <Text className="text-slate-400 text-xs">{currentShiftId ? 'Shift open' : 'No shift'}</Text>
          </View>
          {!currentShiftId && (
            <TouchableOpacity
              className="bg-green-600 px-2 py-1 rounded-lg mr-3"
              onPress={() => router.push('/shift/open')}
            >
              <Text className="text-white text-xs font-semibold">Open Shift</Text>
            </TouchableOpacity>
          )}
          {can('approveShiftClosure') && pendingCount > 0 && (
            <TouchableOpacity
              onPress={() => router.push('/shift/pending' as any)}
              style={{ marginRight: 12, position: 'relative' }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="bell" size={20} color="#fbbf24" />
              <View style={{ position: 'absolute', top: -5, right: -6, backgroundColor: '#dc2626', borderRadius: 8, minWidth: 16, height: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 }}>
                <Text style={{ color: '#fff', fontSize: 9, fontWeight: '800' }}>{pendingCount}</Text>
              </View>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={logout} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Feather name="log-out" size={20} color="#94a3b8" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tile Grid */}
      <View style={{ flex: 1, padding: 16 }}>
        {(() => {
          const rows: Tile[][] = [];
          for (let i = 0; i < TILES.length; i += numCols) {
            rows.push(TILES.slice(i, i + numCols));
          }
          return rows.map((row, rowIdx) => (
            <View
              key={rowIdx}
              style={{
                flex: 1,
                flexDirection: 'row',
                gap: 12,
                marginBottom: rowIdx < rows.length - 1 ? 12 : 0,
              }}
            >
              {row.map((tile) => {
                const allowed = tile.permission === null ? true : can(tile.permission as any);
                return (
                  <TouchableOpacity
                    key={tile.id}
                    style={{
                      flex: 1,
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
              {row.length < numCols && Array(numCols - row.length).fill(null).map((_, i) => (
                <View key={`empty-${i}`} style={{ flex: 1 }} />
              ))}
            </View>
          ));
        })()}
      </View>

    </SafeAreaView>
  );
}
