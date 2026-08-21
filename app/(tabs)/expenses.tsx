import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal, TextInput,
  Alert, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { database } from '@/lib/db';
import { Expense, ExpenseCategory } from '@/lib/db/models';
import { Q } from '@nozbe/watermelondb';
import { formatKES, toCents } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';
import { captureReceiptImage, scanReceipt } from '@/lib/ai/receiptScan';
import { triggerAutoSync } from '@/lib/db/sync';

// ─── constants ───────────────────────────────────────────────────────────────

const BG        = '#F0F2FF';
const INDIGO    = '#4338CA';
const INDIGO_D  = '#1E1B4B';
const LAVENDER  = '#EDE9FE';
const MINT_BG   = '#DCFCE7';
const MINT      = '#16A34A';
const COACH_BG  = '#EAEBFF';
const MUTED     = '#94A3B8';
const ICON_OFF  = '#4B5563';
const LABEL_OFF = '#6B7280';

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];

type ActiveTab = 'home' | 'receipts' | 'analytics' | 'assistant';

// ─── helpers ─────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatKsh(cents: number): string {
  return `Ksh ${Math.round(cents / 100).toLocaleString('en-KE')}`;
}

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
  const isCurrent =
    now.getFullYear() === date.getFullYear() && now.getMonth() === date.getMonth();
  return isCurrent ? now.getDate() : new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

// ─── TabItem ──────────────────────────────────────────────────────────────────

function TabItem({
  icon, label, active, onPress,
}: { icon: string; label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ flex: 1, alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
      <Feather name={icon as any} size={24} color={active ? INDIGO : ICON_OFF} />
      <Text style={{ fontSize: 11, marginTop: 4, color: active ? INDIGO : LABEL_OFF, fontWeight: active ? '700' : '500' }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

// ─── component ───────────────────────────────────────────────────────────────

export default function ExpensesScreen() {
  const insets = useSafeAreaInsets();
  const [allExpenses, setAllExpenses]     = useState<Expense[]>([]);
  const [categories, setCategories]       = useState<ExpenseCategory[]>([]);
  const [catNames, setCatNames]           = useState<Record<string, string>>({});
  const [viewMonth, setViewMonth]         = useState(new Date());
  const [loading, setLoading]             = useState(false);
  const [refreshing, setRefreshing]       = useState(false);
  const [activeTab, setActiveTab]         = useState<ActiveTab>('home');
  const [assistantSubTab, setAssistantSubTab] = useState<'ai' | 'search'>('ai');
  const [chatInput, setChatInput]         = useState('');
  const [chatMessages, setChatMessages]   = useState<Array<{ role: 'user' | 'bot'; text: string }>>([]);
  const [searchQuery, setSearchQuery]     = useState('');

  // Add expense form
  const [showAdd, setShowAdd]             = useState(false);
  const [selectedCatId, setSelectedCatId] = useState('');
  const [description, setDescription]     = useState('');
  const [amount, setAmount]               = useState('');
  const [paidBy, setPaidBy]               = useState('');
  const [vendorName, setVendorName]       = useState('');
  const [receiptImageUrl, setReceiptImageUrl] = useState<string | null>(null);

  const currentStaff = useAuthStore((s) => s.currentStaff);

  // ── data loading ──────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    const data = await database
      .get<Expense>('expenses')
      .query(Q.sortBy('created_at', Q.desc), Q.take(500))
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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // ── computed ──────────────────────────────────────────────────────────────

  const mk            = monthKey(viewMonth);
  const monthExpenses = allExpenses.filter((e) => e.expenseDate?.startsWith(mk));
  const monthTotal    = monthExpenses.reduce((s, e) => s + e.amount, 0);
  const days          = daysElapsed(viewMonth);
  const avgPerDay     = days > 0 ? Math.round(monthTotal / days) : 0;

  const priorMk       = monthKey(addMonths(viewMonth, -1));
  const priorTotal    = allExpenses.filter((e) => e.expenseDate?.startsWith(priorMk)).reduce((s, e) => s + e.amount, 0);

  const catTotals: Record<string, number> = {};
  for (const e of monthExpenses) catTotals[e.categoryId] = (catTotals[e.categoryId] || 0) + e.amount;
  const biggestCatId   = Object.keys(catTotals).reduce((b, id) => (catTotals[id] > (catTotals[b] || 0) ? id : b), '');
  const biggestCatName = biggestCatId ? (catNames[biggestCatId] || '—') : '—';

  const totalScanned   = allExpenses.filter((e) => e.source === 'scanned').length;
  const scoreUnlocked  = totalScanned >= 5;

  // ── form helpers ──────────────────────────────────────────────────────────

  const resetForm = () => { setDescription(''); setAmount(''); setPaidBy(''); setVendorName(''); setReceiptImageUrl(null); };
  const openAdd   = () => { resetForm(); setShowAdd(true); };

  const handleAddExpense = async () => {
    if (!description.trim() || !amount.trim() || !selectedCatId) {
      Alert.alert('Missing fields', 'Please fill in Description, Amount and Category.');
      return;
    }
    const amountCents = toCents(parseFloat(amount) || 0);
    if (amountCents <= 0) { Alert.alert('Invalid', 'Amount must be greater than 0.'); return; }

    await database.write(async () => {
      await database.get<Expense>('expenses').create((e) => {
        e.categoryId      = selectedCatId;
        e.description     = description.trim();
        e.amount          = amountCents;
        e.paidBy          = paidBy.trim() || currentStaff!.name;
        e.loggedBy        = currentStaff!.id;
        e.expenseDate     = new Date().toISOString().split('T')[0];
        e.receiptPhotoUrl = receiptImageUrl;
        e.source          = receiptImageUrl ? 'scanned' : 'manual';
        e.vendorName      = vendorName.trim() || null;
      });
    });

    resetForm(); setShowAdd(false);
    Alert.alert('Saved', `${formatKES(amountCents)} expense recorded.`);
    triggerAutoSync();
    await loadData();
  };

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

  // ── assistant helpers ─────────────────────────────────────────────────────

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    const userMsg = chatInput.trim();
    setChatInput('');
    const q = userMsg.toLowerCase();
    let botText = '';
    if (q.includes('last month') || q.includes('prior month')) {
      botText = priorTotal > 0 ? `Last month you spent ${formatKsh(priorTotal)}.` : 'No expenses recorded for last month.';
    } else if ((q.includes('biggest') || q.includes('most')) && q.includes('categor')) {
      botText = biggestCatId ? `Your biggest expense category is "${biggestCatName}" — ${formatKsh(catTotals[biggestCatId] || 0)} this month.` : 'No expense categories found for this month.';
    } else if (q.includes('supplier') || q.includes('vendor')) {
      const vt: Record<string, number> = {};
      for (const e of allExpenses) { if (e.vendorName) vt[e.vendorName] = (vt[e.vendorName] || 0) + e.amount; }
      const top = Object.entries(vt).sort((a, b) => b[1] - a[1])[0];
      botText = top ? `Your top supplier is "${top[0]}" at ${formatKsh(top[1])}.` : 'No vendor data recorded yet.';
    } else if (q.includes('average') || q.includes('avg') || q.includes('per day')) {
      botText = `Your daily spending average this month is ${formatKsh(avgPerDay)}.`;
    } else {
      botText = monthExpenses.length > 0
        ? `This month: ${formatKsh(monthTotal)} across ${monthExpenses.length} expense${monthExpenses.length !== 1 ? 's' : ''}. Biggest category: ${biggestCatName}.`
        : 'No expenses recorded this month yet.';
    }
    setChatMessages(prev => [...prev, { role: 'user' as const, text: userMsg }, { role: 'bot' as const, text: botText }]);
  };

  const filteredExpenses = searchQuery.trim()
    ? allExpenses.filter(e =>
        e.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (e.vendorName ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (catNames[e.categoryId] ?? '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  const MonthNav = () => (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 }}>
      <TouchableOpacity onPress={() => setViewMonth(m => addMonths(m, -1))} style={{ padding: 6 }}>
        <Feather name="chevron-left" size={20} color="#374151" />
      </TouchableOpacity>
      <Text style={{ fontSize: 17, fontWeight: '700', color: '#111827', marginHorizontal: 20 }}>
        {MONTH_NAMES[viewMonth.getMonth()]} {viewMonth.getFullYear()}
      </Text>
      <TouchableOpacity onPress={() => setViewMonth(m => addMonths(m, 1))} style={{ padding: 6 }}>
        <Feather name="chevron-right" size={20} color="#374151" />
      </TouchableOpacity>
    </View>
  );

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1, backgroundColor: BG }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>

        {/* ── HOME TAB ──────────────────────────────────────────────────── */}
        {activeTab === 'home' && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={INDIGO} />}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, paddingBottom: 4 }}>
              <Text style={{ fontSize: 26, fontWeight: '700', color: '#111827' }}>{getGreeting()}</Text>
              <TouchableOpacity onPress={loadData} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="refresh-cw" size={20} color="#555" />
              </TouchableOpacity>
            </View>
            <MonthNav />
            <LinearGradient colors={['#4F46E5', '#312E81']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{ borderRadius: 22, padding: 26, marginBottom: 16 }}>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, marginBottom: 10 }}>This month</Text>
              <Text style={{ color: '#fff', fontSize: 40, fontWeight: '800', letterSpacing: -1, marginBottom: 8 }}>{formatKsh(monthTotal)}</Text>
              <Text style={{ color: 'rgba(255,255,255,0.55)', fontSize: 13 }}>
                {priorTotal > 0 ? `${formatKsh(priorTotal)} last month` : 'No prior month'}
              </Text>
            </LinearGradient>
            <View style={{ backgroundColor: '#fff', borderRadius: 18, padding: 18, flexDirection: 'row', alignItems: 'center', marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 3 }}>
              <View style={{ width: 48, height: 48, borderRadius: 14, backgroundColor: LAVENDER, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
                <Feather name="bar-chart-2" size={22} color={INDIGO} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 4 }}>Business Health Score</Text>
                <Text style={{ fontSize: 13, color: MUTED, lineHeight: 19 }}>
                  {scoreUnlocked ? 'Your score is unlocked — keep scanning!' : 'Scan at least 5 receipts to unlock your score'}
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 28 }}>
              <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 18, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 }}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: LAVENDER, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  <Feather name="layers" size={18} color={INDIGO} />
                </View>
                <Text style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>Biggest category</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827' }}>{biggestCatName}</Text>
              </View>
              <View style={{ flex: 1, backgroundColor: '#fff', borderRadius: 18, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, elevation: 2 }}>
                <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: MINT_BG, alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
                  <Feather name="calendar" size={18} color={MINT} />
                </View>
                <Text style={{ fontSize: 12, color: MUTED, marginBottom: 6 }}>Avg / day</Text>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827' }}>{formatKsh(avgPerDay)}</Text>
                <Text style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>{monthExpenses.length} receipts</Text>
              </View>
            </View>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 12 }}>Financial coach</Text>
            <View style={{ backgroundColor: COACH_BG, borderRadius: 18, padding: 18, flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: LAVENDER, alignItems: 'center', justifyContent: 'center', marginRight: 14 }}>
                <Feather name="zap" size={20} color={INDIGO} />
              </View>
              <Text style={{ flex: 1, fontSize: 14, color: '#374151', lineHeight: 21 }}>
                {monthExpenses.length === 0 ? 'Scan your first receipt to unlock personalised money insights.' : `You've spent ${formatKsh(monthTotal)} this month across ${monthExpenses.length} receipt${monthExpenses.length !== 1 ? 's' : ''}.`}
              </Text>
            </View>
          </ScrollView>
        )}

        {/* ── RECEIPTS TAB ──────────────────────────────────────────────── */}
        {activeTab === 'receipts' && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={INDIGO} />}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, paddingBottom: 4 }}>
              <Text style={{ fontSize: 22, fontWeight: '700', color: '#111827' }}>Receipts</Text>
              <TouchableOpacity onPress={loadData} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="refresh-cw" size={20} color="#555" />
              </TouchableOpacity>
            </View>
            <MonthNav />
            {loading ? (
              <ActivityIndicator color={INDIGO} style={{ marginTop: 40 }} />
            ) : monthExpenses.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 60 }}>
                <Feather name="inbox" size={48} color="#C4B5FD" />
                <Text style={{ color: MUTED, marginTop: 16, fontSize: 15 }}>No expenses this month</Text>
                <Text style={{ color: '#C4B5FD', fontSize: 13, marginTop: 4 }}>Tap the + button to add one</Text>
              </View>
            ) : (
              monthExpenses.map((exp) => (
                <View key={exp.id} style={{ backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: LAVENDER, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                    <Feather name="file-text" size={18} color={INDIGO} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: INDIGO_D }} numberOfLines={1}>{exp.description}</Text>
                    <Text style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                      {catNames[exp.categoryId] || 'Other'} · {exp.expenseDate}{exp.vendorName ? ` · ${exp.vendorName}` : ''}
                    </Text>
                    <Text style={{ fontSize: 10, color: '#C4B5FD', marginTop: 1 }}>Paid by {exp.paidBy}</Text>
                  </View>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: '#DC2626' }}>{formatKES(exp.amount)}</Text>
                </View>
              ))
            )}
          </ScrollView>
        )}

        {/* ── ANALYTICS TAB ─────────────────────────────────────────────── */}
        {activeTab === 'analytics' && (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={INDIGO} />}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 14, paddingBottom: 4 }}>
              <Text style={{ fontSize: 22, fontWeight: '700', color: '#111827' }}>Analytics</Text>
              <TouchableOpacity onPress={loadData} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Feather name="refresh-cw" size={20} color="#555" />
              </TouchableOpacity>
            </View>
            <MonthNav />
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
              {([
                { label: 'Total', value: formatKsh(monthTotal), icon: 'trending-up', bg: LAVENDER, col: INDIGO },
                { label: 'Avg/Day', value: formatKsh(avgPerDay), icon: 'calendar', bg: MINT_BG, col: MINT },
                { label: 'Expenses', value: String(monthExpenses.length), icon: 'file-text', bg: '#FEF3C7', col: '#D97706' },
              ] as const).map(item => (
                <View key={item.label} style={{ flex: 1, backgroundColor: '#fff', borderRadius: 16, padding: 12, alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 }}>
                  <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: item.bg, alignItems: 'center', justifyContent: 'center', marginBottom: 8 }}>
                    <Feather name={item.icon as any} size={16} color={item.col} />
                  </View>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: '#111827' }}>{item.value}</Text>
                  <Text style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>{item.label}</Text>
                </View>
              ))}
            </View>
            <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 }}>Spending by Category</Text>
            {Object.keys(catTotals).length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Feather name="pie-chart" size={40} color="#C4B5FD" />
                <Text style={{ color: MUTED, marginTop: 12, fontSize: 14 }}>No data for this month</Text>
              </View>
            ) : (
              Object.entries(catTotals).sort((a, b) => b[1] - a[1]).map(([catId, total]) => {
                const pct = monthTotal > 0 ? (total / monthTotal) * 100 : 0;
                return (
                  <View key={catId} style={{ backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: INDIGO_D }}>{catNames[catId] || 'Other'}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={{ fontSize: 11, color: MUTED }}>{pct.toFixed(0)}%</Text>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#DC2626' }}>{formatKsh(total)}</Text>
                      </View>
                    </View>
                    <View style={{ height: 6, backgroundColor: '#F1F5F9', borderRadius: 3 }}>
                      <View style={{ height: 6, width: `${pct}%` as any, backgroundColor: INDIGO, borderRadius: 3 }} />
                    </View>
                  </View>
                );
              })
            )}
            {monthExpenses.length > 0 && (
              <>
                <Text style={{ fontSize: 16, fontWeight: '700', color: '#111827', marginTop: 8, marginBottom: 12 }}>Top Expenses</Text>
                {[...monthExpenses].sort((a, b) => b.amount - a.amount).slice(0, 5).map((exp) => (
                  <View key={exp.id} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: INDIGO_D }} numberOfLines={1}>{exp.description}</Text>
                      <Text style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{catNames[exp.categoryId] || 'Other'} · {exp.expenseDate}</Text>
                    </View>
                    <Text style={{ fontSize: 14, fontWeight: '800', color: '#DC2626' }}>{formatKsh(exp.amount)}</Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        )}

        {/* ── ASSISTANT TAB ─────────────────────────────────────────────── */}
        {activeTab === 'assistant' && (
          <View style={{ flex: 1 }}>
            {/* Sub-tabs */}
            <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E5E7EB' }}>
              {(['ai', 'search'] as const).map(t => (
                <TouchableOpacity key={t} onPress={() => setAssistantSubTab(t)}
                  style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}>
                  <Feather name={t === 'ai' ? 'cpu' : 'search'} size={18} color={assistantSubTab === t ? INDIGO : ICON_OFF} />
                  <Text style={{ fontSize: 12, fontWeight: '600', marginTop: 3, color: assistantSubTab === t ? INDIGO : LABEL_OFF }}>
                    {t === 'ai' ? 'Ask AI' : 'Search'}
                  </Text>
                  {assistantSubTab === t && (
                    <View style={{ position: 'absolute', bottom: 0, left: '25%', right: '25%', height: 2.5, backgroundColor: INDIGO, borderRadius: 2 }} />
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Ask AI */}
            {assistantSubTab === 'ai' && (
              <>
                {chatMessages.length === 0 ? (
                  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 36, paddingBottom: 20, alignItems: 'center' }}>
                    <View style={{ width: 80, height: 80, borderRadius: 20, backgroundColor: LAVENDER, alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
                      <Feather name="cpu" size={40} color={INDIGO} />
                    </View>
                    <Text style={{ fontSize: 24, fontWeight: '800', color: INDIGO_D, marginBottom: 10 }}>Ask Your Business</Text>
                    <Text style={{ fontSize: 14, color: MUTED, textAlign: 'center', lineHeight: 22, marginBottom: 32 }}>
                      Ask anything about your spending, suppliers, or expenses.
                    </Text>
                    <Text style={{ fontSize: 13, color: MUTED, alignSelf: 'flex-start', marginBottom: 12 }}>Try asking:</Text>
                    {[
                      'How much did I spend last month?',
                      'Which supplier costs me the most?',
                      'What is my biggest expense category?',
                      'How much have I spent this month?',
                    ].map(q => (
                      <TouchableOpacity key={q} onPress={() => setChatInput(q)}
                        style={{ width: '100%', flexDirection: 'row', alignItems: 'center', backgroundColor: LAVENDER, borderRadius: 14, padding: 16, marginBottom: 10 }}>
                        <Feather name="message-square" size={16} color={INDIGO} style={{ marginRight: 12 }} />
                        <Text style={{ flex: 1, fontSize: 14, color: INDIGO_D, fontWeight: '500' }}>{q}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                ) : (
                  <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 16, paddingBottom: 16 }}>
                    {chatMessages.map((msg, i) => (
                      <View key={i} style={{ flexDirection: 'row', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
                        {msg.role === 'bot' && (
                          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: LAVENDER, alignItems: 'center', justifyContent: 'center', marginRight: 8, marginTop: 2 }}>
                            <Feather name="cpu" size={14} color={INDIGO} />
                          </View>
                        )}
                        <View style={{ maxWidth: '75%', backgroundColor: msg.role === 'user' ? INDIGO : '#fff', borderRadius: 16, padding: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 }}>
                          <Text style={{ fontSize: 14, color: msg.role === 'user' ? '#fff' : INDIGO_D, lineHeight: 21 }}>{msg.text}</Text>
                        </View>
                      </View>
                    ))}
                  </ScrollView>
                )}
              </>
            )}

            {/* Search */}
            {assistantSubTab === 'search' && (
              <View style={{ flex: 1 }}>
                <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F5F9', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10 }}>
                    <Feather name="search" size={16} color={MUTED} style={{ marginRight: 10 }} />
                    <TextInput style={{ flex: 1, fontSize: 14, color: INDIGO_D }} value={searchQuery} onChangeText={setSearchQuery}
                      placeholder="Search expenses..." placeholderTextColor={MUTED} />
                    {searchQuery.length > 0 && (
                      <TouchableOpacity onPress={() => setSearchQuery('')}>
                        <Feather name="x" size={16} color={MUTED} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingBottom: 120 }}>
                  {searchQuery.trim().length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                      <Feather name="search" size={40} color="#C4B5FD" />
                      <Text style={{ color: MUTED, marginTop: 12, fontSize: 14 }}>Type to search expenses</Text>
                    </View>
                  ) : filteredExpenses.length === 0 ? (
                    <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                      <Feather name="inbox" size={40} color="#C4B5FD" />
                      <Text style={{ color: MUTED, marginTop: 12, fontSize: 14 }}>No results for "{searchQuery}"</Text>
                    </View>
                  ) : (
                    filteredExpenses.map(exp => (
                      <View key={exp.id} style={{ backgroundColor: '#fff', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 }}>
                        <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: LAVENDER, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                          <Feather name="file-text" size={18} color={INDIGO} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: 14, fontWeight: '600', color: INDIGO_D }} numberOfLines={1}>{exp.description}</Text>
                          <Text style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{catNames[exp.categoryId] || 'Other'} · {exp.expenseDate}{exp.vendorName ? ` · ${exp.vendorName}` : ''}</Text>
                        </View>
                        <Text style={{ fontSize: 14, fontWeight: '800', color: '#DC2626' }}>{formatKES(exp.amount)}</Text>
                      </View>
                    ))
                  )}
                </ScrollView>
              </View>
            )}
          </View>
        )}

        {/* ── Bottom Navigation Bar ────────────────────────────────────── */}
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          {/* Chat input — visible only on Assistant AI sub-tab */}
          {activeTab === 'assistant' && assistantSubTab === 'ai' && (
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E5E7EB' }}>
              <View style={{ flex: 1, backgroundColor: '#F1F5F9', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 10, marginRight: 10 }}>
                <TextInput
                  style={{ fontSize: 14, color: INDIGO_D }}
                  value={chatInput}
                  onChangeText={setChatInput}
                  placeholder="Ask about your spending..."
                  placeholderTextColor={MUTED}
                  onSubmitEditing={handleSendMessage}
                  returnKeyType="send"
                />
              </View>
              <TouchableOpacity onPress={handleSendMessage}
                style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: chatInput.trim() ? INDIGO : '#E2E8F0', alignItems: 'center', justifyContent: 'center' }}>
                <Feather name="send" size={18} color={chatInput.trim() ? '#fff' : MUTED} />
              </TouchableOpacity>
            </View>
          )}
          {/* FAB — shifts up when chat input is present */}
          <View style={{ position: 'absolute', top: activeTab === 'assistant' && assistantSubTab === 'ai' ? -86 : -30, left: 0, right: 0, alignItems: 'center', zIndex: 20 }}>
            <TouchableOpacity onPress={openAdd} activeOpacity={0.85}
              style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: INDIGO, alignItems: 'center', justifyContent: 'center', shadowColor: INDIGO, shadowOpacity: 0.5, shadowRadius: 12, elevation: 14 }}>
              <Feather name="maximize" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
          <View style={{ backgroundColor: '#fff', flexDirection: 'row', paddingTop: 10, paddingBottom: Math.max(insets.bottom, 10), paddingHorizontal: 4, borderTopWidth: 0.5, borderTopColor: '#E5E7EB', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, elevation: 12 }}>
            <TabItem icon="grid"        label="Home"      active={activeTab === 'home'}      onPress={() => setActiveTab('home')} />
            <TabItem icon="file-text"   label="Receipts"  active={activeTab === 'receipts'}  onPress={() => setActiveTab('receipts')} />
            <View style={{ flex: 1 }} />
            <TabItem icon="bar-chart-2" label="Analytics" active={activeTab === 'analytics'} onPress={() => setActiveTab('analytics')} />
            <TabItem icon="cpu"         label="Assistant" active={activeTab === 'assistant'} onPress={() => setActiveTab('assistant')} />
          </View>
        </View>

      </SafeAreaView>

      {/* ── Add Expense Modal ─────────────────────────────────────────────── */}
      <Modal visible={showAdd} transparent animationType="slide">
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, paddingBottom: 40 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: INDIGO_D }}>Record Expense</Text>
              <TouchableOpacity onPress={() => setShowAdd(false)}>
                <Feather name="x" size={22} color={MUTED} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              onPress={handleScanReceipt}
              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: LAVENDER, borderRadius: 12, padding: 13, marginBottom: 18 }}
            >
              <Feather name="camera" size={18} color={INDIGO} />
              <Text style={{ fontSize: 13, fontWeight: '600', color: INDIGO, marginLeft: 10 }}>Scan a receipt instead</Text>
            </TouchableOpacity>

            <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748B', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 8 }}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {categories.map((cat) => (
                  <TouchableOpacity
                    key={cat.id}
                    onPress={() => setSelectedCatId(cat.id)}
                    style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: selectedCatId === cat.id ? INDIGO : '#F1F5F9' }}
                  >
                    <Text style={{ fontSize: 13, fontWeight: '600', color: selectedCatId === cat.id ? '#fff' : '#475569' }}>{cat.name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </ScrollView>

            <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748B', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>Description *</Text>
            <TextInput
              style={{ borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12, padding: 12, fontSize: 15, marginBottom: 14, color: INDIGO_D }}
              value={description} onChangeText={setDescription}
              placeholder="e.g. Cleaning supplies" placeholderTextColor={MUTED}
            />

            <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748B', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>Amount (KES) *</Text>
            <TextInput
              style={{ borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12, padding: 12, fontSize: 15, marginBottom: 14, color: INDIGO_D }}
              value={amount} onChangeText={setAmount}
              placeholder="0.00" placeholderTextColor={MUTED} keyboardType="numeric"
            />

            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748B', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>Vendor</Text>
                <TextInput
                  style={{ borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12, padding: 12, fontSize: 14, color: INDIGO_D }}
                  value={vendorName} onChangeText={setVendorName} placeholder="Optional" placeholderTextColor={MUTED}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: '#64748B', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>Paid By</Text>
                <TextInput
                  style={{ borderWidth: 1.5, borderColor: '#E2E8F0', borderRadius: 12, padding: 12, fontSize: 14, color: INDIGO_D }}
                  value={paidBy} onChangeText={setPaidBy}
                  placeholder={currentStaff?.name || 'Staff'} placeholderTextColor={MUTED}
                />
              </View>
            </View>

            <TouchableOpacity
              onPress={handleAddExpense}
              style={{ backgroundColor: INDIGO, borderRadius: 14, paddingVertical: 16, alignItems: 'center' }}
            >
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800' }}>Save Expense</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}
