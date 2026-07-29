import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, SafeAreaView, Alert } from 'react-native';
import { router } from 'expo-router';
import { formatKES, toCents } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';
import { openShift, getActiveShift } from '@/lib/db/actions';

export default function OpenShiftScreen() {
  const [openingCash, setOpeningCash] = useState('');
  const currentStaff = useAuthStore((s) => s.currentStaff);
  const setShiftId = useAuthStore((s) => s.setShiftId);

  const handleOpenShift = async () => {
    if (!currentStaff) return;

    // Check for existing active shift
    const existing = await getActiveShift(currentStaff.id);
    if (existing) {
      setShiftId(existing.id);
      router.back();
      return;
    }

    const amountCents = toCents(parseFloat(openingCash) || 0);
    try {
      const shift = await openShift(currentStaff.id, amountCents);
      setShiftId(shift.id);
      Alert.alert('Shift Opened', `Opening cash: ${formatKES(amountCents)}`);
      router.back();
    } catch (e) {
      Alert.alert('Error', 'Could not open shift');
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-1 justify-center p-8">
        <Text className="text-2xl font-bold text-primary mb-2 text-center">Open Shift</Text>
        <Text className="text-gray-500 text-center mb-8">Enter the opening cash float in the till</Text>

        <Text className="text-sm font-medium text-gray-600 mb-2">Opening Cash (KES)</Text>
        <TextInput
          className="bg-white border border-gray-300 rounded-xl p-4 text-lg text-primary mb-6"
          value={openingCash}
          onChangeText={setOpeningCash}
          keyboardType="numeric"
          placeholder="0.00"
          placeholderTextColor="#9ca3af"
        />

        <TouchableOpacity
          className="bg-success p-4 rounded-xl items-center"
          onPress={handleOpenShift}
        >
          <Text className="text-white font-bold text-lg">Start Shift</Text>
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
