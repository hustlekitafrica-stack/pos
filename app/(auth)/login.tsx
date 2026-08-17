import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { findStaffByPin, getActiveShift } from '@/lib/db/actions';
import { seedDatabase } from '@/lib/db/seed';

export default function LoginScreen() {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(true);
  const login = useAuthStore((s) => s.login);

  useEffect(() => {
    seedDatabase()
      .then(() => setSeeding(false))
      .catch(() => setSeeding(false));
  }, []);

  const handlePinPress = (digit: string) => {
    if (pin.length < 4) {
      const newPin = pin + digit;
      setPin(newPin);
      if (newPin.length === 4) {
        handleVerifyPin(newPin);
      }
    }
  };

  const handleDelete = () => {
    setPin(pin.slice(0, -1));
    setError('');
  };

  const handleVerifyPin = async (enteredPin: string) => {
    setLoading(true);
    setError('');
    try {
      const staff = await findStaffByPin(enteredPin);
      if (staff) {
        // Restore any active shift for this staff member
        const activeShift = await getActiveShift(staff.id);
        login(
          {
            id: staff.id,
            name: staff.name,
            role: staff.role as any,
            pin: staff.pin,
            phone: staff.phone,
            is_active: staff.isActive,
            created_at: staff.createdAt?.toISOString() || '',
            updated_at: staff.updatedAt?.toISOString() || '',
          },
          activeShift?.id ?? null
        );
        router.replace('/(tabs)/' as any);
      } else {
        setError('Invalid PIN');
        setPin('');
      }
    } catch (e) {
      setError('Login failed');
      setPin('');
    } finally {
      setLoading(false);
    }
  };

  const pinDots = Array(4).fill(0).map((_, i) => (
    <View
      key={i}
      className={`w-4 h-4 rounded-full mx-2 ${
        i < pin.length ? 'bg-accent' : 'bg-gray-600'
      }`}
    />
  ));

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  const busy = seeding || loading;

  if (seeding) {
    return (
      <SafeAreaView className="flex-1 bg-primary items-center justify-center">
        <Text className="text-white text-3xl font-bold mb-4">Bar POS</Text>
        <ActivityIndicator color="#e94560" size="large" />
        <Text className="text-gray-400 text-sm mt-4">Setting up database…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-primary">
      <View className="flex-1 justify-center items-center px-8">
        <Text className="text-white text-4xl font-bold mb-1">Bar POS</Text>
        <Text className="text-gray-400 text-base mb-10">Enter your PIN to continue</Text>

        {/* PIN dots */}
        <View className="flex-row mb-3">{pinDots}</View>

        {/* Error or loading state */}
        <View className="h-7 justify-center mb-6">
          {loading ? (
            <ActivityIndicator color="#e94560" />
          ) : error ? (
            <Text className="text-accent text-sm text-center">{error}</Text>
          ) : null}
        </View>

        {/* Numpad */}
        <View className="w-full max-w-xs">
          {[0, 1, 2, 3].map((row) => (
            <View key={row} className="flex-row justify-center mb-3">
              {digits.slice(row * 3, row * 3 + 3).map((digit, i) => (
                <TouchableOpacity
                  key={i}
                  className={`w-20 h-20 rounded-full mx-2 justify-center items-center ${
                    digit ? 'bg-secondary' : 'bg-transparent'
                  } ${busy ? 'opacity-50' : ''}`}
                  onPress={() => {
                    if (digit === '⌫') handleDelete();
                    else if (digit) handlePinPress(digit);
                  }}
                  disabled={!digit || busy}
                >
                  <Text className="text-white text-2xl font-semibold">
                    {digit}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}
