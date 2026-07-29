import { useState, useCallback } from 'react';
import { View, Text, ScrollView, SafeAreaView, TouchableOpacity, Modal, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { database } from '@/lib/db';
import { Expense, ExpenseCategory } from '@/lib/db/models';
import { Q } from '@nozbe/watermelondb';
import { formatKES, toCents } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';
import { captureReceiptImage, scanReceipt } from '@/lib/ai/receiptScan';

export default function ExpensesScreen() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [catNames, setCatNames] = useState<Record<string, string>>({});
  const [showAdd, setShowAdd] = useState(false);
  const [selectedCatId, setSelectedCatId] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [loading, setLoading] = useState(false);
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);
  const currentStaff = useAuthStore((s) => s.currentStaff);

  const loadExpenses = useCallback(async () => {
    setLoading(true);
    const data = await database
      .get<Expense>('expenses')
      .query(Q.sortBy('created_at', Q.desc), Q.take(50))
      .fetch();
    setExpenses(data);

    const cats = await database.get<ExpenseCategory>('expense_categories').query().fetch();
    setCategories(cats);
    const names: Record<string, string> = {};
    for (const c of cats) {
      names[c.id] = c.name;
    }
    setCatNames(names);

    if (cats.length > 0 && !selectedCatId) {
      setSelectedCatId(cats[0].id);
    }
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadExpenses();
    }, [loadExpenses])
  );

  const handleAddExpense = async () => {
    if (!description.trim() || !amount.trim() || !selectedCatId) return;
    const amountCents = toCents(parseFloat(amount) || 0);
    if (amountCents <= 0) return;

    await database.write(async () => {
      await database.get<Expense>('expenses').create((e) => {
        e.categoryId = selectedCatId;
        e.description = description.trim();
        e.amount = amountCents;
        e.paidBy = paidBy.trim() || currentStaff!.name;
        e.loggedBy = currentStaff!.id;
        e.expenseDate = new Date().toISOString().split('T')[0];
        e.receiptPhotoUrl = receiptImageUrl;
        e.source = receiptImageUrl ? 'scanned' : 'manual';
        e.vendorName = vendorName.trim() || null;
      });
    });

    setDescription('');
    setAmount('');
    setPaidBy('');
    setVendorName('');
    setReceiptImageUrl(null);
    setShowAdd(false);
    Alert.alert('Expense Added', `${formatKES(amountCents)} recorded`);
    await loadExpenses();
  };

  const handleScanReceipt = async () => {
    const base64 = await captureReceiptImage();
    if (!base64) {
      Alert.alert('Camera', 'Could not capture image');
      return;
    }

    Alert.alert('Scanning...', 'Analyzing receipt with AI...');
    const result = await scanReceipt(base64);
    if (!result) {
      Alert.alert('Scan Failed', 'Could not parse receipt. Try manual entry.');
      return;
    }

    // Edge function handles storage upload and returns imageUrl
    if (result.imageUrl) {
      setReceiptImageUrl(result.imageUrl);
    }

    // Pre-fill the form with scanned data
    setDescription(
      result.items.map((i) => i.description).join(', ') || 'Scanned expense'
    );
    setAmount(String((result.totalAmount || 0) / 100));
    setVendorName(result.vendorName || '');

    // Try to match category
    if (result.category) {
      const match = categories.find(
        (c) => c.name.toLowerCase().includes(result.category!.toLowerCase())
      );
      if (match) setSelectedCatId(match.id);
    }

    setShowAdd(true);
    Alert.alert('Receipt Scanned', 'Review and adjust the details before saving.');
  };

  const todayTotal = expenses
    .filter((e) => e.expenseDate === new Date().toISOString().split('T')[0])
    .reduce((sum, e) => sum + e.amount, 0);

  return (
    <SafeAreaView className="flex-1 bg-surface">
      <View className="flex-row items-center justify-between px-4 pt-2 pb-1">
        <View>
          <Text className="text-xl font-bold text-primary">Expenses</Text>
          <Text className="text-sm text-gray-500">Today: {formatKES(todayTotal)}</Text>
        </View>
        <View className="flex-row">
          <TouchableOpacity
            className="bg-purple-600 px-3 py-2 rounded-lg mr-2"
            onPress={handleScanReceipt}
          >
            <Text className="text-white font-medium">Scan</Text>
          </TouchableOpacity>
          <TouchableOpacity className="bg-primary px-4 py-2 rounded-lg" onPress={() => setShowAdd(true)}>
            <Text className="text-white font-medium">+ Manual</Text>
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" />
          <Text className="text-gray-400 mt-2">Loading...</Text>
        </View>
      ) : (
        <ScrollView className="flex-1 p-4">
          {expenses.length === 0 ? (
            <Text className="text-gray-400 text-center mt-8">No expenses recorded yet.</Text>
          ) : (
            expenses.map((exp) => (
              <View key={exp.id} className="bg-white rounded-xl p-4 mb-2 border border-gray-100">
                <View className="flex-row justify-between items-start">
                  <View className="flex-1">
                  <Text className="text-base font-medium text-primary">{exp.description}</Text>
                  <Text className="text-xs text-gray-500">
                    {catNames[exp.categoryId] || 'Other'} · {exp.expenseDate}
                  </Text>
                  {exp.vendorName ? <Text className="text-xs text-gray-400">Vendor: {exp.vendorName}</Text> : null}
                  <Text className="text-xs text-gray-400">Paid by: {exp.paidBy}</Text>
                </View>
                <Text className="text-base font-bold text-red-600">{formatKES(exp.amount)}</Text>
              </View>
            </View>
          ))
        )}
        </ScrollView>
      )}

      {/* Add Expense Modal */}
      <Modal visible={showAdd} transparent animationType="fade">
        <View className="flex-1 bg-black/50 justify-center items-center p-8">
          <View className="bg-white rounded-2xl p-6 w-full max-w-sm">
            <Text className="text-lg font-bold text-primary mb-4">Record Expense</Text>

            <Text className="text-sm font-medium text-gray-600 mb-2">Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-3">
              <View className="flex-row">
                {categories.map((cat) => (
                  <TouchableOpacity
                    key={cat.id}
                    className={`px-3 py-2 rounded-lg mr-2 ${selectedCatId === cat.id ? 'bg-primary' : 'bg-gray-100'}`}
                    onPress={() => setSelectedCatId(cat.id)}
                  >
                    <Text className={`text-sm ${selectedCatId === cat.id ? 'text-white' : 'text-gray-700'}`}>
                      {cat.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text className="text-sm font-medium text-gray-600 mb-1">Description *</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-3"
              value={description}
              onChangeText={setDescription}
              placeholder="e.g. Bought cleaning supplies"
              placeholderTextColor="#9ca3af"
            />

            <Text className="text-sm font-medium text-gray-600 mb-1">Amount (KES) *</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-3"
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor="#9ca3af"
              keyboardType="numeric"
            />

            <Text className="text-sm font-medium text-gray-600 mb-1">Vendor Name</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-3"
              value={vendorName}
              onChangeText={setVendorName}
              placeholder="Optional"
              placeholderTextColor="#9ca3af"
            />

            <Text className="text-sm font-medium text-gray-600 mb-1">Paid By</Text>
            <TextInput
              className="border border-gray-300 rounded-xl p-3 text-base mb-4"
              value={paidBy}
              onChangeText={setPaidBy}
              placeholder={currentStaff?.name || 'Staff name'}
              placeholderTextColor="#9ca3af"
            />

            <View className="flex-row justify-end">
              <TouchableOpacity className="px-4 py-2 mr-2" onPress={() => setShowAdd(false)}>
                <Text className="text-gray-500">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity className="bg-primary px-6 py-2 rounded-lg" onPress={handleAddExpense}>
                <Text className="text-white font-medium">Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
