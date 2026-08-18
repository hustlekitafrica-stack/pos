import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { formatKES, toCents, fromCents } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';
import { closeShift } from '@/lib/db/actions';
import { database } from '@/lib/db';
import { Shift } from '@/lib/db/models';

export default function CloseShiftScreen() {
  const [closingCash, setClosingCash] = useState('');
  const [openingCash, setOpeningCash] = useState(0);
  const currentShiftId = useAuthStore((s) => s.currentShiftId);
  const setShiftId = useAuthStore((s) => s.setShiftId);

  useEffect(() => {
    if (currentShiftId) {
      database.get<Shift>('shifts').find(currentShiftId).then((shift) => {
        setOpeningCash(shift.openingCash);
      });
    }
  }, [currentShiftId]);

  const handleCloseShift = async () => {
    if (!currentShiftId) {
      Alert.alert('Error', 'No active shift');
      return;
    }

    const actualCents = toCents(parseFloat(closingCash) || 0);
    try {
      await closeShift(currentShiftId, actualCents);
      setShiftId(null);
      Alert.alert('Shift Closed', 'Shift has been closed successfully');
      router.back();
    } catch (e: any) {
      Alert.alert('Cannot Close Shift', e.message || 'Error closing shift');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-1 justify-center p-8">
        <Text className="text-2xl font-bold text-primary mb-2 text-center">Close Shift</Text>
        <Text className="text-gray-500 text-center mb-8">Count the cash in the till and enter the total</Text>

        <View className="bg-white rounded-xl p-4 mb-6 border border-gray-200">
          <Text className="text-sm text-gray-500">Opening Cash</Text>
          <Text className="text-xl font-bold text-primary">{formatKES(openingCash)}</Text>
        </View>

        <Text className="text-sm font-medium text-gray-600 mb-2">Actual Cash Counted (KES)</Text>
        <TextInput
          className="bg-white border border-gray-300 rounded-xl p-4 text-lg text-primary mb-6"
          value={closingCash}
          onChangeText={setClosingCash}
          keyboardType="numeric"
          placeholder="0.00"
          placeholderTextColor="#9ca3af"
        />

        <TouchableOpacity
          className="bg-accent p-4 rounded-xl items-center"
          onPress={handleCloseShift}
        >
          <Text className="text-white font-bold text-lg">Close Shift</Text>
        </TouchableOpacity>

        <TouchableOpacity
          className="mt-4 p-4 items-center"
          onPress={() => router.back()}
        >
          <Text className="text-gray-500">Cancel</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
