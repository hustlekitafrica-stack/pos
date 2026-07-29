import { useState, useCallback } from 'react';
import { View, Text, ScrollView, SafeAreaView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect, router } from 'expo-router';
import { database } from '@/lib/db';
import { Order, Shift, Payment, Expense } from '@/lib/db/models';
import { Q } from '@nozbe/watermelondb';
import { formatKES } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';
import { triggerLowStockAlerts } from '@/lib/reports/lowStockAlert';

interface EODSummary {
  openShifts: Shift[];
  openOrders: number;
  totalRevenue: number;
  totalExpenses: number;
  paymentBreakdown: Record<string, number>;
  orderCount: number;
}

export default function EndOfDayScreen() {
  const [summary, setSummary] = useState<EODSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const currentStaff = useAuthStore((s) => s.currentStaff);
  const can = useAuthStore((s) => s.can);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const openShifts = await database.get<Shift>('shifts')
      .query(Q.where('closed_at', null))
      .fetch();

    const openOrders = await database.get<Order>('orders')
      .query(Q.where('status', Q.oneOf(['open', 'sent', 'served'])))
      .fetchCount();

    const todayOrders = await database.get<Order>('orders')
      .query(
        Q.where('status', Q.oneOf(['paid', 'closed'])),
        Q.where('opened_at', Q.gte(today.getTime()))
      )
      .fetch();

    const orderIds = todayOrders.map((o) => o.id);
    let payments: Payment[] = [];
    if (orderIds.length > 0) {
      payments = await database.get<Payment>('payments')
        .query(Q.where('order_id', Q.oneOf(orderIds)))
        .fetch();
    }

    const paymentBreakdown: Record<string, number> = {};
    for (const p of payments) {
      paymentBreakdown[p.method] = (paymentBreakdown[p.method] || 0) + p.amount;
    }

    const todayStr = today.toISOString().split('T')[0];
    const expenses = await database.get<Expense>('expenses')
      .query(Q.where('date', todayStr))
      .fetch();

    setSummary({
      openShifts,
      openOrders,
      totalRevenue: todayOrders.reduce((s, o) => s + o.totalAmount, 0),
      totalExpenses: expenses.reduce((s, e) => s + e.amount, 0),
      paymentBreakdown,
      orderCount: todayOrders.length,
    });
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!can('viewAllReports')) {
        router.back();
        return;
      }
      loadSummary();
    }, [loadSummary, can])
  );

  const handleCloseDay = async () => {
    if (!summary) return;

    if (summary.openOrders > 0) {
      Alert.alert('Cannot Close', `There are still ${summary.openOrders} open order(s). Close or void them first.`);
      return;
    }

    if (summary.openShifts.length > 0) {
      Alert.alert(
        'Open Shifts',
        `${summary.openShifts.length} shift(s) are still open. Force close them?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Force Close All',
            style: 'destructive',
            onPress: async () => {
              setClosing(true);
              await database.write(async () => {
                for (const shift of summary.openShifts) {
                  await shift.update((s) => {
                    s.closedAt = new Date();
                    s.closingCashActual = 0;
                    s.closingCashExpected = 0;
                    s.variance = 0;
                  });
                }
              });

              // Trigger low stock alerts
              await triggerLowStockAlerts();

              // Log EOD
              await database.write(async () => {
                await database.get('audit_log').create((a: any) => {
                  a.action = 'end_of_day_close';
                  a.entityType = 'system';
                  a.entityId = '';
                  a.staffId = currentStaff!.id;
                  a.deviceId = '';
                  a.details = JSON.stringify({
                    date: new Date().toISOString().split('T')[0],
                    revenue: summary.totalRevenue,
                    expenses: summary.totalExpenses,
                    orders: summary.orderCount,
                    shiftsForced: summary.openShifts.length,
                  });
                });
              });

              setClosing(false);
              Alert.alert('Day Closed', 'All shifts force-closed and low-stock alerts sent.');
              router.back();
            },
          },
        ]
      );
      return;
    }

    // No open shifts or orders — just finalize
    setClosing(true);
    await triggerLowStockAlerts();

    await database.write(async () => {
      await database.get('audit_log').create((a: any) => {
        a.action = 'end_of_day_close';
        a.entityType = 'system';
        a.entityId = '';
        a.staffId = currentStaff!.id;
        a.deviceId = '';
        a.details = JSON.stringify({
          date: new Date().toISOString().split('T')[0],
          revenue: summary.totalRevenue,
          expenses: summary.totalExpenses,
          orders: summary.orderCount,
        });
      });
    });

    setClosing(false);
    Alert.alert('Day Closed', 'End-of-day process complete. Low-stock alerts sent.');
    router.back();
  };

  if (loading || !summary) {
    return (
      <SafeAreaView className="flex-1 bg-surface items-center justify-center">
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  const netProfit = summary.totalRevenue - summary.totalExpenses;

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-row items-center justify-between p-4 bg-primary">
        <TouchableOpacity onPress={() => router.back()}>
          <Text className="text-white text-lg">← Back</Text>
        </TouchableOpacity>
        <Text className="text-white text-lg font-bold">End of Day</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView className="flex-1 p-4">
        <Text className="text-xs text-gray-400 mb-4">
          {new Date().toLocaleDateString('en-KE', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </Text>

        {/* Summary Cards */}
        <View className="flex-row mb-3">
          <View className="bg-white rounded-xl p-4 flex-1 mr-2 border border-gray-100">
            <Text className="text-lg font-bold text-green-600">{formatKES(summary.totalRevenue)}</Text>
            <Text className="text-xs text-gray-500">Revenue</Text>
          </View>
          <View className="bg-white rounded-xl p-4 flex-1 mr-2 border border-gray-100">
            <Text className="text-lg font-bold text-red-600">{formatKES(summary.totalExpenses)}</Text>
            <Text className="text-xs text-gray-500">Expenses</Text>
          </View>
          <View className="bg-white rounded-xl p-4 flex-1 border border-gray-100">
            <Text className={`text-lg font-bold ${netProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatKES(netProfit)}
            </Text>
            <Text className="text-xs text-gray-500">Net</Text>
          </View>
        </View>

        <View className="flex-row mb-4">
          <View className="bg-white rounded-xl p-4 flex-1 mr-2 border border-gray-100">
            <Text className="text-lg font-bold text-primary">{summary.orderCount}</Text>
            <Text className="text-xs text-gray-500">Orders</Text>
          </View>
          <View className="bg-white rounded-xl p-4 flex-1 border border-gray-100">
            <Text className={`text-lg font-bold ${summary.openOrders > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {summary.openOrders}
            </Text>
            <Text className="text-xs text-gray-500">Open Orders</Text>
          </View>
        </View>

        {/* Payment Breakdown */}
        <Text className="text-sm font-bold text-primary mb-2">Payments Collected</Text>
        {Object.entries(summary.paymentBreakdown).map(([method, amount]) => (
          <View key={method} className="flex-row justify-between bg-white rounded-lg p-3 mb-1 border border-gray-100">
            <Text className="text-sm text-gray-700 capitalize">{method}</Text>
            <Text className="text-sm font-medium text-primary">{formatKES(amount)}</Text>
          </View>
        ))}

        {/* Open Shifts Warning */}
        {summary.openShifts.length > 0 && (
          <View className="bg-yellow-50 border border-yellow-400 rounded-xl p-4 mt-4">
            <Text className="text-sm font-bold text-yellow-800 mb-1">
              {summary.openShifts.length} Open Shift(s)
            </Text>
            <Text className="text-xs text-yellow-700">
              These will be force-closed when you close the day.
            </Text>
          </View>
        )}

        {summary.openOrders > 0 && (
          <View className="bg-red-50 border border-red-400 rounded-xl p-4 mt-4">
            <Text className="text-sm font-bold text-red-800 mb-1">
              {summary.openOrders} Open Order(s)
            </Text>
            <Text className="text-xs text-red-700">
              All orders must be closed or voided before end-of-day.
            </Text>
          </View>
        )}
      </ScrollView>

      <View className="p-4 bg-white border-t border-gray-200">
        <TouchableOpacity
          className={`p-4 rounded-xl items-center ${closing ? 'bg-gray-400' : 'bg-red-600'}`}
          onPress={handleCloseDay}
          disabled={closing}
        >
          <Text className="text-white font-bold text-lg">
            {closing ? 'Closing...' : 'Close Day'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
