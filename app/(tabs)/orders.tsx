import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Q } from '@nozbe/watermelondb';
import { database } from '@/lib/db';
import { Order as OrderModel, RestaurantTable as TableModel, Staff as StaffModel } from '@/lib/db/models';
import { formatKES } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';

interface OrderCard {
  order: OrderModel;
  tableName: string;
  itemCount: number;
  elapsed: string;
  staffName?: string;
}

function getElapsed(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m ago` : `${hrs}h ago`;
}

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  open:             { label: 'Open',             bg: 'bg-gray-200',   text: 'text-gray-700' },
  sent:             { label: 'Order Sent',        bg: 'bg-amber-100',  text: 'text-amber-800' },
  served:           { label: 'Served',           bg: 'bg-blue-100',   text: 'text-blue-800' },
  awaiting_payment: { label: 'Awaiting Payment', bg: 'bg-red-100',    text: 'text-red-700' },
};

export default function OrdersScreen() {
  const [cards, setCards] = useState<OrderCard[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const currentStaff = useAuthStore((s) => s.currentStaff);
  const isAdminOrManager = currentStaff?.role === 'admin' || currentStaff?.role === 'manager';

  // Build a staff name cache once per load
  const loadStaffNames = async (): Promise<Record<string, string>> => {
    const staffList = await database.get<StaffModel>('staff').query().fetch();
    const map: Record<string, string> = {};
    for (const s of staffList) map[s.id] = s.name;
    return map;
  };

  const loadOrders = useCallback(async () => {
    const fetchAll = isAdminOrManager && showAll;

    const rawOrders = await database
      .get<OrderModel>('orders')
      .query(
        fetchAll
          ? Q.sortBy('opened_at', Q.desc)
          : Q.where('status', Q.notIn(['paid', 'closed', 'voided']))
      )
      .fetch();

    // Active view: oldest first; history view: already newest-first
    if (!fetchAll) rawOrders.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());

    const staffNames = fetchAll ? await loadStaffNames() : {};

    const results: OrderCard[] = [];
    for (const order of rawOrders) {
      let tableName = 'Table';
      try {
        const tbl = await database.get<TableModel>('restaurant_tables').find(order.tableId);
        tableName = tbl.name;
      } catch {}

      const orderItems = await database
        .get('order_items')
        .query(Q.where('order_id', order.id), Q.where('voided', false))
        .fetch();

      results.push({
        order,
        tableName,
        itemCount: orderItems.length,
        elapsed: getElapsed(order.openedAt),
        staffName: fetchAll ? (staffNames[order.staffId] ?? 'Unknown') : undefined,
      });
    }
    setCards(results);
  }, [isAdminOrManager, showAll]);

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders, showAll])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadOrders();
    setRefreshing(false);
  }, [loadOrders]);

  const statusFor = (status: string) =>
    STATUS_CONFIG[status] ?? { label: status, bg: 'bg-gray-100', text: 'text-gray-600' };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-row items-center justify-between px-4 pt-3 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="w-16">
          <Text className="text-primary text-lg">← Home</Text>
        </TouchableOpacity>
        <Text className="text-xl font-bold text-primary">
          {isAdminOrManager && showAll ? 'All Orders' : 'Active Orders'}
        </Text>
        <View className="w-16 items-end">
          {isAdminOrManager && (
            <TouchableOpacity
              onPress={() => setShowAll((v) => !v)}
              className={`px-2 py-1 rounded-lg ${showAll ? 'bg-primary' : 'bg-gray-200'}`}
            >
              <Text className={`text-xs font-semibold ${showAll ? 'text-white' : 'text-gray-600'}`}>
                {showAll ? 'All' : 'Active'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        className="flex-1 px-4"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {cards.length === 0 ? (
          <View className="flex-1 items-center justify-center mt-20">
            <Text className="text-5xl mb-4">📋</Text>
            <Text className="text-lg font-semibold text-gray-500">No active orders</Text>
            <Text className="text-sm text-gray-400 mt-1">Orders will appear here once sent</Text>
          </View>
        ) : (
          cards.map(({ order, tableName, itemCount, elapsed, staffName }) => {
            const s = statusFor(order.status);
            return (
              <TouchableOpacity
                key={order.id}
                className="bg-white rounded-2xl p-4 mb-3 border border-gray-100 shadow-sm"
                onPress={() => router.push(`/order/${order.id}`)}
                activeOpacity={0.75}
              >
                <View className="flex-row items-start justify-between">
                  <View className="flex-1">
                    <Text className="text-lg font-bold text-primary">{tableName}</Text>
                    {order.roomNumber ? (
                      <Text className="text-sm text-gray-500 mt-0.5">{order.roomNumber}</Text>
                    ) : null}
                    {staffName ? (
                      <Text className="text-xs text-gray-400 mt-0.5">by {staffName}</Text>
                    ) : null}
                  </View>
                  <View className={`px-3 py-1 rounded-full ${s.bg}`}>
                    <Text className={`text-xs font-semibold ${s.text}`}>{s.label}</Text>
                  </View>
                </View>

                <View className="flex-row items-center justify-between mt-3 pt-3 border-t border-gray-100">
                  <Text className="text-sm text-gray-500">
                    {itemCount} item{itemCount !== 1 ? 's' : ''}
                  </Text>
                  <Text className="text-base font-bold text-primary">{formatKES(order.totalAmount)}</Text>
                  <Text className="text-xs text-gray-400">{elapsed}</Text>
                </View>
              </TouchableOpacity>
            );
          })
        )}
        <View className="h-8" />
      </ScrollView>
    </SafeAreaView>
  );
}
