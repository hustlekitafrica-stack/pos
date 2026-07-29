import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, SafeAreaView, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { findStaffByPin } from '@/lib/db/actions';
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
        login({
          id: staff.id,
          name: staff.name,
          role: staff.role as any,
          pin: staff.pin,
          phone: staff.phone,
          is_active: staff.isActive,
          created_at: staff.createdAt?.toISOString() || '',
          updated_at: staff.updatedAt?.toISOString() || '',
        });
        router.replace('/(tabs)/tables');
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

  return (
    <SafeAreaView className="flex-1 bg-primary">
      <View className="flex-1 justify-center items-center px-8">
        <Text className="text-white text-3xl font-bold mb-2">Bar POS</Text>
        <Text className="text-gray-400 text-base mb-2">Enter your PIN to continue</Text>
        <Text className="text-gray-600 text-xs mb-10">Default PINs: Admin=1234 · Cashier=5678 · Bartender=9012</Text>

        <View className="flex-row mb-8">{pinDots}</View>

        {error ? (
          <Text className="text-accent text-sm mb-4">{error}</Text>
        ) : null}

        <View className="w-full max-w-xs">
          {[0, 1, 2, 3].map((row) => (
            <View key={row} className="flex-row justify-center mb-3">
              {digits.slice(row * 3, row * 3 + 3).map((digit, i) => (
                <TouchableOpacity
                  key={i}
                  className={`w-20 h-20 rounded-full mx-2 justify-center items-center ${
                    digit ? 'bg-secondary' : 'bg-transparent'
                  }`}
                  onPress={() => {
                    if (digit === '⌫') handleDelete();
                    else if (digit) handlePinPress(digit);
                  }}
                  disabled={!digit}
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
