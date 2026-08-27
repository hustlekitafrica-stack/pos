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
  testPrint,
  type PrinterDevice,
} from '@/lib/printer/connection';
import { pushAllToSupabase, triggerAutoSync, syncDatabase, type TablePushResult } from '@/lib/db/sync';
import { deleteStaff } from '@/lib/db/actions';
import { Role } from '@/types';
import { hashPin } from '@/lib/auth/pin';

type TabId = 'setup' | 'staff' | 'printers' | 'system';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'setup',    label: 'Setup',    icon: 'settings' },
  { id: 'staff',    label: 'Staff',    icon: 'users' },
  { id: 'printers', label: 'Printers', icon: 'printer' },
  { id: 'system',   label: 'System',   icon: 'tool' },
];

export default function SettingsScreen() {
  const currentStaff = useAuthStore((s) => s.currentStaff);
  const can = useAuthStore((s) => s.can);
  const logout = useAuthStore((s) => s.logout);

  // Active tab
  const [activeTab, setActiveTab] = useState<TabId>('setup');

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
  const [testPrinting, setTestPrinting] = useState(false);
  const [discoveredPrinters, setDiscoveredPrinters] = useState<PrinterDevice[]>([]);
  const [showPrinterPicker, setShowPrinterPicker] = useState<'bar' | 'kitchen' | null>(null);

  // Sync
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState<TablePushResult[] | null>(null);
  const [resetting, setResetting] = useState(false);

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
    if (staffPin.length !== 4) {
      Alert.alert('Invalid PIN', 'PIN must be exactly 4 digits');
      return;
    }

    try {
      const hashedPin = await hashPin(staffPin);
      await database.write(async () => {
        await database.get<Staff>('staff').create((s) => {
          s.name = staffName.trim();
          s.pin = hashedPin;
          s.role = staffRole;
          s.phone = '';
          s.isActive = true;
        });
      });

      setStaffName('');
      setStaffPin('');
      setStaffRole('cashier');
      setShowAddStaff(false);
      Alert.alert('Staff Added', `${staffName} (${staffRole})`);
      await loadStaff();
      triggerAutoSync();
    } catch (e) {
      Alert.alert('Error', 'Could not add staff. Please try again.');
    }
  };

  const handleToggleStaff = async (staff: Staff) => {
    if (staff.id === currentStaff?.id) {
      Alert.alert('Cannot Deactivate', 'You cannot deactivate yourself');
      return;
    }
    await database.write(async () => {
      await staff.update((s) => { s.isActive = !s.isActive; });
    });
    triggerAutoSync();
    await loadStaff();
  };

  const handleDeleteStaff = (staff: Staff) => {
    if (staff.id === currentStaff?.id) {
      Alert.alert('Cannot Delete', 'You cannot delete your own account.');
      return;
    }
    Alert.alert(
      'Delete Staff',
      `Permanently delete ${staff.name}? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteStaff(staff.id);
              await loadStaff();
            } catch (e) {
              Alert.alert('Error', 'Could not delete staff member.');
            }
          },
        },
      ]
    );
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

  const handleTestPrint = async () => {
    setTestPrinting(true);
    const result = await testPrint();
    setTestPrinting(false);
    if (result === 'ok') {
      Alert.alert('Test Print OK', 'Test page sent to printer. Paper should have come out.');
    } else if (result === 'not_connected') {
      Alert.alert('Not Connected', 'No printer connected. Tap "Scan & Connect" below. Make sure the printer is already paired in Android Settings → Bluetooth first.');
    } else {
      Alert.alert('Print Failed', 'Printer is connected but the write failed. Try disconnecting and reconnecting, then test again.');
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResults(null);
    const results = await pushAllToSupabase();
    setSyncResults(results);
    setSyncing(false);
  };

  const handleResetLocalData = () => {
    Alert.alert(
      'Reset Local Database',
      'This will erase ALL local data and re-pull from the server. Make sure you are connected to the internet.\n\nThis cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset & Re-sync',
          style: 'destructive',
          onPress: async () => {
            setResetting(true);
            try {
              await database.unsafeResetDatabase();
              await syncDatabase();
              Alert.alert('Done', 'Local data cleared and re-synced from server.');
            } catch (e) {
              Alert.alert('Error', 'Reset failed. Check your connection and try again.');
            } finally {
              setResetting(false);
            }
          },
        },
      ]
    );
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
      {/* ── Header ───────────────────────────────────────────────────── */}
      <View className="px-4 pt-3 pb-1">
        <View className="flex-row items-center mb-1">
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 6, marginRight: 8 }}>
            <Feather name="arrow-left" size={22} color="#4338CA" />
          </TouchableOpacity>
          <Text className="text-xl font-bold text-primary">Settings</Text>
        </View>
        <Text className="text-xs text-gray-500 ml-10">
          Logged in as: {currentStaff?.name} ({currentStaff?.role})
        </Text>
      </View>

      {/* ── Tab Bar ──────────────────────────────────────────────────── */}
      <View className="bg-white border-b border-gray-100">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 8 }}>
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <TouchableOpacity
                key={tab.id}
                onPress={() => setActiveTab(tab.id)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 8,
                  marginRight: 8,
                  borderRadius: 20,
                  backgroundColor: isActive ? '#3730A3' : '#f1f5f9',
                }}
              >
                <Feather
                  name={tab.icon as any}
                  size={14}
                  color={isActive ? '#ffffff' : '#64748b'}
                  style={{ marginRight: 6 }}
                />
                <Text style={{ fontSize: 13, fontWeight: '600', color: isActive ? '#ffffff' : '#64748b' }}>
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ── Tab Content ──────────────────────────────────────────────── */}
      <ScrollView className="flex-1 p-4">

        {/* ════════════════════════════════════════════════════════════ */}
        {/* SETUP TAB                                                    */}
        {/* ════════════════════════════════════════════════════════════ */}
        {activeTab === 'setup' && (
          <>
            {can('manageStaff') ? (
              <>
                {/* Venue Logo */}
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

                {/* Alert Email */}
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
              </>
            ) : (
              <View className="bg-white rounded-xl p-6 border border-gray-100 items-center">
                <Feather name="lock" size={32} color="#94a3b8" />
                <Text className="text-gray-400 text-sm mt-3 text-center">You don't have permission to access setup settings.</Text>
              </View>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════════════════ */}
        {/* STAFF TAB                                                    */}
        {/* ════════════════════════════════════════════════════════════ */}
        {activeTab === 'staff' && (
          <>
            {can('manageStaff') ? (
              <>
                <View className="flex-row items-center justify-between mb-3">
                  <Text className="text-sm font-bold text-primary">Team Members</Text>
                  <TouchableOpacity className="bg-primary px-3 py-1.5 rounded-lg" onPress={() => setShowAddStaff(true)}>
                    <Text className="text-white text-xs font-medium">+ Add Staff</Text>
                  </TouchableOpacity>
                </View>

                {staffList.length === 0 && (
                  <View className="bg-white rounded-xl p-6 border border-gray-100 items-center">
                    <Feather name="users" size={32} color="#94a3b8" />
                    <Text className="text-gray-400 text-sm mt-3">No staff members yet.</Text>
                  </View>
                )}

                {staffList.map((staff) => (
                  <View key={staff.id} className="bg-white rounded-xl p-4 mb-2 border border-gray-100 flex-row items-center justify-between">
                    <View className="flex-1">
                      <Text className={`text-sm font-medium ${staff.isActive ? 'text-primary' : 'text-gray-400'}`}>
                        {staff.name}
                      </Text>
                      <Text className="text-xs text-gray-500">{staff.role}</Text>
                    </View>
                    <View className="flex-row items-center">
                      <TouchableOpacity
                        className={`px-3 py-1.5 rounded-lg mr-2 ${staff.isActive ? 'bg-red-100' : 'bg-green-100'}`}
                        onPress={() => handleToggleStaff(staff)}
                      >
                        <Text className={`text-xs font-medium ${staff.isActive ? 'text-red-600' : 'text-green-600'}`}>
                          {staff.isActive ? 'Deactivate' : 'Activate'}
                        </Text>
                      </TouchableOpacity>
                      {staff.id !== currentStaff?.id && (
                        <TouchableOpacity
                          className="bg-red-50 p-2 rounded-lg"
                          onPress={() => handleDeleteStaff(staff)}
                        >
                          <Feather name="trash-2" size={14} color="#dc2626" />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                ))}
              </>
            ) : (
              <View className="bg-white rounded-xl p-6 border border-gray-100 items-center">
                <Feather name="lock" size={32} color="#94a3b8" />
                <Text className="text-gray-400 text-sm mt-3 text-center">You don't have permission to manage staff.</Text>
              </View>
            )}
          </>
        )}

        {/* ════════════════════════════════════════════════════════════ */}
        {/* PRINTERS TAB                                                 */}
        {/* ════════════════════════════════════════════════════════════ */}
        {activeTab === 'printers' && (
          <>
            <Text className="text-xs text-gray-400 mb-3">Connect Bluetooth thermal printers for receipts and kitchen tickets.</Text>
            <View className="bg-white rounded-xl p-4 mb-2 border border-gray-100">
              {/* Bar Printer */}
              <View className="flex-row items-center justify-between mb-4 pb-4 border-b border-gray-100">
                <View>
                  <Text className="text-sm font-medium text-gray-700">Bar Printer</Text>
                  <Text className={`text-xs mt-0.5 ${barConnected ? 'text-green-600' : 'text-gray-400'}`}>
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

              {/* Kitchen Printer */}
              <View className="flex-row items-center justify-between mb-4 pb-4 border-b border-gray-100">
                <View>
                  <Text className="text-sm font-medium text-gray-700">Kitchen Printer</Text>
                  <Text className={`text-xs mt-0.5 ${kitchenConnected ? 'text-green-600' : 'text-gray-400'}`}>
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

              {/* Test Print */}
              <View className="flex-row items-center justify-between">
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text className="text-sm font-medium text-gray-700">Test Print</Text>
                  <Text className="text-xs mt-0.5 text-gray-400">
                    Sends a test page to verify the printer is working correctly.
                  </Text>
                </View>
                <TouchableOpacity
                  className="bg-indigo-100 px-3 py-1.5 rounded-lg"
                  onPress={handleTestPrint}
                  disabled={testPrinting}
                >
                  {testPrinting
                    ? <ActivityIndicator size="small" color="#4338CA" />
                    : <Text className="text-indigo-700 text-xs font-medium">Test Print</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        {/* ════════════════════════════════════════════════════════════ */}
        {/* SYSTEM TAB                                                   */}
        {/* ════════════════════════════════════════════════════════════ */}
        {activeTab === 'system' && (
          <>
            {/* Sync */}
            <View className="bg-white rounded-xl p-4 mb-4 border border-gray-100">
              <Text className="text-sm font-bold text-primary mb-3">Cloud Sync</Text>
              <TouchableOpacity
                className="bg-primary p-3 rounded-xl items-center"
                onPress={handleSync}
                disabled={syncing}
              >
                {syncing
                  ? <ActivityIndicator color="#fff" />
                  : <Text className="text-white font-medium">Sync to Cloud</Text>
                }
              </TouchableOpacity>

              {syncResults && (
                <View className="mt-3">
                  <Text className="text-xs font-bold text-primary mb-2">Sync Results</Text>
                  {syncResults.map((r, i) => (
                    <View key={i} className="flex-row items-start mb-1">
                      <Text className={`text-xs font-medium mr-1 ${r.ok ? 'text-green-600' : 'text-red-600'}`}>
                        {r.ok ? '✓' : '✗'}
                      </Text>
                      <View className="flex-1">
                        <Text className={`text-xs ${r.ok ? 'text-gray-600' : 'text-red-700'}`}>
                          {r.table}{r.count > 0 ? ` (${r.count})` : ''}
                          {r.error ? `: ${r.error}` : ''}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </View>

            {/* Admin Tools */}
            {can('viewAuditLog') && (
              <View className="bg-white rounded-xl p-4 mb-4 border border-gray-100">
                <Text className="text-sm font-bold text-primary mb-3">Admin Tools</Text>
                <TouchableOpacity
                  className="bg-gray-700 p-3 rounded-xl items-center mb-2"
                  onPress={() => router.push('/admin/audit-log')}
                >
                  <Text className="text-white font-medium text-sm">Audit Log</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="bg-gray-700 p-3 rounded-xl items-center mb-2"
                  onPress={() => router.push('/admin/end-of-day')}
                >
                  <Text className="text-white font-medium text-sm">End of Day</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Danger Zone */}
            <View className="bg-white rounded-xl p-4 mb-4 border border-red-200">
              <Text className="text-sm font-bold text-red-600 mb-1">Danger Zone</Text>
              <Text className="text-xs text-gray-400 mb-3">Wipes local storage and re-pulls everything from the server.</Text>
              <TouchableOpacity
                className="border border-red-500 p-3 rounded-xl items-center"
                onPress={handleResetLocalData}
                disabled={resetting}
              >
                {resetting
                  ? <ActivityIndicator color="#dc2626" />
                  : <Text className="text-red-600 font-medium">Reset Local Data</Text>
                }
              </TouchableOpacity>
            </View>

            {/* Logout */}
            <View className="bg-white rounded-xl p-4 mb-4 border border-gray-100">
              <Text className="text-sm font-bold text-primary mb-3">Account</Text>
              <TouchableOpacity className="bg-red-600 p-3 rounded-xl items-center" onPress={logout}>
                <Text className="text-white font-medium">Logout</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

      </ScrollView>

      {/* ── Add Staff Modal ───────────────────────────────────────────── */}
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

            <Text className="text-sm font-medium text-gray-600 mb-1">PIN (exactly 4 digits)</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-3"
              value={staffPin}
              onChangeText={setStaffPin}
              placeholder="0000"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
              maxLength={4}
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

      {/* ── Printer Picker Modal ──────────────────────────────────────── */}
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
              <Text className="text-gray-400 text-center py-6">No printers found. Make sure Bluetooth is on and the printer is nearby.</Text>
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
