import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { formatKES, toCents } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';
import { openShift, getActiveShift } from '@/lib/db/actions';

export default function OpenShiftScreen() {
  const [openingCash, setOpeningCash] = useState('');
  const [loading, setLoading] = useState(false);
  const currentStaff = useAuthStore((s) => s.currentStaff);
  const setShiftId = useAuthStore((s) => s.setShiftId);
  const logout = useAuthStore((s) => s.logout);

  // When required=1, the shift screen is mandatory — no cancel, log out instead
  const { required } = useLocalSearchParams<{ required?: string }>();
  const isRequired = required === '1';

  const handleOpenShift = async () => {
    if (!currentStaff || loading) return;
    setLoading(true);
    try {
      // Check for existing active shift (e.g. resumed from another device)
      const existing = await getActiveShift(currentStaff.id);
      if (existing) {
        setShiftId(existing.id);
        router.replace('/(tabs)/' as any);
        return;
      }

      const amountCents = toCents(parseFloat(openingCash) || 0);
      const shift = await openShift(currentStaff.id, amountCents);
      setShiftId(shift.id);
      Alert.alert('Shift Started', `Opening cash: ${formatKES(amountCents)}`, [
        {
          text: 'OK',
          onPress: () => router.replace('/(tabs)/' as any),
        },
      ]);
    } catch (e) {
      Alert.alert('Error', 'Could not open shift. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLogOut = () => {
    logout();
    router.replace('/(auth)/login' as any);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#1e1b4b' }}>
      {/* Header */}
      <View
        style={{
          paddingTop: 8,
          paddingHorizontal: 20,
          paddingBottom: 12,
          borderBottomWidth: 1,
          borderBottomColor: '#1e1b4b',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>
          {isRequired ? 'Start Your Shift' : 'Open Shift'}
        </Text>
        {isRequired ? (
          <TouchableOpacity onPress={handleLogOut}>
            <Text style={{ color: '#64748b', fontSize: 14 }}>Log Out</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={{ color: '#64748b', fontSize: 14 }}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Body */}
      <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 32 }}>
        {/* Staff name */}
        {currentStaff && (
          <View style={{ alignItems: 'center', marginBottom: 32 }}>
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: '#4338CA',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 12,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 28, fontWeight: '800' }}>
                {currentStaff.name.charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700' }}>
              {currentStaff.name}
            </Text>
            <Text style={{ color: '#64748b', fontSize: 14, marginTop: 2, textTransform: 'capitalize' }}>
              {currentStaff.role}
            </Text>
          </View>
        )}

        {isRequired && (
          <Text
            style={{
              color: '#94a3b8',
              fontSize: 14,
              textAlign: 'center',
              marginBottom: 28,
              lineHeight: 20,
            }}
          >
            You must start a shift before taking orders.{'\n'}
            Enter your opening cash float below.
          </Text>
        )}

        {!isRequired && (
          <Text style={{ color: '#94a3b8', textAlign: 'center', marginBottom: 28 }}>
            Enter the opening cash float in the till
          </Text>
        )}

        {/* Cash input */}
        <Text
          style={{
            color: '#94a3b8',
            fontSize: 12,
            fontWeight: '600',
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            marginBottom: 8,
          }}
        >
          Opening Cash (KES)
        </Text>
        <TextInput
          style={{
            backgroundColor: '#1e1b4b',
            borderWidth: 1,
            borderColor: '#334155',
            borderRadius: 14,
            paddingHorizontal: 16,
            paddingVertical: 14,
            fontSize: 24,
            color: '#fff',
            fontWeight: '700',
            marginBottom: 6,
            textAlign: 'center',
          }}
          value={openingCash}
          onChangeText={setOpeningCash}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor="#334155"
        />
        <Text style={{ color: '#475569', fontSize: 12, textAlign: 'center', marginBottom: 28 }}>
          Leave as 0 if no cash float today
        </Text>

        {/* Start Shift button */}
        <TouchableOpacity
          style={{
            backgroundColor: loading ? '#15803d' : '#16a34a',
            borderRadius: 16,
            paddingVertical: 16,
            alignItems: 'center',
            opacity: loading ? 0.7 : 1,
          }}
          onPress={handleOpenShift}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '800' }}>
              Start Shift
            </Text>
          )}
        </TouchableOpacity>

        {/* Log Out link (required mode) or Cancel link (optional mode) */}
        <TouchableOpacity
          style={{ marginTop: 20, alignItems: 'center', paddingVertical: 8 }}
          onPress={isRequired ? handleLogOut : () => router.back()}
        >
          <Text style={{ color: '#475569', fontSize: 14 }}>
            {isRequired ? 'Not you? Log out' : 'Cancel'}
          </Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}
