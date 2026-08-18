import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  Alert, ActivityIndicator, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, router } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { database } from '@/lib/db';
import { Expense, ExpenseCategory } from '@/lib/db/models';
import { Q } from '@nozbe/watermelondb';
import { formatKES, toCents } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';
import { captureReceiptImage, scanReceipt } from '@/lib/ai/receiptScan';

// ─── constants ───────────────────────────────────────────────────────────────

const INDIGO   = '#4338CA';
const INDIGO_L = '#6366f1';
const INDIGO_D = '#1e1b4b';
const BG       = '#f0f2ff';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

// ─── helpers ─────────────────────────────────────────────────────────────────

function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  return d;
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function daysElapsed(date: Date): number {
  const now = new Date();
  const isCurrentMonth =
    now.getFullYear() === date.getFullYear() && now.getMonth() === date.getMonth();
  return isCurrentMonth ? now.getDate() : new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// ─── component ───────────────────────────────────────────────────────────────

export default function ExpensesScreen() {
  const [allExpenses, setAllExpenses]     = useState<Expense[]>([]);
  const [categories, setCategories]       = useState<ExpenseCategory[]>([]);
  const [catNames, setCatNames]           = useState<Record<string, string>>({});
  const [viewMonth, setViewMonth]         = useState(new Date());
  const [loading, setLoading]             = useState(false);

  // Add expense form state
  const [showAdd, setShowAdd]             = useState(false);
  const [selectedCatId, setSelectedCatId] = useState('');
  const [description, setDescription]     = useState('');
  const [amount, setAmount]               = useState('');
  const [paidBy, setPaidBy]               = useState('');
  const [vendorName, setVendorName]       = useState('');
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);

  const currentStaff = useAuthStore((s) => s.currentStaff);

  // ── pulse animation ──────────────────────────────────────────────────────

  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.35, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  // ── data loading ─────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    const data = await database
      .get<Expense>('expenses')
      .query(Q.sortBy('created_at', Q.desc), Q.take(200))
      .fetch();
    setAllExpenses(data);

    const cats = await database.get<ExpenseCategory>('expense_categories').query().fetch();
    setCategories(cats);
    const names: Record<string, string> = {};
    for (const c of cats) names[c.id] = c.name;
    setCatNames(names);
    if (cats.length > 0 && !selectedCatId) setSelectedCatId(cats[0].id);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { loadData(); }, [loadData]));

  // ── filtered expenses for selected month ─────────────────────────────────

  const mk = monthKey(viewMonth);
  const monthExpenses = allExpenses.filter((e) => e.expenseDate?.startsWith(mk));
  const monthTotal    = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const days          = daysElapsed(viewMonth);
  const avgPerDay     = days > 0 ? Math.round(monthTotal / days) : 0;

  // Biggest category
  const catTotals: Record<string, number> = {};
  for (const e of monthExpenses) {
    catTotals[e.categoryId] = (catTotals[e.categoryId] || 0) + e.amount;
  }
  const biggestCatId = Object.keys(catTotals).reduce(
    (best, id) => (catTotals[id] > (catTotals[best] || 0) ? id : best),
    ''
  );
  const biggestCatName = biggestCatId ? (catNames[biggestCatId] || '—') : '—';

  // ── add expense ───────────────────────────────────────────────────────────

  const resetForm = () => {
    setDescription(''); setAmount(''); setPaidBy('');
    setVendorName(''); setReceiptImageUrl(null);
  };

  const openAdd = () => {
    resetForm();
    setShowAdd(true);
  };

  const handleAddExpense = async () => {
    if (!description.trim() || !amount.trim() || !selectedCatId) {
      Alert.alert('Missing fields', 'Please fill in Description, Amount and Category.');
      return;
    }
    const amountCents = toCents(parseFloat(amount) || 0);
    if (amountCents <= 0) { Alert.alert('Invalid', 'Amount must be greater than 0.'); return; }

    await database.write(async () => {
      await database.get<Expense>('expenses').create((e) => {
        e.categoryId     = selectedCatId;
        e.description    = description.trim();
        e.amount         = amountCents;
        e.paidBy         = paidBy.trim() || currentStaff!.name;
        e.loggedBy       = currentStaff!.id;
        e.expenseDate    = new Date().toISOString().split('T')[0];
        e.receiptPhotoUrl = receiptImageUrl;
        e.source         = receiptImageUrl ? 'scanned' : 'manual';
        e.vendorName     = vendorName.trim() || null;
      });
    });

    resetForm();
    setShowAdd(false);
    Alert.alert('Saved', `${formatKES(amountCents)} expense recorded.`);
    await loadData();
  };

  // ── receipt scan ──────────────────────────────────────────────────────────

  const handleScanReceipt = async () => {
    setShowAdd(false);
    const base64 = await captureReceiptImage();
    if (!base64) { Alert.alert('Camera', 'Could not capture image'); return; }
    Alert.alert('Scanning…', 'Analysing receipt with AI…');
    const result = await scanReceipt(base64);
    if (!result) { Alert.alert('Scan failed', 'Could not parse receipt. Try manual entry.'); setShowAdd(true); return; }
    if (result.imageUrl) setReceiptImageUrl(result.imageUrl);
    setDescription(result.items.map((i: any) => i.description).join(', ') || 'Scanned expense');
    setAmount(String((result.totalAmount || 0) / 100));
    setVendorName(result.vendorName || '');
    if (result.category) {
      const match = categories.find((c) => c.name.toLowerCase().includes(result.category!.toLowerCase()));
      if (match) setSelectedCatId(match.id);
    }
    setShowAdd(true);
  };

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaView style={{ flex: 1 }}>
        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={INDIGO} />
          </TouchableOpacity>
          <Text style={{ fontSize: 18, fontWeight: '700', color: INDIGO_D }}>Expenses</Text>
          <View style={{ width: 22 }} />
        </View>

        {/* Month navigator */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10 }}>
          <TouchableOpacity onPress={() => setViewMonth((m) => addMonths(m, -1))} style={{ padding: 8 }}>
            <Feather name="chevron-left" size={20} color={INDIGO} />
          </TouchableOpacity>
          <Text style={{ fontSize: 16, fontWeight: '700', color: INDIGO_D, marginHorizontal: 16 }}>
            {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
          </Text>
          <TouchableOpacity onPress={() => setViewMonth((m) => addMonths(m, 1))} style={{ padding: 8 }}>
            <Feather name="chevron-right" size={20} color={INDIGO} />
          </TouchableOpacity>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
          {/* Summary card */}
          <View style={{
            backgroundColor: INDIGO, borderRadius: 20, padding: 22, marginBottom: 14,
            shadowColor: INDIGO, shadowOpacity: 0.4, shadowRadius: 12, elevation: 6,
          }}>
            <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 13, marginBottom: 6 }}>This month</Text>
            <Text style={{ color: '#fff', fontSize: 34, fontWeight: '800', marginBottom: 4 }}>
              {formatKES(monthTotal)}
            </Text>
            <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>
              {monthExpenses.length > 0
                ? `${monthExpenses.length} expense${monthExpenses.length !== 1 ? 's' : ''} recorded`
                : 'No expenses recorded yet'}
            </Text>
          </View>

          {/* KPI tiles */}
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 14 }}>
            <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                <Feather name="tag" size={16} color={INDIGO} />
              </View>
              <Text style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Biggest category</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: INDIGO_D }}>{biggestCatName}</Text>
              {biggestCatId && (
                <Text style={{ fontSize: 12, color: INDIGO, marginTop: 2 }}>{formatKES(catTotals[biggestCatId] || 0)}</Text>
              )}
            </View>
            <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 }}>
              <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: '#dcfce7', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                <Feather name="calendar" size={16} color="#16a34a" />
              </View>
              <Text style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Avg / day</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: INDIGO_D }}>{formatKES(avgPerDay)}</Text>
              <Text style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{monthExpenses.length} expenses</Text>
            </View>
          </View>

          {/* Expense list */}
          <Text style={{ fontSize: 14, fontWeight: '700', color: INDIGO_D, marginBottom: 10 }}>
            {MONTH_NAMES[viewMonth.getMonth()]} Expenses
          </Text>

          {loading ? (
            <ActivityIndicator color={INDIGO} style={{ marginTop: 32 }} />
          ) : monthExpenses.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Feather name="inbox" size={40} color="#c4b5fd" />
              <Text style={{ color: '#94a3b8', marginTop: 12, fontSize: 14 }}>No expenses this month</Text>
              <Text style={{ color: '#c4b5fd', fontSize: 12, marginTop: 4 }}>Tap + to add one</Text>
            </View>
          ) : (
            monthExpenses.map((exp) => (
              <View key={exp.id} style={{
                backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10,
                flexDirection: 'row', alignItems: 'center',
                shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1,
              }}>
                <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: '#ede9fe', alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                  <Feather name="file-text" size={18} color={INDIGO} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: INDIGO_D }} numberOfLines={1}>{exp.description}</Text>
                  <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                    {catNames[exp.categoryId] || 'Other'} · {exp.expenseDate}
                    {exp.vendorName ? ` · ${exp.vendorName}` : ''}
                  </Text>
                  <Text style={{ fontSize: 10, color: '#c4b5fd', marginTop: 1 }}>Paid by {exp.paidBy}</Text>
                </View>
                <Text style={{ fontSize: 15, fontWeight: '800', color: '#dc2626' }}>{formatKES(exp.amount)}</Text>
              </View>
            ))
          )}
        </ScrollView>

        {/* Floating FAB with pulse */}
        <View style={{ position: 'absolute', bottom: 28, left: 0, right: 0, alignItems: 'center' }} pointerEvents="box-none">
          <Animated.View style={{
            position: 'absolute',
            width: 68, height: 68, borderRadius: 34,
            backgroundColor: INDIGO,
            opacity: 0.28,
            transform: [{ scale: pulse }],
          }} />
          <TouchableOpacity
            onPress={openAdd}
            style={{
              width: 60, height: 60, borderRadius: 30,
              backgroundColor: INDIGO,
              alignItems: 'center', justifyContent: 'center',
              shadowColor: INDIGO, shadowOpacity: 0.55, shadowRadius: 12, elevation: 10,
            }}
            activeOpacity={0.85}
          >
            <Feather name="plus" size={28} color="#fff" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* ── Add Expense Modal ───────────────────────────────────────────────── */}
      <Modal visible={showAdd} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 36 }}>
            {/* Modal header */}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: INDIGO_D }}>Record Expense</Text>
              <TouchableOpacity onPress={() => setShowAdd(false)}>
                <Feather name="x" size={22} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {/* Scan receipt shortcut */}
            <TouchableOpacity
              onPress={handleScanReceipt}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#ede9fe', borderRadius: 12, padding: 12, marginBottom: 18 }}
            >
              <Feather name="camera" size={18} color={INDIGO} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: INDIGO, marginLeft: 10 }}>Scan a receipt instead</Text>
            </TouchableOpacity>

            {/* Category pills */}
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {categories.map((cat) => (
                  <TouchableOpacity
                    key={cat.id}
                    onPress={() => setSelectedCatId(cat.id)}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                      backgroundColor: selectedCatId === cat.id ? INDIGO : '#f1f5f9',
                    }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: selectedCatId === cat.id ? '#fff' : '#475569' }}>
                      {cat.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            {/* Description */}
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>Description *</Text>
            <TextInput
              style={{ borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, padding: 12, fontSize: 15, marginBottom: 14, color: INDIGO_D }}
              value={description}
              onChangeText={setDescription}
              placeholder="e.g. Cleaning supplies"
              placeholderTextColor="#94a3b8"
            />

            {/* Amount */}
            <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>Amount (KES) *</Text>
            <TextInput
              style={{ borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, padding: 12, fontSize: 15, marginBottom: 14, color: INDIGO_D }}
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              placeholderTextColor="#94a3b8"
              keyboardType="numeric"
            />

            {/* Vendor + Paid By in a row */}
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 22 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>Vendor</Text>
                <TextInput
                  style={{ borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, padding: 12, fontSize: 14, color: INDIGO_D }}
                  value={vendorName}
                  onChangeText={setVendorName}
                  placeholder="Optional"
                  placeholderTextColor="#94a3b8"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748b', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>Paid By</Text>
                <TextInput
                  style={{ borderWidth: 1.5, borderColor: '#e2e8f0', borderRadius: 12, padding: 12, fontSize: 14, color: INDIGO_D }}
                  value={paidBy}
                  onChangeText={setPaidBy}
                  placeholder={currentStaff?.name || 'Staff'}
                  placeholderTextColor="#94a3b8"
                />
              </View>
            </View>

            {/* Save button */}
            <TouchableOpacity
              onPress={handleAddExpense}
              style={{ backgroundColor: INDIGO, borderRadius: 14, paddingVertical: 15, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>Save Expense</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
