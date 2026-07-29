import { useState, useCallback } from 'react';
import { View, Text, ScrollView, SafeAreaView, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { formatKES } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';
import {
  getSalesReport,
  getExpenseReport,
  getShiftReports,
  getDebtorsReport,
  getLowStockItems,
  type SalesReport,
  type ExpenseReport,
  type ShiftReport,
  type DebtorEntry,
  type LowStockItem,
  type Period,
} from '@/lib/reports/aggregate';
import {
  exportSalesCSV,
  exportExpenseCSV,
  exportShiftCSV,
  exportDebtorsCSV,
  exportLowStockCSV,
  exportSalesPDF,
  exportExpensePDF,
} from '@/lib/reports/export';
import { triggerLowStockAlerts } from '@/lib/reports/lowStockAlert';

type ReportTab = 'sales' | 'expenses' | 'shifts' | 'debtors' | 'lowstock';

export default function ReportsScreen() {
  const [activeTab, setActiveTab] = useState<ReportTab>('sales');
  const [period, setPeriod] = useState<Period>('today');
  const [loading, setLoading] = useState(false);

  // Report data
  const [salesReport, setSalesReport] = useState<SalesReport | null>(null);
  const [expenseReport, setExpenseReport] = useState<ExpenseReport | null>(null);
  const [shiftReports, setShiftReports] = useState<ShiftReport[]>([]);
  const [debtorEntries, setDebtorEntries] = useState<DebtorEntry[]>([]);
  const [lowStockItems, setLowStockItems] = useState<LowStockItem[]>([]);

  const currentStaff = useAuthStore((s) => s.currentStaff);
  const can = useAuthStore((s) => s.can);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      switch (activeTab) {
        case 'sales':
          setSalesReport(await getSalesReport(period));
          break;
        case 'expenses':
          setExpenseReport(await getExpenseReport(period));
          break;
        case 'shifts': {
          const staffId = can('viewAllReports') ? undefined : currentStaff?.id;
          setShiftReports(await getShiftReports(period, staffId));
          break;
        }
        case 'debtors':
          setDebtorEntries(await getDebtorsReport());
          break;
        case 'lowstock':
          setLowStockItems(await getLowStockItems());
          break;
      }
    } catch (e) {
      console.warn('Report error:', e);
    }
    setLoading(false);
  }, [activeTab, period]);

  useFocusEffect(
    useCallback(() => {
      loadReport();
    }, [loadReport])
  );

  const handleExport = async (format: 'csv' | 'pdf') => {
    try {
      switch (activeTab) {
        case 'sales':
          if (!salesReport) return;
          format === 'csv' ? await exportSalesCSV(salesReport) : await exportSalesPDF(salesReport);
          break;
        case 'expenses':
          if (!expenseReport) return;
          format === 'csv' ? await exportExpenseCSV(expenseReport) : await exportExpensePDF(expenseReport);
          break;
        case 'shifts':
          if (shiftReports.length === 0) return;
          await exportShiftCSV(shiftReports);
          break;
        case 'debtors':
          if (debtorEntries.length === 0) return;
          await exportDebtorsCSV(debtorEntries);
          break;
        case 'lowstock':
          if (lowStockItems.length === 0) return;
          await exportLowStockCSV(lowStockItems);
          break;
      }
    } catch (e) {
      Alert.alert('Export Error', 'Could not export report');
    }
  };

  const handleSendAlerts = async () => {
    const result = await triggerLowStockAlerts();
    Alert.alert('Low Stock Alerts', result.sent > 0 ? `${result.sent} alert(s) sent` : 'No new alerts to send');
  };

  const tabs: { key: ReportTab; label: string }[] = [
    { key: 'sales', label: 'Sales' },
    { key: 'expenses', label: 'Expenses' },
    { key: 'shifts', label: 'Shifts' },
    { key: 'debtors', label: 'Debtors' },
    { key: 'lowstock', label: 'Low Stock' },
  ];

  const periods: { key: Period; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'Week' },
    { key: 'month', label: 'Month' },
  ];

  return (
    <SafeAreaView className="flex-1 bg-surface">
      {/* Header */}
      <View className="px-4 pt-2 pb-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-xl font-bold text-primary">Reports</Text>
          <View className="flex-row">
            <TouchableOpacity className="bg-green-600 px-3 py-1.5 rounded-lg mr-2" onPress={() => handleExport('csv')}>
              <Text className="text-white text-xs font-medium">CSV</Text>
            </TouchableOpacity>
            {(activeTab === 'sales' || activeTab === 'expenses') && (
              <TouchableOpacity className="bg-blue-600 px-3 py-1.5 rounded-lg mr-2" onPress={() => handleExport('pdf')}>
                <Text className="text-white text-xs font-medium">PDF</Text>
              </TouchableOpacity>
            )}
            {activeTab === 'lowstock' && (
              <TouchableOpacity className="bg-red-600 px-3 py-1.5 rounded-lg" onPress={handleSendAlerts}>
                <Text className="text-white text-xs font-medium">Send Alerts</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {/* Report Type Tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} className="bg-white border-b border-gray-200">
        <View className="flex-row p-2">
          {tabs.map((t) => (
            <TouchableOpacity
              key={t.key}
              className={`px-4 py-2 rounded-lg mr-2 ${activeTab === t.key ? 'bg-primary' : 'bg-gray-100'}`}
              onPress={() => setActiveTab(t.key)}
            >
              <Text className={`text-sm font-medium ${activeTab === t.key ? 'text-white' : 'text-gray-700'}`}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      {/* Period Selector (not for debtors/lowstock) */}
      {activeTab !== 'debtors' && activeTab !== 'lowstock' && (
        <View className="flex-row px-4 py-2 bg-white">
          {periods.map((p) => (
            <TouchableOpacity
              key={p.key}
              className={`px-4 py-1.5 rounded-full mr-2 ${period === p.key ? 'bg-accent' : 'bg-gray-100'}`}
              onPress={() => setPeriod(p.key)}
            >
              <Text className={`text-xs font-medium ${period === p.key ? 'text-white' : 'text-gray-600'}`}>
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Report Content */}
      <ScrollView className="flex-1 p-4">
        {loading ? (
          <ActivityIndicator size="large" className="mt-8" />
        ) : (
          <>
            {activeTab === 'sales' && salesReport && <SalesReportView report={salesReport} />}
            {activeTab === 'expenses' && expenseReport && <ExpenseReportView report={expenseReport} />}
            {activeTab === 'shifts' && <ShiftReportView reports={shiftReports} />}
            {activeTab === 'debtors' && <DebtorsReportView entries={debtorEntries} />}
            {activeTab === 'lowstock' && <LowStockView items={lowStockItems} />}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Sub-views ──────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View className="bg-white rounded-xl p-4 flex-1 mr-2 border border-gray-100">
      <Text className={`text-lg font-bold ${color || 'text-primary'}`}>{value}</Text>
      <Text className="text-xs text-gray-500 mt-1">{label}</Text>
    </View>
  );
}

function SalesReportView({ report }: { report: SalesReport }) {
  return (
    <>
      <Text className="text-xs text-gray-400 mb-3">{report.period}</Text>
      <View className="flex-row mb-4">
        <StatCard label="Revenue" value={formatKES(report.totalRevenue)} color="text-green-600" />
        <StatCard label="Orders" value={String(report.totalOrders)} />
        <StatCard label="Avg Order" value={formatKES(report.avgOrderValue)} />
      </View>

      <Text className="text-sm font-bold text-primary mb-2">Payment Methods</Text>
      {Object.entries(report.paymentBreakdown).map(([method, amount]) => (
        <View key={method} className="flex-row justify-between bg-white rounded-lg p-3 mb-1 border border-gray-100">
          <Text className="text-sm text-gray-700 capitalize">{method}</Text>
          <Text className="text-sm font-medium text-primary">{formatKES(amount)}</Text>
        </View>
      ))}

      <Text className="text-sm font-bold text-primary mt-4 mb-2">By Category</Text>
      {report.categoryBreakdown.map((cat) => (
        <View key={cat.name} className="flex-row justify-between bg-white rounded-lg p-3 mb-1 border border-gray-100">
          <View>
            <Text className="text-sm text-gray-700">{cat.name}</Text>
            <Text className="text-xs text-gray-400">{cat.qty} items</Text>
          </View>
          <Text className="text-sm font-medium text-primary">{formatKES(cat.revenue)}</Text>
        </View>
      ))}

      <Text className="text-sm font-bold text-primary mt-4 mb-2">Daily Breakdown</Text>
      {report.dailyTotals.map((d) => (
        <View key={d.date} className="flex-row justify-between bg-white rounded-lg p-3 mb-1 border border-gray-100">
          <Text className="text-sm text-gray-700">{d.date}</Text>
          <View className="flex-row">
            <Text className="text-xs text-gray-400 mr-3">{d.orders} orders</Text>
            <Text className="text-sm font-medium text-primary">{formatKES(d.revenue)}</Text>
          </View>
        </View>
      ))}
    </>
  );
}

function ExpenseReportView({ report }: { report: ExpenseReport }) {
  return (
    <>
      <Text className="text-xs text-gray-400 mb-3">{report.period}</Text>
      <View className="flex-row mb-4">
        <StatCard label="Total Expenses" value={formatKES(report.totalExpenses)} color="text-red-600" />
      </View>

      <Text className="text-sm font-bold text-primary mb-2">By Category</Text>
      {report.categoryBreakdown.map((cat) => (
        <View key={cat.name} className="flex-row justify-between bg-white rounded-lg p-3 mb-1 border border-gray-100">
          <View>
            <Text className="text-sm text-gray-700">{cat.name}</Text>
            <Text className="text-xs text-gray-400">{cat.count} entries</Text>
          </View>
          <Text className="text-sm font-medium text-red-600">{formatKES(cat.total)}</Text>
        </View>
      ))}

      <Text className="text-sm font-bold text-primary mt-4 mb-2">All Expenses</Text>
      {report.items.map((item, i) => (
        <View key={i} className="bg-white rounded-lg p-3 mb-1 border border-gray-100">
          <View className="flex-row justify-between">
            <Text className="text-sm text-gray-700 flex-1">{item.description}</Text>
            <Text className="text-sm font-medium text-red-600">{formatKES(item.amount)}</Text>
          </View>
          <Text className="text-xs text-gray-400">{item.date} · {item.category}{item.vendor ? ` · ${item.vendor}` : ''}</Text>
        </View>
      ))}
    </>
  );
}

function ShiftReportView({ reports }: { reports: ShiftReport[] }) {
  if (reports.length === 0) {
    return <Text className="text-gray-400 text-center mt-8">No shifts in this period.</Text>;
  }

  return (
    <>
      {reports.map((r) => (
        <View key={r.shiftId} className="bg-white rounded-xl p-4 mb-3 border border-gray-100">
          <View className="flex-row justify-between mb-2">
            <Text className="text-base font-bold text-primary">{r.staffName}</Text>
            <Text className={`text-sm font-medium ${r.closedAt ? 'text-gray-500' : 'text-green-600'}`}>
              {r.closedAt ? 'Closed' : 'Active'}
            </Text>
          </View>
          <Text className="text-xs text-gray-400 mb-2">{r.openedAt} → {r.closedAt || 'now'}</Text>

          <View className="flex-row mb-2">
            <View className="flex-1">
              <Text className="text-xs text-gray-500">Orders</Text>
              <Text className="text-sm font-medium text-primary">{r.totalOrders}</Text>
            </View>
            <View className="flex-1">
              <Text className="text-xs text-gray-500">Revenue</Text>
              <Text className="text-sm font-medium text-green-600">{formatKES(r.totalRevenue)}</Text>
            </View>
          </View>

          {r.closedAt && (
            <View className="flex-row">
              <View className="flex-1">
                <Text className="text-xs text-gray-500">Opening</Text>
                <Text className="text-sm text-primary">{formatKES(r.openingCash)}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-xs text-gray-500">Expected</Text>
                <Text className="text-sm text-primary">{formatKES(r.closingCashExpected)}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-xs text-gray-500">Actual</Text>
                <Text className="text-sm text-primary">{formatKES(r.closingCashActual)}</Text>
              </View>
              <View className="flex-1">
                <Text className="text-xs text-gray-500">Variance</Text>
                <Text className={`text-sm font-medium ${r.variance >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {r.variance >= 0 ? '+' : ''}{formatKES(r.variance)}
                </Text>
              </View>
            </View>
          )}

          {Object.keys(r.paymentBreakdown).length > 0 && (
            <View className="flex-row mt-2 pt-2 border-t border-gray-100">
              {Object.entries(r.paymentBreakdown).map(([method, amount]) => (
                <View key={method} className="flex-1">
                  <Text className="text-xs text-gray-400 capitalize">{method}</Text>
                  <Text className="text-xs text-primary">{formatKES(amount)}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      ))}
    </>
  );
}

function DebtorsReportView({ entries }: { entries: DebtorEntry[] }) {
  const totalOutstanding = entries.reduce((s, e) => s + Math.max(0, e.balance), 0);

  if (entries.length === 0) {
    return <Text className="text-gray-400 text-center mt-8">No credit customers.</Text>;
  }

  return (
    <>
      <View className="flex-row mb-4">
        <StatCard label="Total Outstanding" value={formatKES(totalOutstanding)} color="text-red-600" />
        <StatCard label="Customers" value={String(entries.length)} />
      </View>

      {entries.map((e) => (
        <View key={e.customerId} className="bg-white rounded-xl p-4 mb-2 border border-gray-100">
          <View className="flex-row justify-between mb-1">
            <Text className="text-base font-medium text-primary">{e.name}</Text>
            <Text className={`text-base font-bold ${e.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
              {e.balance > 0 ? formatKES(e.balance) : 'Settled'}
            </Text>
          </View>
          {e.phone ? <Text className="text-xs text-gray-500">{e.phone}</Text> : null}
          <View className="flex-row mt-1">
            <Text className="text-xs text-gray-400 mr-3">Charged: {formatKES(e.totalCharged)}</Text>
            <Text className="text-xs text-gray-400 mr-3">Repaid: {formatKES(e.totalRepaid)}</Text>
            {e.creditLimit > 0 && <Text className="text-xs text-gray-400">Limit: {formatKES(e.creditLimit)}</Text>}
          </View>
          {e.lastActivity && (
            <Text className="text-xs text-gray-400 mt-1">Last activity: {e.lastActivity.toLocaleDateString()}</Text>
          )}
        </View>
      ))}
    </>
  );
}

function LowStockView({ items }: { items: LowStockItem[] }) {
  if (items.length === 0) {
    return <Text className="text-green-600 text-center mt-8 font-medium">All products are well stocked!</Text>;
  }

  return (
    <>
      <View className="flex-row mb-4">
        <StatCard label="Low/Out of Stock" value={String(items.length)} color="text-red-600" />
      </View>

      {items.map((item) => (
        <View
          key={item.productId}
          className={`rounded-xl p-4 mb-2 border ${item.stockQty <= 0 ? 'border-red-500 bg-red-50' : 'border-yellow-500 bg-yellow-50'}`}
        >
          <View className="flex-row justify-between">
            <View>
              <Text className="text-base font-medium text-primary">{item.name}</Text>
              <Text className="text-xs text-gray-500">{item.category} · {item.unit}</Text>
            </View>
            <View className="items-end">
              <Text className={`text-lg font-bold ${item.stockQty <= 0 ? 'text-red-600' : 'text-yellow-600'}`}>
                {item.stockQty}
              </Text>
              <Text className="text-xs text-gray-400">threshold: {item.threshold}</Text>
            </View>
          </View>
        </View>
      ))}
    </>
  );
}
