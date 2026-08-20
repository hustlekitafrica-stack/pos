import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { formatKES, toCents } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';
import { closeShift, requestShiftClosure, getShiftSummary } from '@/lib/db/actions';
import { database } from '@/lib/db';
import { Shift, Order as OrderModel, RestaurantTable } from '@/lib/db/models';

export default function CloseShiftScreen() {
  const currentShiftId = useAuthStore((s) => s.currentShiftId);
  const setShiftId = useAuthStore((s) => s.setShiftId);
  const can = useAuthStore((s) => s.can);

  const isApprover = can('approveShiftClosure');  // cashier / manager / admin → direct close
  const isWaiter   = !isApprover && can('requestShiftClosure');

  const [loading, setLoading]   = useState(true);
  const [submitting, setSubmitting] = useState(false);

  // Shared state
  const [openingCash, setOpeningCash] = useState(0);
  const [summary, setSummary] = useState<{
    cashTotal: number; mpesaTotal: number; cardTotal: number; creditTotal: number;
    totalRevenue: number; orderCount: number; openOrders: OrderModel[];
  } | null>(null);
  const [openOrderNames, setOpenOrderNames] = useState<string[]>([]);

  // Approver-only state
  const [closingCash, setClosingCash] = useState('');

  useEffect(() => {
    if (!can('requestShiftClosure')) {
      Alert.alert('Access Denied', 'You do not have permission to end a shift.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
      return;
    }
    if (!currentShiftId) {
      Alert.alert('No Active Shift', 'There is no open shift.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
      return;
    }
    loadShiftData();
  }, [currentShiftId]);

  const loadShiftData = async () => {
    if (!currentShiftId) return;
    setLoading(true);
    try {
      const shift = await database.get<Shift>('shifts').find(currentShiftId);
      setOpeningCash(shift.openingCash);
      const s = await getShiftSummary(currentShiftId);
      setSummary(s);
      // Resolve table names for open orders
      const names: string[] = [];
      for (const o of s.openOrders) {
        try {
          const tbl = await database.get<RestaurantTable>('restaurant_tables').find(o.tableId);
          names.push(tbl.name);
        } catch {
          names.push('Unknown table');
        }
      }
      setOpenOrderNames(names);
    } finally {
      setLoading(false);
    }
  };

  // ── Waiter: request closure ──────────────────────────────────────────────
  const handleRequestClosure = async () => {
    if (!currentShiftId) return;
    if ((summary?.openOrders.length ?? 0) > 0) {
      Alert.alert('Open Bills Remain', 'Close all bills before ending your shift.');
      return;
    }
    Alert.alert(
      'End Your Shift',
      'This will submit your shift for supervisor approval. You will not be able to take new orders until a new shift is started.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Submit for Approval',
          style: 'destructive',
          onPress: async () => {
            setSubmitting(true);
            try {
              await requestShiftClosure(currentShiftId);
              setShiftId(null);
              Alert.alert('Shift Submitted', 'Your shift is pending supervisor approval.', [
                { text: 'OK', onPress: () => router.replace('/(auth)/login' as any) },
              ]);
            } catch (e: any) {
              Alert.alert('Error', e.message ?? 'Could not submit shift.');
            } finally {
              setSubmitting(false);
            }
          },
        },
      ]
    );
  };

  // ── Approver: direct close ───────────────────────────────────────────────
  const handleCloseShift = async () => {
    if (!currentShiftId) return;
    const actualCents = toCents(parseFloat(closingCash) || 0);
    setSubmitting(true);
    try {
      await closeShift(currentShiftId, actualCents);
      setShiftId(null);
      Alert.alert('Shift Closed', 'Shift has been closed and reconciled.', [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert('Cannot Close Shift', e.message || 'Error closing shift');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-surface items-center justify-center">
        <ActivityIndicator size="large" color="#4338CA" />
      </SafeAreaView>
    );
  }

  const hasOpenOrders = (summary?.openOrders.length ?? 0) > 0;

  return (
    <SafeAreaView className="flex-1 bg-surface">
      {/* Header */}
      <View className="flex-row items-center px-4 pt-3 pb-2">
        <TouchableOpacity onPress={() => router.back()} style={{ padding: 6, marginRight: 12 }}>
          <Feather name="arrow-left" size={22} color="#4338CA" />
        </TouchableOpacity>
        <Text className="text-xl font-bold text-primary">
          {isWaiter ? 'End My Shift' : 'Close Shift'}
        </Text>
      </View>

      <ScrollView className="flex-1 p-5">

        {/* Open orders warning */}
        {hasOpenOrders && (
          <View style={{ backgroundColor: '#fef2f2', borderRadius: 12, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#fca5a5' }}>
            <View className="flex-row items-center mb-2">
              <Feather name="alert-circle" size={16} color="#dc2626" style={{ marginRight: 6 }} />
              <Text style={{ color: '#dc2626', fontWeight: '700', fontSize: 14 }}>
                {summary!.openOrders.length} Open Bill{summary!.openOrders.length !== 1 ? 's' : ''} — Cannot End Shift
              </Text>
            </View>
            {openOrderNames.map((name, i) => (
              <Text key={i} style={{ color: '#991b1b', fontSize: 13, marginLeft: 22 }}>• {name}</Text>
            ))}
            <TouchableOpacity
              className="mt-3 bg-red-600 rounded-xl py-2 items-center"
              onPress={() => router.replace('/(tabs)/orders' as any)}
            >
              <Text className="text-white font-bold text-sm">Go to Orders →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* All clear */}
        {!hasOpenOrders && (
          <View style={{ backgroundColor: '#f0fdf4', borderRadius: 12, padding: 12, marginBottom: 16, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#86efac' }}>
            <Feather name="check-circle" size={16} color="#16a34a" style={{ marginRight: 8 }} />
            <Text style={{ color: '#15803d', fontWeight: '600', fontSize: 13 }}>All bills settled</Text>
          </View>
        )}

        {/* Shift summary */}
        {summary && (
          <View className="bg-white rounded-2xl p-4 mb-4 border border-gray-100">
            <Text className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Shift Summary</Text>
            <View className="flex-row justify-between mb-2">
              <Text className="text-sm text-gray-500">Orders completed</Text>
              <Text className="text-sm font-bold text-primary">{summary.orderCount}</Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-sm text-gray-500">Cash sales</Text>
              <Text className="text-sm font-bold text-primary">{formatKES(summary.cashTotal)}</Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-sm text-gray-500">M-Pesa</Text>
              <Text className="text-sm font-bold text-primary">{formatKES(summary.mpesaTotal)}</Text>
            </View>
            <View className="flex-row justify-between mb-2">
              <Text className="text-sm text-gray-500">Card</Text>
              <Text className="text-sm font-bold text-primary">{formatKES(summary.cardTotal)}</Text>
            </View>
            {summary.creditTotal > 0 && (
              <View className="flex-row justify-between mb-2">
                <Text className="text-sm text-gray-500">Credit (Account)</Text>
                <Text className="text-sm font-bold text-primary">{formatKES(summary.creditTotal)}</Text>
              </View>
            )}
            <View className="border-t border-gray-100 mt-2 pt-2 flex-row justify-between">
              <Text className="text-base font-bold text-primary">Total Revenue</Text>
              <Text className="text-base font-bold text-primary">{formatKES(summary.totalRevenue)}</Text>
            </View>
          </View>
        )}

        {/* Opening cash */}
        <View className="bg-white rounded-xl p-4 mb-4 border border-gray-100 flex-row justify-between">
          <Text className="text-sm text-gray-500">Opening Cash Float</Text>
          <Text className="text-sm font-bold text-primary">{formatKES(openingCash)}</Text>
        </View>

        {/* Approver: cash count input */}
        {isApprover && (
          <>
            <Text className="text-sm font-semibold text-gray-600 mb-2">Actual Cash Counted (KES)</Text>
            <TextInput
              className="bg-white border border-gray-300 rounded-xl p-4 text-lg text-primary mb-2"
              value={closingCash}
              onChangeText={setClosingCash}
              keyboardType="numeric"
              placeholder="0.00"
              placeholderTextColor="#9ca3af"
            />
            {summary && closingCash.length > 0 && (
              <Text style={{
                fontSize: 12, marginBottom: 16, fontWeight: '600',
                color: toCents(parseFloat(closingCash) || 0) - (summary.cashTotal + openingCash) >= 0 ? '#16a34a' : '#dc2626',
              }}>
                Variance: {formatKES(toCents(parseFloat(closingCash) || 0) - (summary.cashTotal + openingCash))}
              </Text>
            )}
          </>
        )}

        {/* Action button */}
        {isWaiter ? (
          <TouchableOpacity
            style={{
              backgroundColor: hasOpenOrders ? '#9ca3af' : '#dc2626',
              borderRadius: 14, padding: 16, alignItems: 'center', marginTop: 8,
              opacity: submitting ? 0.6 : 1,
            }}
            onPress={handleRequestClosure}
            disabled={hasOpenOrders || submitting}
          >
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <Text style={{ color: '#fff', fontWeight: '800', fontSize: 16 }}>Request Shift Closure</Text>
            }
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            className="bg-accent rounded-2xl p-4 items-center mt-2"
            onPress={handleCloseShift}
            disabled={submitting}
            style={{ opacity: submitting ? 0.6 : 1 }}
          >
            {submitting
              ? <ActivityIndicator color="#fff" />
              : <Text className="text-white font-bold text-lg">Close & Reconcile Shift</Text>
            }
          </TouchableOpacity>
        )}

        <TouchableOpacity className="mt-4 p-4 items-center" onPress={() => router.back()}>
          <Text className="text-gray-500">Cancel</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
