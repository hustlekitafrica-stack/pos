import { useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { database } from '@/lib/db';
import { Customer, CreditTransaction } from '@/lib/db/models';
import { Q } from '@nozbe/watermelondb';
import { formatKES, toCents } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';
import { triggerAutoSync } from '@/lib/db/sync';

interface CustomerWithBalance {
  customer: Customer;
  balance: number;
}

export default function DebtorsScreen() {
  const [customers, setCustomers] = useState<CustomerWithBalance[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [showRepay, setShowRepay] = useState<Customer | null>(null);
  const [showDetail, setShowDetail] = useState<Customer | null>(null);
  const [detailTxns, setDetailTxns] = useState<CreditTransaction[]>([]);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newLimit, setNewLimit] = useState('');
  const [repayAmount, setRepayAmount] = useState('');
  const [repayMethod, setRepayMethod] = useState<'cash' | 'mpesa'>('cash');
  const [repayMpesaRef, setRepayMpesaRef] = useState('');
  const [loading, setLoading] = useState(false);
  const currentStaff = useAuthStore((s) => s.currentStaff);

  const loadCustomers = useCallback(async () => {
    setLoading(true);
    const allCusts = await database.get<Customer>('customers').query(Q.where('is_active', true)).fetch();
    const withBalances: CustomerWithBalance[] = [];

    for (const cust of allCusts) {
      const txns = await database
        .get<CreditTransaction>('credit_transactions')
        .query(Q.where('customer_id', cust.id))
        .fetch();

      let balance = 0;
      for (const t of txns) {
        balance += t.type === 'credit_sale' ? t.amount : -t.amount;
      }
      withBalances.push({ customer: cust, balance });
    }

    withBalances.sort((a, b) => b.balance - a.balance);
    setCustomers(withBalances);
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadCustomers();
    }, [loadCustomers])
  );

  const handleAddCustomer = async () => {
    if (!newName.trim()) return;
    await database.write(async () => {
      await database.get<Customer>('customers').create((c) => {
        c.name = newName.trim();
        c.phone = newPhone.trim() || null;
        c.creditLimit = toCents(parseFloat(newLimit) || 0);
        c.isActive = true;
        c.notes = null;
        c.createdBy = currentStaff!.id;
      });
    });
    setNewName('');
    setNewPhone('');
    setNewLimit('');
    setShowAdd(false);
    triggerAutoSync();
    await loadCustomers();
  };

  const handleRepay = async () => {
    if (!showRepay || !repayAmount.trim()) return;
    const amountCents = toCents(parseFloat(repayAmount) || 0);
    if (amountCents <= 0) return;

    await database.write(async () => {
      await database.get<CreditTransaction>('credit_transactions').create((ct) => {
        ct.customerId = showRepay.id;
        ct.orderId = null;
        ct.type = 'repayment';
        ct.amount = amountCents;
        ct.paymentMethod = repayMethod;
        ct.mpesaRef = repayMethod === 'mpesa' ? repayMpesaRef || null : null;
        ct.notes = null;
        ct.recordedBy = currentStaff!.id;
      });
    });

    setRepayAmount('');
    setRepayMpesaRef('');
    setShowRepay(null);
    Alert.alert('Repayment Recorded', `${formatKES(amountCents)} received`);
    triggerAutoSync();
    await loadCustomers();
  };

  const handleViewDetail = async (cust: Customer) => {
    const txns = await database
      .get<CreditTransaction>('credit_transactions')
      .query(Q.where('customer_id', cust.id), Q.sortBy('created_at', Q.desc))
      .fetch();
    setDetailTxns(txns);
    setShowDetail(cust);
  };

  const totalOwed = customers.reduce((sum, c) => sum + Math.max(0, c.balance), 0);

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-row items-center justify-between px-4 pt-3 pb-1">
        <View className="flex-row items-center flex-1">
          <TouchableOpacity onPress={() => router.back()} style={{ padding: 6, marginRight: 8 }}>
            <Feather name="arrow-left" size={22} color="#4338CA" />
          </TouchableOpacity>
          <View>
            <Text className="text-xl font-bold text-primary">Credit Customers</Text>
            <Text className="text-sm text-gray-500">Total outstanding: {formatKES(totalOwed)}</Text>
          </View>
        </View>
        <TouchableOpacity className="bg-primary px-4 py-2 rounded-lg" onPress={() => setShowAdd(true)}>
          <Text className="text-white font-medium">+ Customer</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
          <Text className="text-gray-400 mt-2">Loading...</Text>
        </View>
      ) : (
        <ScrollView className="flex-1 p-4">
          {customers.length === 0 ? (
            <Text className="text-gray-400 text-center mt-8">No credit customers yet.</Text>
          ) : (
            customers.map(({ customer, balance }) => (
              <TouchableOpacity
                key={customer.id}
                className="bg-white rounded-xl p-4 mb-2 border border-gray-100 flex-row items-center justify-between"
                onPress={() => handleViewDetail(customer)}
              >
                <View className="flex-1">
                  <Text className="text-base font-medium text-primary">{customer.name}</Text>
                  {customer.phone ? <Text className="text-xs text-gray-500">{customer.phone}</Text> : null}
                </View>
                <View className="items-end">
                  <Text className={`text-base font-bold ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    {balance > 0 ? formatKES(balance) : 'Settled'}
                  </Text>
                  {customer.creditLimit > 0 && (
                    <Text className="text-xs text-gray-400">Limit: {formatKES(customer.creditLimit)}</Text>
                  )}
                </View>
                {balance > 0 && (
                  <TouchableOpacity
                    className="bg-green-600 px-3 py-2 rounded-lg ml-3"
                    onPress={(e) => {
                      e.stopPropagation?.();
                      setShowRepay(customer);
                    }}
                >
                  <Text className="text-white text-xs font-medium">Repay</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))
        )}
        </ScrollView>
      )}

      {/* Add Customer Modal */}
      <Modal visible={showAdd} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-primary mb-4">Add Credit Customer</Text>

            <Text className="text-sm font-medium text-gray-600 mb-1">Name *</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-3"
              value={newName}
              onChangeText={setNewName}
              placeholder="Customer name"
              placeholderTextColor="#9ca3af"
              autoFocus
            />

            <Text className="text-sm font-medium text-gray-600 mb-1">Phone</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-3"
              value={newPhone}
              onChangeText={setNewPhone}
              placeholder="0712345678"
              placeholderTextColor="#9ca3af"
              keyboardType="phone-pad"
            />

            <Text className="text-sm font-medium text-gray-600 mb-1">Credit Limit (KES, 0 = unlimited)</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-4"
              value={newLimit}
              onChangeText={setNewLimit}
              placeholder="0"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
            />

            <View className="flex-row justify-end">
              <TouchableOpacity className="px-4 py-2 mr-2" onPress={() => setShowAdd(false)}>
                <Text className="text-gray-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity className="bg-primary px-6 py-2 rounded-lg" onPress={handleAddCustomer}>
                <Text className="text-white font-medium">Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Repayment Modal */}
      <Modal visible={!!showRepay} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-primary mb-2">Record Repayment</Text>
            <Text className="text-sm text-gray-500 mb-4">{showRepay?.name}</Text>

            <Text className="text-sm font-medium text-gray-600 mb-1">Amount (KES)</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-3"
              value={repayAmount}
              onChangeText={setRepayAmount}
              placeholder="0.00"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
              autoFocus
            />

            <Text className="text-sm font-medium text-gray-600 mb-2">Payment Method</Text>
            <View className="flex-row mb-3">
              <TouchableOpacity
                className={`flex-1 p-3 rounded-lg mr-2 items-center ${repayMethod === 'cash' ? 'bg-primary' : 'bg-gray-100'}`}
                onPress={() => setRepayMethod('cash')}
              >
                <Text className={repayMethod === 'cash' ? 'text-white font-medium' : 'text-gray-700'}>Cash</Text>
              </TouchableOpacity>
              <TouchableOpacity
                className={`flex-1 p-3 rounded-lg items-center ${repayMethod === 'mpesa' ? 'bg-primary' : 'bg-gray-100'}`}
                onPress={() => setRepayMethod('mpesa')}
              >
                <Text className={repayMethod === 'mpesa' ? 'text-white font-medium' : 'text-gray-700'}>M-Pesa</Text>
              </TouchableOpacity>
            </View>

            {repayMethod === 'mpesa' && (
              <>
                <Text className="text-sm font-medium text-gray-600 mb-1">M-Pesa Ref</Text>
                <TextInput
                  className="border border-gray-300 rounded-xl p-3 text-base mb-3"
                  value={repayMpesaRef}
                  onChangeText={setRepayMpesaRef}
                  placeholder="e.g. QJK7L3M2N1"
                  placeholderTextColor="#9ca3af"
                />
              </>
            )}

            <View className="flex-row justify-end mt-2">
              <TouchableOpacity className="px-4 py-2 mr-2" onPress={() => setShowRepay(null)}>
                <Text className="text-gray-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity className="bg-green-600 px-6 py-2 rounded-lg" onPress={handleRepay}>
                <Text className="text-white font-medium">Record</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Customer Detail Modal */}
      <Modal visible={!!showDetail} animationType="slide">
        <SafeAreaView className="flex-1 bg-surface">
          <View className="flex-row items-center justify-between p-4 bg-primary">
            <Text className="text-white text-lg font-bold">{showDetail?.name}</Text>
            <TouchableOpacity onPress={() => setShowDetail(null)}>
              <Feather name="x" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
          <ScrollView className="flex-1 p-4">
            {detailTxns.length === 0 ? (
              <Text className="text-gray-400 text-center mt-8">No transactions yet.</Text>
            ) : (() => {
              // Group transactions by date
              const groups: Record<string, CreditTransaction[]> = {};
              for (const txn of detailTxns) {
                const d = txn.createdAt ? new Date(txn.createdAt) : new Date();
                const key = d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
                if (!groups[key]) groups[key] = [];
                groups[key].push(txn);
              }
              return Object.entries(groups).map(([dateLabel, txns]) => {
                const dayTotal = txns.reduce((s, t) => s + (t.type === 'credit_sale' ? t.amount : -t.amount), 0);
                const printDay = () => {
                  const lines = [
                    `=== ${showDetail?.name} ===`,
                    dateLabel,
                    '─'.repeat(32),
                    ...txns.map((t) => `${t.type === 'credit_sale' ? 'Sale' : 'Repayment'}  ${formatKES(t.amount)}`),
                    '─'.repeat(32),
                    `Day Total: ${formatKES(dayTotal)}`,
                    '',
                  ].join('\n');
                  const { sendToPrinter } = require('@/lib/printer/connection');
                  sendToPrinter('bar', new TextEncoder().encode(lines)).catch(() => {});
                };
                return (
                  <View key={dateLabel} className="mb-4">
                    <View className="flex-row items-center justify-between mb-2">
                      <Text className="text-sm font-bold text-primary">{dateLabel}</Text>
                      <TouchableOpacity
                        className="flex-row items-center bg-indigo-50 px-3 py-1 rounded-lg"
                        onPress={printDay}
                      >
                        <Feather name="printer" size={13} color="#4338CA" style={{ marginRight: 4 }} />
                        <Text className="text-xs text-primary font-medium">Print</Text>
                      </TouchableOpacity>
                    </View>
                    {txns.map((txn) => (
                      <View key={txn.id} className="bg-white rounded-xl p-3 mb-1 flex-row justify-between border border-gray-100">
                        <View>
                          <Text className="text-sm font-medium text-primary">
                            {txn.type === 'credit_sale' ? 'Credit Sale' : 'Repayment'}
                          </Text>
                          {txn.mpesaRef ? <Text className="text-xs text-gray-500">Ref: {txn.mpesaRef}</Text> : null}
                        </View>
                        <Text className={`text-base font-bold ${txn.type === 'credit_sale' ? 'text-red-600' : 'text-green-600'}`}>
                          {txn.type === 'credit_sale' ? '+' : '-'}{formatKES(txn.amount)}
                        </Text>
                      </View>
                    ))}
                    <View className="flex-row justify-end px-2">
                      <Text className="text-xs text-gray-500 font-medium">
                        Day total: <Text className={dayTotal >= 0 ? 'text-red-600' : 'text-green-600'}>{formatKES(Math.abs(dayTotal))}</Text>
                      </Text>
                    </View>
                  </View>
                );
              });
            })()}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
