import { useState, useCallback } from 'react';
import { View, Text, ScrollView, SafeAreaView, TouchableOpacity, RefreshControl } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Q } from '@nozbe/watermelondb';
import { database } from '@/lib/db';
import { Order as OrderModel, RestaurantTable as TableModel } from '@/lib/db/models';
import { formatKES } from '@/utils/currency';

interface OrderCard {
  order: OrderModel;
  tableName: string;
  itemCount: number;
  elapsed: string;
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

  const loadOrders = useCallback(async () => {
    const activeOrders = await database
      .get<OrderModel>('orders')
      .query(Q.where('status', Q.notIn(['paid', 'closed', 'voided'])))
      .fetch();

    // Sort oldest first
    activeOrders.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());

    const results: OrderCard[] = [];
    for (const order of activeOrders) {
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
      });
    }
    setCards(results);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadOrders();
    }, [loadOrders])
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
        <Text className="text-xl font-bold text-primary">Active Orders</Text>
        <View className="w-16" />
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
          cards.map(({ order, tableName, itemCount, elapsed }) => {
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
