import { useState, useCallback, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, TextInput, Alert, ActivityIndicator, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { useSettingsStore } from '@/stores/settingsStore';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { database } from '@/lib/db';
import { Staff } from '@/lib/db/models';
import { Q } from '@nozbe/watermelondb';
import { useAuthStore } from '@/stores/authStore';
import { usePrinterStore } from '@/stores/printerStore';
import {
  scanForPrinters,
  connectBarPrinter,
  connectKitchenPrinter,
  disconnectBarPrinter,
  disconnectKitchenPrinter,
  type PrinterDevice,
} from '@/lib/printer/connection';
import { syncDatabase } from '@/lib/db/sync';
import { seedDatabase } from '@/lib/db/seed';
import { Role } from '@/types';
import { hashPin } from '@/lib/auth/pin';

export default function SettingsScreen() {
  const currentStaff = useAuthStore((s) => s.currentStaff);
  const can = useAuthStore((s) => s.can);
  const logout = useAuthStore((s) => s.logout);

  // Staff management
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [showAddStaff, setShowAddStaff] = useState(false);
  const [staffName, setStaffName] = useState('');
  const [staffPin, setStaffPin] = useState('');
  const [staffRole, setStaffRole] = useState<Role>('cashier');

  // Printer
  const barConnected = usePrinterStore((s) => s.barPrinterConnected);
  const kitchenConnected = usePrinterStore((s) => s.kitchenPrinterConnected);
  const barAddress = usePrinterStore((s) => s.barPrinterAddress);
  const kitchenAddress = usePrinterStore((s) => s.kitchenPrinterAddress);
  const [scanning, setScanning] = useState(false);
  const [discoveredPrinters, setDiscoveredPrinters] = useState<PrinterDevice[]>([]);
  const [showPrinterPicker, setShowPrinterPicker] = useState<'bar' | 'kitchen' | null>(null);

  // Sync
  const [syncing, setSyncing] = useState(false);

  // Settings store (logo + alert email)
  const logoUri = useSettingsStore((s) => s.logoUri);
  const alertEmail = useSettingsStore((s) => s.alertEmail);
  const setLogoUri = useSettingsStore((s) => s.setLogoUri);
  const setAlertEmail = useSettingsStore((s) => s.setAlertEmail);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const [emailInput, setEmailInput] = useState('');

  const loadSavedAddresses = usePrinterStore((s) => s.loadSavedAddresses);

  useEffect(() => {
    loadSettings();
    loadSavedAddresses();
  }, []);

  // Sync alertEmail into local input whenever the store loads/changes
  useEffect(() => {
    setEmailInput(alertEmail);
  }, [alertEmail]);

  const handlePickLogo = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      const src = result.assets[0].uri;
      const dest = FileSystem.documentDirectory + 'bar_logo.jpg';
      await FileSystem.copyAsync({ from: src, to: dest });
      await setLogoUri(dest);
    }
  };

  const handleSaveEmail = async () => {
    await setAlertEmail(emailInput.trim());
    Alert.alert('Saved', 'Alert email updated');
  };

  const loadStaff = useCallback(async () => {
    if (!can('manageStaff')) return;
    const data = await database.get<Staff>('staff').query().fetch();
    setStaffList(data);
  }, [can]);

  useFocusEffect(
    useCallback(() => {
      loadStaff();
    }, [loadStaff])
  );

  const handleAddStaff = async () => {
    if (!staffName.trim() || !staffPin.trim()) return;
    if (staffPin.length < 4) {
      Alert.alert('Invalid PIN', 'PIN must be at least 4 digits');
      return;
    }

    const hashedPin = await hashPin(staffPin);
    await database.write(async () => {
      await database.get<Staff>('staff').create((s) => {
        s.name = staffName.trim();
        s.pin = hashedPin;
        s.role = staffRole;
        s.isActive = true;
      });
    });

    setStaffName('');
    setStaffPin('');
    setStaffRole('cashier');
    setShowAddStaff(false);
    Alert.alert('Staff Added', `${staffName} (${staffRole})`);
    await loadStaff();
  };

  const handleToggleStaff = async (staff: Staff) => {
    if (staff.id === currentStaff?.id) {
      Alert.alert('Cannot Deactivate', 'You cannot deactivate yourself');
      return;
    }
    await database.write(async () => {
      await staff.update((s) => { s.isActive = !s.isActive; });
    });
    await loadStaff();
  };

  const handleScanPrinters = async (target: 'bar' | 'kitchen') => {
    setScanning(true);
    setShowPrinterPicker(target);
    const devices = await scanForPrinters(5000);
    setDiscoveredPrinters(devices);
    setScanning(false);
  };

  const handleSelectPrinter = async (device: PrinterDevice) => {
    const target = showPrinterPicker;
    setShowPrinterPicker(null);
    if (!target) return;

    const success = target === 'bar'
      ? await connectBarPrinter(device.address)
      : await connectKitchenPrinter(device.address);

    Alert.alert(
      success ? 'Connected' : 'Failed',
      success ? `${target} printer connected: ${device.name}` : `Could not connect to ${device.name}`
    );
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncDatabase();
      Alert.alert('Sync Complete', 'Data synchronized with server');
    } catch (e: any) {
      Alert.alert('Sync Failed', e?.message || 'Could not connect to server');
    }
    setSyncing(false);
  };

  const handleSeed = async () => {
    Alert.alert('Seed Data', 'This will add demo data. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Seed',
        onPress: async () => {
          await seedDatabase();
          Alert.alert('Done', 'Seed data loaded');
          await loadStaff();
        },
      },
    ]);
  };

  const roles: { key: Role; label: string }[] = [
    { key: 'admin', label: 'Admin' },
    { key: 'manager', label: 'Manager' },
    { key: 'stock_manager', label: 'Stock Mgr' },
    { key: 'cashier', label: 'Cashier' },
    { key: 'bartender', label: 'Bartender' },
    { key: 'waiter', label: 'Waiter' },
  ];

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="px-4 pt-3 pb-1">
        <View className="flex-row items-center mb-2">
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 6, marginRight: 8 }}>
            <Feather name="arrow-left" size={22} color="#4338CA" />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-primary">Settings</Text>
        </View>
        <Text className="text-xs text-gray-500">Logged in as: {currentStaff?.name} ({currentStaff?.role})</Text>
      </View>

      <ScrollView className="flex-1 p-4">
        {/* ── Logo ─────────────────────────────────────────────────────── */}
        {can('manageStaff') && (
          <View className="bg-white rounded-xl p-4 mb-4 border border-gray-100">
            <Text className="text-sm font-bold text-primary mb-3">Venue Logo</Text>
            <View className="flex-row items-center">
              {logoUri ? (
                <Image source={{ uri: logoUri }} style={{ width: 60, height: 60, borderRadius: 8, marginRight: 12 }} resizeMode="contain" />
              ) : (
                <View style={{ width: 60, height: 60, borderRadius: 8, backgroundColor: '#f1f5f9', marginRight: 12, alignItems: 'center', justifyContent: 'center' }}>
                  <Feather name="image" size={24} color="#94a3b8" />
                </View>
              )}
              <View className="flex-1">
                <TouchableOpacity className="bg-primary px-4 py-2 rounded-lg mb-2" onPress={handlePickLogo}>
                  <Text className="text-white text-sm font-medium">{logoUri ? 'Change Logo' : 'Upload Logo'}</Text>
                </TouchableOpacity>
                {logoUri && (
                  <TouchableOpacity onPress={() => setLogoUri(null)}>
                    <Text className="text-red-500 text-xs">Remove logo</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        )}

        {/* ── Alert Email ──────────────────────────────────────────── */}
        {can('manageStaff') && (
          <View className="bg-white rounded-xl p-4 mb-4 border border-gray-100">
            <Text className="text-sm font-bold text-primary mb-1">Low-Stock Alert Email</Text>
            <Text className="text-xs text-gray-400 mb-3">Receives automatic email when items run low</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-3"
              value={emailInput}
              onChangeText={setEmailInput}
              placeholder="owner@bar.com"
              placeholderTextColor="#9ca3af"
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TouchableOpacity className="bg-primary px-4 py-2 rounded-lg items-center" onPress={handleSaveEmail}>
              <Text className="text-white text-sm font-medium">Save Email</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Quick Actions ────────────────────────────────────────────────── */}
        <View className="flex-row mb-4">
          <TouchableOpacity className="flex-1 bg-primary p-3 rounded-xl items-center mr-2" onPress={handleSync}>
            {syncing ? <ActivityIndicator color="#fff" /> : <Text className="text-white font-medium">Sync</Text>}
          </TouchableOpacity>
          <TouchableOpacity className="flex-1 bg-red-600 p-3 rounded-xl items-center" onPress={logout}>
            <Text className="text-white font-medium">Logout</Text>
          </TouchableOpacity>
        </View>

        {/* ── Admin Links ──────────────────────────────────────── */}
        {can('viewAuditLog') && (
          <View className="flex-row mb-4">
            <TouchableOpacity
              className="flex-1 bg-gray-700 p-3 rounded-xl items-center mr-2"
              onPress={() => router.push('/admin/audit-log')}
            >
              <Text className="text-white font-medium text-sm">Audit Log</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 bg-gray-700 p-3 rounded-xl items-center mr-2"
              onPress={() => router.push('/admin/end-of-day')}
            >
              <Text className="text-white font-medium text-sm">End of Day</Text>
            </TouchableOpacity>
            <TouchableOpacity
              className="flex-1 bg-gray-500 p-3 rounded-xl items-center"
              onPress={handleSeed}
            >
              <Text className="text-white font-medium text-sm">Seed Data</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Printers ─────────────────────────────────────────── */}
        <Text className="text-sm font-bold text-primary mb-2 mt-2">Printers</Text>
        <View className="bg-white rounded-xl p-4 mb-2 border border-gray-100">
          <View className="flex-row items-center justify-between mb-3">
            <View>
              <Text className="text-sm font-medium text-gray-700">Bar Printer</Text>
              <Text className={`text-xs ${barConnected ? 'text-green-600' : 'text-gray-400'}`}>
                {barConnected ? `Connected (${barAddress?.slice(0, 12)}...)` : 'Not connected'}
              </Text>
            </View>
            {barConnected ? (
              <TouchableOpacity className="bg-red-100 px-3 py-1.5 rounded-lg" onPress={disconnectBarPrinter}>
                <Text className="text-red-600 text-xs font-medium">Disconnect</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity className="bg-primary px-3 py-1.5 rounded-lg" onPress={() => handleScanPrinters('bar')}>
                <Text className="text-white text-xs font-medium">Scan & Connect</Text>
              </TouchableOpacity>
            )}
          </View>

          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-sm font-medium text-gray-700">Kitchen Printer</Text>
              <Text className={`text-xs ${kitchenConnected ? 'text-green-600' : 'text-gray-400'}`}>
                {kitchenConnected ? `Connected (${kitchenAddress?.slice(0, 12)}...)` : 'Not connected'}
              </Text>
            </View>
            {kitchenConnected ? (
              <TouchableOpacity className="bg-red-100 px-3 py-1.5 rounded-lg" onPress={disconnectKitchenPrinter}>
                <Text className="text-red-600 text-xs font-medium">Disconnect</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity className="bg-primary px-3 py-1.5 rounded-lg" onPress={() => handleScanPrinters('kitchen')}>
                <Text className="text-white text-xs font-medium">Scan & Connect</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Staff Management ─────────────────────────────────── */}
        {can('manageStaff') && (
          <>
            <View className="flex-row items-center justify-between mt-4 mb-2">
              <Text className="text-sm font-bold text-primary">Staff</Text>
              <TouchableOpacity className="bg-primary px-3 py-1.5 rounded-lg" onPress={() => setShowAddStaff(true)}>
                <Text className="text-white text-xs font-medium">+ Add</Text>
              </TouchableOpacity>
            </View>

            {staffList.map((staff) => (
              <View key={staff.id} className="bg-white rounded-xl p-4 mb-2 border border-gray-100 flex-row items-center justify-between">
                <View>
                  <Text className={`text-sm font-medium ${staff.isActive ? 'text-primary' : 'text-gray-400'}`}>
                    {staff.name}
                  </Text>
                  <Text className="text-xs text-gray-500">{staff.role}</Text>
                </View>
                <TouchableOpacity
                  className={`px-3 py-1.5 rounded-lg ${staff.isActive ? 'bg-red-100' : 'bg-green-100'}`}
                  onPress={() => handleToggleStaff(staff)}
                >
                  <Text className={`text-xs font-medium ${staff.isActive ? 'text-red-600' : 'text-green-600'}`}>
                    {staff.isActive ? 'Deactivate' : 'Activate'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </ScrollView>

      {/* Add Staff Modal */}
      <Modal visible={showAddStaff} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-primary mb-4">Add Staff</Text>

            <Text className="text-sm font-medium text-gray-600 mb-1">Name</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-3"
              value={staffName}
              onChangeText={setStaffName}
              placeholder="Full name"
              placeholderTextColor="#9ca3af"
              autoFocus
            />

            <Text className="text-sm font-medium text-gray-600 mb-1">PIN (min 4 digits)</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-3"
              value={staffPin}
              onChangeText={setStaffPin}
              placeholder="0000"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
              secureTextEntry
            />

            <Text className="text-sm font-medium text-gray-600 mb-2">Role</Text>
            <View className="flex-row flex-wrap mb-4">
              {roles.map((r) => (
                <TouchableOpacity
                  key={r.key}
                  className={`px-3 py-2 rounded-lg mr-2 mb-2 ${staffRole === r.key ? 'bg-primary' : 'bg-gray-100'}`}
                  onPress={() => setStaffRole(r.key)}
                >
                  <Text className={`text-sm ${staffRole === r.key ? 'text-white' : 'text-gray-700'}`}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View className="flex-row justify-end">
              <TouchableOpacity className="px-4 py-2 mr-2" onPress={() => setShowAddStaff(false)}>
                <Text className="text-gray-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity className="bg-primary px-6 py-2 rounded-lg" onPress={handleAddStaff}>
                <Text className="text-white font-medium">Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Printer Picker Modal */}
      <Modal visible={!!showPrinterPicker} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-primary mb-4">
              Select {showPrinterPicker === 'bar' ? 'Bar' : 'Kitchen'} Printer
            </Text>

            {scanning ? (
              <View className="items-center py-6">
                <ActivityIndicator size="large" />
                <Text className="text-gray-500 mt-2">Scanning for printers...</Text>
              </View>
            ) : discoveredPrinters.length === 0 ? (
              <Text className="text-gray-400 text-center py-6">No printers found. Make sure Bluetooth is on and printer is in pairing mode.</Text>
            ) : (
              discoveredPrinters.map((d) => (
                <TouchableOpacity
                  key={d.address}
                  className="bg-gray-50 rounded-xl p-4 mb-2 border border-gray-200"
                  onPress={() => handleSelectPrinter(d)}
                >
                  <Text className="text-sm font-medium text-primary">{d.name}</Text>
                  <Text className="text-xs text-gray-400">{d.address}</Text>
                </TouchableOpacity>
              ))
            )}

            <TouchableOpacity className="items-center mt-2" onPress={() => setShowPrinterPicker(null)}>
              <Text className="text-gray-500">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
