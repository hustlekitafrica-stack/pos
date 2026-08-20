import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Alert, TextInput, Modal, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useDeviceStore } from '@/stores/deviceStore';
import { useAuthStore } from '@/stores/authStore';
import { getAllTables, createOrder, getActiveOrderForTable, createTable } from '@/lib/db/actions';
import { RestaurantTable } from '@/lib/db/models';

export default function TablesScreen() {
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [showAddTable, setShowAddTable] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const deviceId = useDeviceStore((s) => s.deviceId) ?? 'device-unknown';
  const currentStaff = useAuthStore((s) => s.currentStaff);
  const currentShiftId = useAuthStore((s) => s.currentShiftId);
  const can = useAuthStore((s) => s.can);
  const { width } = useWindowDimensions();
  const numCols = width >= 768 ? 4 : width >= 480 ? 3 : 2;

  const loadTables = useCallback(async () => {
    const data = await getAllTables();
    setTables(data);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadTables();
    }, [loadTables])
  );

  const handleTablePress = async (table: RestaurantTable) => {
    if (!currentShiftId) {
      Alert.alert('No Active Shift', 'Please open a shift before taking orders.', [
        { text: 'Open Shift', onPress: () => router.push('/shift/open') },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }

    if (table.status === 'free') {
      try {
        const order = await createOrder({
          tableId: table.id,
          staffId: currentStaff!.id,
          shiftId: currentShiftId,
          deviceId,
        });
        await loadTables();
        router.push(`/order/${order.id}`);
      } catch (e) {
        Alert.alert('Error', 'Could not create order');
      }
    } else {
      const existingOrder = await getActiveOrderForTable(table.id);
      if (existingOrder) {
        router.push(`/order/${existingOrder.id}`);
      }
    }
  };

  const handleAddTable = async () => {
    if (!newTableName.trim()) return;
    await createTable(newTableName.trim());
    setNewTableName('');
    setShowAddTable(false);
    await loadTables();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'free': return 'bg-green-100 border-green-500';
      case 'open': return 'bg-yellow-100 border-yellow-500';
      case 'awaiting_payment': return 'bg-red-100 border-red-500';
      default: return 'bg-gray-200 border-gray-400';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'free': return 'Free';
      case 'open': return 'Open';
      case 'awaiting_payment': return 'Awaiting Payment';
      default: return status;
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-row items-center justify-between px-4 pt-3 pb-2">
        <TouchableOpacity onPress={() => router.back()} className="w-16">
          <Text className="text-primary text-lg">← Home</Text>
        </TouchableOpacity>
        <Text className="text-xl font-bold text-primary">Tables</Text>
        <View className="flex-row">
          {can('editMenu') && (
            <TouchableOpacity
              className="bg-primary px-3 py-2 rounded-lg mr-2"
              onPress={() => setShowAddTable(true)}
            >
              <Text className="text-white font-medium text-sm">+ Table</Text>
            </TouchableOpacity>
          )}
          {!currentShiftId && (
            <TouchableOpacity
              className="bg-green-600 px-3 py-2 rounded-lg"
              onPress={() => router.push('/shift/open')}
            >
              <Text className="text-white font-medium text-sm">Open Shift</Text>
            </TouchableOpacity>
          )}
          {currentShiftId && (
            <TouchableOpacity
              className="bg-red-600 px-3 py-2 rounded-lg"
              onPress={() => router.push('/shift/close')}
            >
              <Text className="text-white font-medium text-sm">Close Shift</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView className="flex-1 p-3">
        <View className="flex-row flex-wrap">
          {tables.map((table) => (
            <TouchableOpacity
              key={table.id}
              style={{ width: `${100 / numCols}%`, padding: 6 }}
              onPress={() => handleTablePress(table)}
            >
              <View className={`p-4 rounded-2xl border-2 items-center justify-center min-h-[100px] ${getStatusColor(table.status)}`}>
                <Text className="text-lg font-bold text-primary text-center">{table.name}</Text>
                <Text className="text-xs text-gray-600 mt-1">{getStatusLabel(table.status)}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
        {tables.length === 0 && (
          <Text className="text-gray-400 text-center mt-8">No tables yet. Tap "+ Table" to add one.</Text>
        )}
      </ScrollView>

      <Modal visible={showAddTable} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-primary mb-4">Add Table</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-4"
              value={newTableName}
              onChangeText={setNewTableName}
              placeholder='e.g. "Table 7" or "Bar Seat 5"'
              placeholderTextColor="#9ca3af"
              autoFocus
            />
            <View className="flex-row justify-end">
              <TouchableOpacity className="px-4 py-2 mr-2" onPress={() => setShowAddTable(false)}>
                <Text className="text-gray-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity className="bg-primary px-6 py-2 rounded-lg" onPress={handleAddTable}>
                <Text className="text-white font-medium">Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
