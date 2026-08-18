import { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Modal,
  Alert, ActivityIndicator, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { router } from 'expo-router';
import { formatKES } from '@/utils/currency';
import { useAuthStore } from '@/stores/authStore';
import {
  getSalesReport, getExpenseReport, getShiftReports,
  getDebtorsReport, getLowStockItems, getProfitLossReport,
  getProductPerformanceReport, getCategoryAnalysisReport,
  getPaymentAnalysisReport, getStaffPerformanceReport,
  getDiscountsVoidsReport, getStockMovementReport, getHourlySalesReport,
  type SalesReport, type ExpenseReport, type ShiftReport, type DebtorEntry,
  type LowStockItem, type ProfitLossReport, type ProductPerformanceReport,
  type CategoryAnalysisReport, type PaymentAnalysisReport,
  type StaffPerformanceReport, type DiscountsVoidsReport,
  type StockMovementReport, type HourlySalesReport, type Period,
} from '@/lib/reports/aggregate';
import {
  exportSalesCSV, exportSalesPDF,
  exportExpenseCSV, exportExpensePDF,
  exportShiftCSV, exportDebtorsCSV, exportLowStockCSV,
  exportProfitLossCSV, exportProfitLossPDF,
  exportProductPerformanceCSV, exportCategoryAnalysisCSV,
  exportPaymentAnalysisCSV, exportStaffPerformanceCSV,
  exportDiscountsVoidsCSV, exportStockMovementCSV, exportHourlySalesCSV,
} from '@/lib/reports/export';
import { triggerLowStockAlerts } from '@/lib/reports/lowStockAlert';

// ─── Report types ────────────────────────────────────────────────────────────

type ReportType =
  | 'sales' | 'pnl' | 'products' | 'categories'
  | 'payments' | 'staff' | 'shifts' | 'expenses'
  | 'discounts' | 'stock' | 'lowstock' | 'debtors' | 'hourly';

interface ReportMeta {
  key: ReportType;
  icon: string;
  label: string;
  desc: string;
  hasPeriod: boolean;
  adminOnly?: boolean;
  hasPDF?: boolean;
}

const REPORTS: ReportMeta[] = [
  { key: 'sales',      icon: '📊', label: 'Sales Summary',          desc: 'Revenue, orders, avg order, daily breakdown', hasPeriod: true, hasPDF: true },
  { key: 'pnl',        icon: '📉', label: 'Profit & Loss',           desc: 'Revenue → COGS → Gross Profit → Net Profit', hasPeriod: true, hasPDF: true },
  { key: 'products',   icon: '🏆', label: 'Product Performance',     desc: 'Revenue, cost & margin per product', hasPeriod: true },
  { key: 'categories', icon: '🗂️', label: 'Category Analysis',       desc: 'Bar vs Kitchen revenue & margin breakdown', hasPeriod: true },
  { key: 'payments',   icon: '💳', label: 'Payment Methods',          desc: 'Cash / M-Pesa / card split, refunds & peak hours', hasPeriod: true },
  { key: 'staff',      icon: '👤', label: 'Staff Performance',        desc: 'Orders & revenue per team member', hasPeriod: true, adminOnly: true },
  { key: 'shifts',     icon: '🔄', label: 'Shift Reconciliation',     desc: 'Cash opening vs closing & variance per shift', hasPeriod: true },
  { key: 'expenses',   icon: '🧾', label: 'Expense Report',           desc: 'All costs with vendors, categories & dates', hasPeriod: true, hasPDF: true },
  { key: 'discounts',  icon: '🎁', label: 'Discounts, Voids & Comps', desc: 'Revenue lost to discounts, voids & freebies', hasPeriod: true },
  { key: 'stock',      icon: '📦', label: 'Stock Movement',           desc: 'Restocks, wastage, breakage & corrections log', hasPeriod: true },
  { key: 'lowstock',   icon: '⚠️', label: 'Low Stock Alerts',         desc: 'Items running low or out of stock right now', hasPeriod: false },
  { key: 'debtors',    icon: '💰', label: 'Debtors & Credit',         desc: 'Outstanding customer balances & history', hasPeriod: false },
  { key: 'hourly',     icon: '⏰', label: 'Hourly Sales',             desc: 'When is business busiest by hour of day', hasPeriod: true },
];

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'week',  label: 'Week' },
  { key: 'month', label: 'Month' },
];

// ─── Shared UI helpers ───────────────────────────────────────────────────────

function SCard({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <Text style={{ fontSize: 15, fontWeight: '700', color: '#1e1b4b' }}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

function KpiTile({ label, value, bg, color, sub }: { label: string; value: string; bg: string; color: string; sub?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: bg, borderRadius: 12, padding: 14, margin: 4 }}>
      <Text style={{ fontSize: 9, fontWeight: '700', color, letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 }}>{label}</Text>
      <Text style={{ fontSize: 20, fontWeight: '800', color }} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      {sub ? <Text style={{ fontSize: 10, color, opacity: 0.7, marginTop: 2 }}>{sub}</Text> : null}
    </View>
  );
}

function DataRow({ left, sub, right, rightColor }: { left: string; sub?: string; right: string; rightColor?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Text style={{ fontSize: 13, color: '#1e1b4b' }} numberOfLines={1}>{left}</Text>
        {sub ? <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{sub}</Text> : null}
      </View>
      <Text style={{ fontSize: 13, fontWeight: '700', color: rightColor || '#1e1b4b' }}>{right}</Text>
    </View>
  );
}

function PctBar({ pct, color }: { pct: number; color: string }) {
  return (
    <View style={{ height: 4, backgroundColor: '#f1f5f9', borderRadius: 2, marginTop: 4 }}>
      <View style={{ height: 4, width: `${Math.min(pct, 100)}%`, backgroundColor: color, borderRadius: 2 }} />
    </View>
  );
}

function EmptyState({ msg }: { msg: string }) {
  return <Text style={{ textAlign: 'center', color: '#94a3b8', marginTop: 32, fontSize: 13 }}>{msg}</Text>;
}

// ─── Report view components ──────────────────────────────────────────────────

function SalesView({ r }: { r: SalesReport }) {
  return (
    <>
      <SCard title="Revenue Overview" right={<Text style={{ fontSize: 11, color: '#94a3b8' }}>{r.period}</Text>}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -4 }}>
          <KpiTile label="Revenue" value={formatKES(r.totalRevenue)} bg="#f0fdf4" color="#16a34a" />
          <KpiTile label="Orders" value={String(r.totalOrders)} bg="#eff6ff" color="#2563eb" />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -4 }}>
          <KpiTile label="Avg Order" value={formatKES(r.avgOrderValue)} bg="#faf5ff" color="#7c3aed" />
          <KpiTile label="Credit Orders" value={String(r.creditOrders)} bg="#fff7ed" color="#ea580c" />
        </View>
      </SCard>

      <SCard title="Adjustments">
        <DataRow left="Discounts Given" right={`- ${formatKES(r.totalDiscounts)}`} rightColor="#dc2626" />
        <DataRow left="Refunds Issued" right={`- ${formatKES(r.totalRefunds)}`} rightColor="#dc2626" />
        <DataRow left="Complimentary Items" right={`- ${formatKES(r.totalComplimentary)}`} rightColor="#f59e0b" />
      </SCard>

      <SCard title="Payment Methods">
        {Object.entries(r.paymentBreakdown).length === 0
          ? <EmptyState msg="No payments recorded" />
          : Object.entries(r.paymentBreakdown).map(([m, a]) => (
            <DataRow key={m} left={m.charAt(0).toUpperCase() + m.slice(1)} right={formatKES(a)} rightColor="#2563eb" />
          ))}
      </SCard>

      <SCard title="Top Products">
        {r.topProducts.length === 0 ? <EmptyState msg="No product data" /> : r.topProducts.map((p, i) => (
          <View key={p.name} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
            <Text style={{ width: 22, fontSize: 12, color: '#94a3b8', fontWeight: '700' }}>#{i + 1}</Text>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, color: '#1e1b4b' }} numberOfLines={1}>{p.name}</Text>
              <Text style={{ fontSize: 11, color: '#94a3b8' }}>{p.qty} units · {p.margin}% margin</Text>
            </View>
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#16a34a' }}>{formatKES(p.revenue)}</Text>
          </View>
        ))}
      </SCard>

      <SCard title="By Category">
        {r.categoryBreakdown.map((c) => (
          <DataRow key={c.name} left={c.name} sub={`${c.qty} items`} right={formatKES(c.revenue)} rightColor="#1e1b4b" />
        ))}
      </SCard>

      <SCard title="Daily Breakdown">
        {r.dailyTotals.length === 0 ? <EmptyState msg="No daily data" /> : r.dailyTotals.map((d) => (
          <DataRow key={d.date} left={d.date} sub={`${d.orders} orders`} right={formatKES(d.revenue)} />
        ))}
      </SCard>
    </>
  );
}

function PnLView({ r }: { r: ProfitLossReport }) {
  const isProfit = r.netProfit >= 0;
  return (
    <>
      <SCard title="P&L Summary" right={<Text style={{ fontSize: 11, color: '#94a3b8' }}>{r.period}</Text>}>
        <View style={{ flexDirection: 'row', margin: -4 }}>
          <KpiTile label="Gross Revenue" value={formatKES(r.grossRevenue)} bg="#f0fdf4" color="#16a34a" />
          <KpiTile label="Gross Profit" value={formatKES(r.grossProfit)} bg="#eff6ff" color="#2563eb" sub={`${r.grossMargin}% margin`} />
        </View>
        <View style={{ flexDirection: 'row', margin: -4 }}>
          <KpiTile label="Total Expenses" value={formatKES(r.totalExpenses)} bg="#fef2f2" color="#dc2626" />
          <KpiTile label={isProfit ? 'Net Profit' : 'Net Loss'} value={formatKES(Math.abs(r.netProfit))} bg={isProfit ? '#f0fdf4' : '#fef2f2'} color={isProfit ? '#16a34a' : '#dc2626'} sub={`${r.netMargin}% margin`} />
        </View>
      </SCard>

      <SCard title="Income Statement">
        <DataRow left="Gross Revenue" right={formatKES(r.grossRevenue)} rightColor="#16a34a" />
        <DataRow left="  Less: Discounts" right={`(${formatKES(r.totalDiscounts)})`} rightColor="#dc2626" />
        <DataRow left="  Less: Refunds" right={`(${formatKES(r.totalRefunds)})`} rightColor="#dc2626" />
        <DataRow left="  Less: Complimentary" right={`(${formatKES(r.totalComplimentary)})`} rightColor="#f59e0b" />
        <DataRow left="Net Revenue" right={formatKES(r.netRevenue)} rightColor="#1e1b4b" />
        <View style={{ height: 1, backgroundColor: '#e2e8f0', marginVertical: 6 }} />
        <DataRow left="Cost of Goods Sold (COGS)" right={`(${formatKES(r.cogs)})`} rightColor="#dc2626" />
        <DataRow left={`Gross Profit (${r.grossMargin}% margin)`} right={formatKES(r.grossProfit)} rightColor={r.grossProfit >= 0 ? '#16a34a' : '#dc2626'} />
        <View style={{ height: 1, backgroundColor: '#e2e8f0', marginVertical: 6 }} />
        <DataRow left="Total Operating Expenses" right={`(${formatKES(r.totalExpenses)})`} rightColor="#dc2626" />
        <View style={{ height: 2, backgroundColor: '#1e1b4b', marginVertical: 6 }} />
        <DataRow left={`Net ${isProfit ? 'Profit' : 'Loss'} (${r.netMargin}% margin)`} right={formatKES(Math.abs(r.netProfit))} rightColor={isProfit ? '#16a34a' : '#dc2626'} />
      </SCard>

      <SCard title="Expense Breakdown">
        {r.expenseLines.length === 0 ? <EmptyState msg="No expenses recorded" /> : r.expenseLines.map((e) => (
          <DataRow key={e.category} left={e.category} sub={`${e.count} entries`} right={formatKES(e.amount)} rightColor="#dc2626" />
        ))}
      </SCard>
    </>
  );
}

function ProductView({ r }: { r: ProductPerformanceReport }) {
  return (
    <>
      <SCard title="Overall" right={<Text style={{ fontSize: 11, color: '#94a3b8' }}>{r.period}</Text>}>
        <View style={{ flexDirection: 'row', margin: -4 }}>
          <KpiTile label="Revenue" value={formatKES(r.totalRevenue)} bg="#f0fdf4" color="#16a34a" />
          <KpiTile label="COGS" value={formatKES(r.totalCogs)} bg="#fef2f2" color="#dc2626" />
          <KpiTile label="Gross Profit" value={formatKES(r.totalGrossProfit)} bg="#eff6ff" color="#2563eb" />
        </View>
      </SCard>

      <SCard title={`All Products (${r.products.length})`}>
        {r.products.length === 0 ? <EmptyState msg="No sales data" /> : r.products.map((p, i) => (
          <View key={p.name} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <Text style={{ width: 22, fontSize: 11, color: '#94a3b8', fontWeight: '700' }}>#{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#1e1b4b' }} numberOfLines={1}>{p.name}</Text>
                <Text style={{ fontSize: 10, color: '#94a3b8' }}>{p.category} · {p.station} · {p.qtySold} units</Text>
              </View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#16a34a' }}>{formatKES(p.revenue)}</Text>
            </View>
            <View style={{ flexDirection: 'row', paddingLeft: 22 }}>
              <Text style={{ fontSize: 10, color: '#64748b', flex: 1 }}>COGS: {formatKES(p.cogs)}</Text>
              <Text style={{ fontSize: 10, color: '#64748b', flex: 1 }}>Profit: {formatKES(p.grossProfit)}</Text>
              <Text style={{ fontSize: 10, color: '#64748b', flex: 1 }}>Margin: {p.margin}%</Text>
              <Text style={{ fontSize: 10, color: '#64748b' }}>Share: {p.pctOfRevenue}%</Text>
            </View>
            <PctBar pct={p.pctOfRevenue} color={p.margin >= 50 ? '#16a34a' : p.margin >= 20 ? '#f59e0b' : '#dc2626'} />
          </View>
        ))}
      </SCard>
    </>
  );
}

function CategoryView({ r }: { r: CategoryAnalysisReport }) {
  return (
    <>
      <SCard title="Category Overview" right={<Text style={{ fontSize: 11, color: '#94a3b8' }}>{r.period}</Text>}>
        <View style={{ flexDirection: 'row', margin: -4 }}>
          <KpiTile label="Total Revenue" value={formatKES(r.totalRevenue)} bg="#f0fdf4" color="#16a34a" />
          <KpiTile label="Total COGS" value={formatKES(r.totalCogs)} bg="#fef2f2" color="#dc2626" />
        </View>
      </SCard>

      <SCard title="Category Breakdown">
        {r.categories.length === 0 ? <EmptyState msg="No data" /> : r.categories.map((c) => (
          <View key={c.name} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#1e1b4b' }}>{c.name}</Text>
                <Text style={{ fontSize: 10, color: '#94a3b8' }}>
                  {c.station.toUpperCase()} · {c.qty} items · {c.margin}% margin · {c.pctOfTotal}% of revenue
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#16a34a' }}>{formatKES(c.revenue)}</Text>
                <Text style={{ fontSize: 10, color: '#dc2626' }}>COGS {formatKES(c.cogs)}</Text>
              </View>
            </View>
            <PctBar pct={c.pctOfTotal} color="#2563eb" />
          </View>
        ))}
      </SCard>
    </>
  );
}

function PaymentsView({ r }: { r: PaymentAnalysisReport }) {
  return (
    <>
      <SCard title="Payment Summary" right={<Text style={{ fontSize: 11, color: '#94a3b8' }}>{r.period}</Text>}>
        <View style={{ flexDirection: 'row', margin: -4 }}>
          <KpiTile label="Collected" value={formatKES(r.totalCollected)} bg="#f0fdf4" color="#16a34a" />
          <KpiTile label="Refunded" value={formatKES(r.totalRefunded)} bg="#fef2f2" color="#dc2626" />
          <KpiTile label="Net Received" value={formatKES(r.netReceived)} bg="#eff6ff" color="#2563eb" />
        </View>
      </SCard>

      <SCard title="By Payment Method">
        {r.methods.length === 0 ? <EmptyState msg="No payment data" /> : r.methods.map((m) => (
          <View key={m.method} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#1e1b4b', textTransform: 'capitalize' }}>{m.method}</Text>
                <Text style={{ fontSize: 10, color: '#94a3b8' }}>{m.count} transactions · {m.pct}% of total</Text>
                {m.refunded > 0 && <Text style={{ fontSize: 10, color: '#dc2626' }}>Refunded: {formatKES(m.refunded)}</Text>}
              </View>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#16a34a' }}>{formatKES(m.amount)}</Text>
            </View>
            <PctBar pct={m.pct} color="#2563eb" />
          </View>
        ))}
      </SCard>

      <SCard title={`Peak Hour: ${r.peakLabel}`}>
        {r.hourlyTotals.length === 0 ? <EmptyState msg="No hourly data" /> : r.hourlyTotals.map((h) => (
          <View key={h.label} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 12, color: '#475569', width: 60 }}>{h.label}</Text>
              <View style={{ flex: 1, paddingHorizontal: 8 }}>
                <PctBar pct={r.hourlyTotals.length > 0 ? (h.revenue / Math.max(...r.hourlyTotals.map((x) => x.revenue))) * 100 : 0} color="#7c3aed" />
              </View>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#1e1b4b', width: 90, textAlign: 'right' }}>{formatKES(h.revenue)}</Text>
            </View>
          </View>
        ))}
      </SCard>
    </>
  );
}

function StaffView({ r }: { r: StaffPerformanceReport }) {
  return (
    <>
      <SCard title="Staff Performance" right={<Text style={{ fontSize: 11, color: '#94a3b8' }}>{r.period}</Text>}>
        <View style={{ flexDirection: 'row', margin: -4 }}>
          <KpiTile label="Team Members" value={String(r.staff.length)} bg="#eff6ff" color="#2563eb" />
          <KpiTile label="Total Revenue" value={formatKES(r.staff.reduce((s, x) => s + x.revenue, 0))} bg="#f0fdf4" color="#16a34a" />
        </View>
      </SCard>

      {r.staff.length === 0 ? <EmptyState msg="No staff data for this period" /> : r.staff.map((s, i) => (
        <SCard key={s.staffId} title={`#${i + 1} ${s.name}`} right={<Text style={{ fontSize: 11, color: '#64748b', textTransform: 'capitalize' }}>{s.role}</Text>}>
          <View style={{ flexDirection: 'row', margin: -4 }}>
            <KpiTile label="Orders" value={String(s.orders)} bg="#eff6ff" color="#2563eb" />
            <KpiTile label="Revenue" value={formatKES(s.revenue)} bg="#f0fdf4" color="#16a34a" />
            <KpiTile label="Avg Order" value={formatKES(s.avgOrder)} bg="#faf5ff" color="#7c3aed" />
          </View>
          <View style={{ marginTop: 10 }}>
            <DataRow left="Shifts Worked" right={String(s.shifts)} />
            <DataRow left="Discounts Given" right={formatKES(s.discountsGiven)} rightColor="#f59e0b" />
            <DataRow left="Comps Authorized" right={formatKES(s.compsGiven)} rightColor="#ea580c" />
          </View>
        </SCard>
      ))}
    </>
  );
}

function ShiftsView({ reports }: { reports: ShiftReport[] }) {
  if (reports.length === 0) return <EmptyState msg="No shifts in this period." />;
  return (
    <>
      {reports.map((r) => (
        <SCard key={r.shiftId} title={r.staffName} right={
          <Text style={{ fontSize: 11, fontWeight: '600', color: r.closedAt ? '#64748b' : '#16a34a' }}>
            {r.closedAt ? 'Closed' : 'Active'}
          </Text>
        }>
          <Text style={{ fontSize: 11, color: '#94a3b8', marginBottom: 10 }}>{r.openedAt} → {r.closedAt || 'ongoing'}</Text>
          <View style={{ flexDirection: 'row', margin: -4, marginBottom: 8 }}>
            <KpiTile label="Orders" value={String(r.totalOrders)} bg="#eff6ff" color="#2563eb" />
            <KpiTile label="Revenue" value={formatKES(r.totalRevenue)} bg="#f0fdf4" color="#16a34a" />
          </View>
          {r.closedAt && (
            <>
              <DataRow left="Opening Cash" right={formatKES(r.openingCash)} />
              <DataRow left="Expected Closing" right={formatKES(r.closingCashExpected)} />
              <DataRow left="Actual Closing" right={formatKES(r.closingCashActual)} />
              <DataRow
                left="Cash Variance"
                right={`${r.variance >= 0 ? '+' : ''}${formatKES(r.variance)}`}
                rightColor={r.variance >= 0 ? '#16a34a' : '#dc2626'}
              />
            </>
          )}
          {Object.keys(r.paymentBreakdown).length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>Payment breakdown</Text>
              {Object.entries(r.paymentBreakdown).map(([m, a]) => (
                <DataRow key={m} left={m} right={formatKES(a)} />
              ))}
            </View>
          )}
        </SCard>
      ))}
    </>
  );
}

function ExpensesView({ r }: { r: ExpenseReport }) {
  return (
    <>
      <SCard title="Expense Overview" right={<Text style={{ fontSize: 11, color: '#94a3b8' }}>{r.period}</Text>}>
        <KpiTile label="Total Expenses" value={formatKES(r.totalExpenses)} bg="#fef2f2" color="#dc2626" />
      </SCard>

      <SCard title="By Category">
        {r.categoryBreakdown.length === 0 ? <EmptyState msg="No expenses" /> : r.categoryBreakdown.map((c) => (
          <DataRow key={c.name} left={c.name} sub={`${c.count} entries`} right={formatKES(c.total)} rightColor="#dc2626" />
        ))}
      </SCard>

      <SCard title="All Expense Entries">
        {r.items.length === 0 ? <EmptyState msg="No expenses" /> : r.items.map((item, i) => (
          <View key={i} style={{ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, fontSize: 13, color: '#1e1b4b', paddingRight: 8 }} numberOfLines={1}>{item.description}</Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#dc2626' }}>{formatKES(item.amount)}</Text>
            </View>
            <Text style={{ fontSize: 10, color: '#94a3b8' }}>{item.date} · {item.category}{item.vendor ? ` · ${item.vendor}` : ''}</Text>
          </View>
        ))}
      </SCard>
    </>
  );
}

function DiscountsView({ r }: { r: DiscountsVoidsReport }) {
  return (
    <>
      <SCard title="Revenue Impact" right={<Text style={{ fontSize: 11, color: '#94a3b8' }}>{r.period}</Text>}>
        <View style={{ flexDirection: 'row', margin: -4 }}>
          <KpiTile label="Discounts" value={formatKES(r.totalDiscountValue)} bg="#fef2f2" color="#dc2626" sub={`${r.discountedOrders} orders`} />
          <KpiTile label="Voids" value={formatKES(r.totalVoidValue)} bg="#fff7ed" color="#ea580c" sub={`${r.voidedItemCount} items`} />
          <KpiTile label="Comps" value={formatKES(r.totalCompValue)} bg="#fffbeb" color="#d97706" sub={`${r.compItemCount} items`} />
        </View>
      </SCard>

      <SCard title="Discount Reasons">
        {r.discountReasons.length === 0 ? <EmptyState msg="No discounts recorded" /> : r.discountReasons.map((d) => (
          <DataRow key={d.reason} left={d.reason} sub={`${d.count} orders`} right={formatKES(d.amount)} rightColor="#dc2626" />
        ))}
      </SCard>

      <SCard title="Void Reasons">
        {r.voidReasons.length === 0 ? <EmptyState msg="No voids recorded" /> : r.voidReasons.map((v) => (
          <DataRow key={v.reason} left={v.reason} sub={`${v.count} items`} right={formatKES(v.value)} rightColor="#ea580c" />
        ))}
      </SCard>

      <SCard title="Complimentary Reasons">
        {r.compReasons.length === 0 ? <EmptyState msg="No comps recorded" /> : r.compReasons.map((c) => (
          <DataRow key={c.reason} left={c.reason} sub={`${c.count} items`} right={formatKES(c.value)} rightColor="#d97706" />
        ))}
      </SCard>
    </>
  );
}

function StockView({ r }: { r: StockMovementReport }) {
  return (
    <>
      <SCard title="Movement Summary" right={<Text style={{ fontSize: 11, color: '#94a3b8' }}>{r.period}</Text>}>
        <View style={{ flexDirection: 'row', margin: -4 }}>
          <KpiTile label="Restocks" value={`+${r.restocks.totalUnits}`} bg="#f0fdf4" color="#16a34a" sub={`${r.restocks.count} entries`} />
          <KpiTile label="Wastage" value={`-${r.wastage.totalUnits}`} bg="#fef2f2" color="#dc2626" sub={`${r.wastage.count} entries`} />
        </View>
        <View style={{ flexDirection: 'row', margin: -4 }}>
          <KpiTile label="Breakage" value={`-${r.breakage.totalUnits}`} bg="#fff7ed" color="#ea580c" sub={`${r.breakage.count} entries`} />
          <KpiTile label="Corrections" value={r.corrections.netUnits >= 0 ? `+${r.corrections.netUnits}` : String(r.corrections.netUnits)} bg="#faf5ff" color="#7c3aed" sub={`${r.corrections.count} entries`} />
        </View>
      </SCard>

      <SCard title="Movement Log">
        {r.movements.length === 0 ? <EmptyState msg="No stock movements in this period" /> : r.movements.map((m, i) => (
          <View key={i} style={{ paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, fontSize: 13, color: '#1e1b4b', paddingRight: 8 }} numberOfLines={1}>{m.productName}</Text>
              <Text style={{ fontSize: 13, fontWeight: '700', color: m.changeQty > 0 ? '#16a34a' : '#dc2626' }}>
                {m.changeQty > 0 ? `+${m.changeQty}` : m.changeQty}
              </Text>
            </View>
            <Text style={{ fontSize: 10, color: '#94a3b8', textTransform: 'capitalize' }}>{m.reason} · by {m.adjustedBy} · {m.date}</Text>
          </View>
        ))}
      </SCard>
    </>
  );
}

function LowStockView({ items }: { items: LowStockItem[] }) {
  const outOfStock = items.filter((i) => i.stockQty <= 0);
  const lowStock = items.filter((i) => i.stockQty > 0);
  return (
    <>
      <SCard title="Stock Status">
        <View style={{ flexDirection: 'row', margin: -4 }}>
          <KpiTile label="Out of Stock" value={String(outOfStock.length)} bg="#fef2f2" color="#dc2626" />
          <KpiTile label="Low Stock" value={String(lowStock.length)} bg="#fffbeb" color="#d97706" />
        </View>
      </SCard>

      {outOfStock.length > 0 && (
        <SCard title="Out of Stock">
          {outOfStock.map((item) => (
            <View key={item.productId} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
              <View>
                <Text style={{ fontSize: 13, color: '#1e1b4b' }}>{item.name}</Text>
                <Text style={{ fontSize: 10, color: '#94a3b8' }}>{item.category} · {item.station} · {item.unit}</Text>
              </View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#dc2626' }}>0 / {item.threshold}</Text>
            </View>
          ))}
        </SCard>
      )}

      {lowStock.length > 0 && (
        <SCard title="Low Stock">
          {lowStock.map((item) => (
            <View key={item.productId} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
              <View>
                <Text style={{ fontSize: 13, color: '#1e1b4b' }}>{item.name}</Text>
                <Text style={{ fontSize: 10, color: '#94a3b8' }}>{item.category} · {item.station} · {item.unit}</Text>
              </View>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#d97706' }}>{item.stockQty} / {item.threshold}</Text>
            </View>
          ))}
        </SCard>
      )}

      {items.length === 0 && <SCard title=""><Text style={{ color: '#16a34a', textAlign: 'center', fontWeight: '600' }}>All products are well stocked!</Text></SCard>}
    </>
  );
}

function DebtorsView({ entries }: { entries: DebtorEntry[] }) {
  const total = entries.reduce((s, e) => s + Math.max(0, e.balance), 0);
  return (
    <>
      <SCard title="Credit Summary">
        <View style={{ flexDirection: 'row', margin: -4 }}>
          <KpiTile label="Outstanding" value={formatKES(total)} bg="#fef2f2" color="#dc2626" />
          <KpiTile label="Customers" value={String(entries.length)} bg="#eff6ff" color="#2563eb" />
        </View>
      </SCard>

      {entries.length === 0 ? <EmptyState msg="No credit customers with balances." /> : entries.map((e) => (
        <SCard key={e.customerId} title={e.name} right={
          <Text style={{ fontSize: 13, fontWeight: '700', color: e.balance > 0 ? '#dc2626' : '#16a34a' }}>
            {e.balance > 0 ? formatKES(e.balance) : 'Settled'}
          </Text>
        }>
          {e.phone && <Text style={{ fontSize: 11, color: '#94a3b8', marginBottom: 8 }}>{e.phone}</Text>}
          <DataRow left="Total Charged" right={formatKES(e.totalCharged)} rightColor="#dc2626" />
          <DataRow left="Total Repaid" right={formatKES(e.totalRepaid)} rightColor="#16a34a" />
          <DataRow left="Outstanding Balance" right={formatKES(e.balance)} rightColor={e.balance > 0 ? '#dc2626' : '#16a34a'} />
          {e.creditLimit > 0 && <DataRow left="Credit Limit" right={formatKES(e.creditLimit)} />}
          <DataRow left="Transactions" right={String(e.transactionCount)} />
          {e.lastActivity && <DataRow left="Last Activity" right={e.lastActivity.toLocaleDateString()} />}
        </SCard>
      ))}
    </>
  );
}

function HourlyView({ r }: { r: HourlySalesReport }) {
  const maxRev = Math.max(...r.hourlyData.map((h) => h.revenue), 1);
  return (
    <>
      <SCard title={r.isHourly ? 'Today by Hour' : 'Daily Breakdown'} right={<Text style={{ fontSize: 11, color: '#94a3b8' }}>{r.period}</Text>}>
        <View style={{ flexDirection: 'row', margin: -4 }}>
          <KpiTile label="Total Revenue" value={formatKES(r.totalRevenue)} bg="#f0fdf4" color="#16a34a" />
          <KpiTile label="Peak Period" value={r.peakLabel} bg="#faf5ff" color="#7c3aed" sub={formatKES(r.peakRevenue)} />
          <KpiTile label="Orders" value={String(r.totalOrders)} bg="#eff6ff" color="#2563eb" />
        </View>
      </SCard>

      <SCard title={r.isHourly ? 'Revenue by Hour' : 'Revenue by Day'}>
        {r.hourlyData.length === 0 ? <EmptyState msg="No data for this period" /> : r.hourlyData.map((h) => (
          <View key={h.label} style={{ paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: 12, color: '#475569', width: 60 }}>{h.label}</Text>
              <View style={{ flex: 1, paddingHorizontal: 8 }}>
                <View style={{ height: 6, backgroundColor: '#f1f5f9', borderRadius: 3 }}>
                  <View style={{ height: 6, width: `${(h.revenue / maxRev) * 100}%`, backgroundColor: '#7c3aed', borderRadius: 3 }} />
                </View>
              </View>
              <Text style={{ fontSize: 12, fontWeight: '600', color: '#1e1b4b', width: 90, textAlign: 'right' }}>{formatKES(h.revenue)}</Text>
              <Text style={{ fontSize: 10, color: '#94a3b8', width: 44, textAlign: 'right' }}>{h.orders}x</Text>
            </View>
          </View>
        ))}
      </SCard>
    </>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function ReportsScreen() {
  const can = useAuthStore((s) => s.can);
  const currentStaff = useAuthStore((s) => s.currentStaff);

  const [activeReport, setActiveReport] = useState<ReportType>('sales');
  const [period, setPeriod] = useState<Period>('today');
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Report data state
  const [salesData, setSalesData] = useState<SalesReport | null>(null);
  const [pnlData, setPnlData] = useState<ProfitLossReport | null>(null);
  const [productData, setProductData] = useState<ProductPerformanceReport | null>(null);
  const [categoryData, setCategoryData] = useState<CategoryAnalysisReport | null>(null);
  const [paymentData, setPaymentData] = useState<PaymentAnalysisReport | null>(null);
  const [staffData, setStaffData] = useState<StaffPerformanceReport | null>(null);
  const [shiftData, setShiftData] = useState<ShiftReport[]>([]);
  const [expenseData, setExpenseData] = useState<ExpenseReport | null>(null);
  const [discountsData, setDiscountsData] = useState<DiscountsVoidsReport | null>(null);
  const [stockData, setStockData] = useState<StockMovementReport | null>(null);
  const [lowStockData, setLowStockData] = useState<LowStockItem[]>([]);
  const [debtorsData, setDebtorsData] = useState<DebtorEntry[]>([]);
  const [hourlyData, setHourlyData] = useState<HourlySalesReport | null>(null);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      switch (activeReport) {
        case 'sales':      setSalesData(await getSalesReport(period)); break;
        case 'pnl':        setPnlData(await getProfitLossReport(period)); break;
        case 'products':   setProductData(await getProductPerformanceReport(period)); break;
        case 'categories': setCategoryData(await getCategoryAnalysisReport(period)); break;
        case 'payments':   setPaymentData(await getPaymentAnalysisReport(period)); break;
        case 'staff':      setStaffData(await getStaffPerformanceReport(period)); break;
        case 'shifts': {
          const sid = can('viewAllReports') ? undefined : currentStaff?.id;
          setShiftData(await getShiftReports(period, sid));
          break;
        }
        case 'expenses':   setExpenseData(await getExpenseReport(period)); break;
        case 'discounts':  setDiscountsData(await getDiscountsVoidsReport(period)); break;
        case 'stock':      setStockData(await getStockMovementReport(period)); break;
        case 'lowstock':   setLowStockData(await getLowStockItems()); break;
        case 'debtors':    setDebtorsData(await getDebtorsReport()); break;
        case 'hourly':     setHourlyData(await getHourlySalesReport(period)); break;
      }
    } catch (e) {
      console.warn('Report error:', e);
    }
    setLoading(false);
  }, [activeReport, period]);

  useFocusEffect(useCallback(() => { loadReport(); }, [loadReport]));

  const handleExport = async (format: 'csv' | 'pdf') => {
    try {
      if (format === 'csv') {
        switch (activeReport) {
          case 'sales':      if (salesData) await exportSalesCSV(salesData); break;
          case 'pnl':        if (pnlData) await exportProfitLossCSV(pnlData); break;
          case 'products':   if (productData) await exportProductPerformanceCSV(productData); break;
          case 'categories': if (categoryData) await exportCategoryAnalysisCSV(categoryData); break;
          case 'payments':   if (paymentData) await exportPaymentAnalysisCSV(paymentData); break;
          case 'staff':      if (staffData) await exportStaffPerformanceCSV(staffData); break;
          case 'shifts':     if (shiftData.length) await exportShiftCSV(shiftData); break;
          case 'expenses':   if (expenseData) await exportExpenseCSV(expenseData); break;
          case 'discounts':  if (discountsData) await exportDiscountsVoidsCSV(discountsData); break;
          case 'stock':      if (stockData) await exportStockMovementCSV(stockData); break;
          case 'lowstock':   if (lowStockData.length) await exportLowStockCSV(lowStockData); break;
          case 'debtors':    if (debtorsData.length) await exportDebtorsCSV(debtorsData); break;
          case 'hourly':     if (hourlyData) await exportHourlySalesCSV(hourlyData); break;
        }
      } else {
        switch (activeReport) {
          case 'sales':    if (salesData) await exportSalesPDF(salesData); break;
          case 'pnl':      if (pnlData) await exportProfitLossPDF(pnlData); break;
          case 'expenses': if (expenseData) await exportExpensePDF(expenseData); break;
          default: Alert.alert('PDF not available', 'PDF export is available for Sales, P&L, and Expenses reports.'); break;
        }
      }
    } catch {
      Alert.alert('Export Error', 'Could not export report.');
    }
  };

  const meta = REPORTS.find((r) => r.key === activeReport)!;
  const hasPDF = meta.hasPDF || false;
  const visibleReports = REPORTS.filter((r) => !r.adminOnly || can('viewAllReports'));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f0f2f5' }}>
      {/* Header */}
      <View style={{ backgroundColor: '#fff', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={{ fontSize: 15, color: '#4338CA' }}>← Home</Text>
          </TouchableOpacity>
          <Text style={{ fontSize: 17, fontWeight: '700', color: '#1e1b4b' }}>Reports</Text>
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity onPress={() => handleExport('csv')} style={{ backgroundColor: '#16a34a', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginLeft: 6 }}>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>CSV</Text>
            </TouchableOpacity>
            {hasPDF && (
              <TouchableOpacity onPress={() => handleExport('pdf')} style={{ backgroundColor: '#2563eb', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginLeft: 6 }}>
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>PDF</Text>
              </TouchableOpacity>
            )}
            {activeReport === 'lowstock' && (
              <TouchableOpacity
                onPress={async () => { const r = await triggerLowStockAlerts(); Alert.alert('Alerts', r.sent > 0 ? `${r.sent} alert(s) sent` : 'No new alerts'); }}
                style={{ backgroundColor: '#dc2626', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, marginLeft: 6 }}
              >
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>Alert</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Report selector button */}
        <TouchableOpacity
          onPress={() => setSelectorOpen(true)}
          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#f8fafc', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: '#e2e8f0' }}
        >
          <Text style={{ fontSize: 16, marginRight: 8 }}>{meta.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '700', color: '#1e1b4b' }}>{meta.label}</Text>
            <Text style={{ fontSize: 11, color: '#94a3b8' }}>{meta.desc}</Text>
          </View>
          <Text style={{ fontSize: 16, color: '#94a3b8' }}>▾</Text>
        </TouchableOpacity>

        {/* Period selector */}
        {meta.hasPeriod && (
          <View style={{ flexDirection: 'row', marginTop: 10 }}>
            {PERIODS.map((p) => (
              <TouchableOpacity
                key={p.key}
                onPress={() => setPeriod(p.key)}
                style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, marginRight: 8, backgroundColor: period === p.key ? '#4338CA' : '#f1f5f9' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '600', color: period === p.key ? '#fff' : '#64748b' }}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Report content */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color="#4338CA" />
          <Text style={{ color: '#94a3b8', marginTop: 12, fontSize: 13 }}>Loading report...</Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
          {activeReport === 'sales'      && salesData      && <SalesView r={salesData} />}
          {activeReport === 'pnl'        && pnlData        && <PnLView r={pnlData} />}
          {activeReport === 'products'   && productData    && <ProductView r={productData} />}
          {activeReport === 'categories' && categoryData   && <CategoryView r={categoryData} />}
          {activeReport === 'payments'   && paymentData    && <PaymentsView r={paymentData} />}
          {activeReport === 'staff'      && staffData      && <StaffView r={staffData} />}
          {activeReport === 'shifts'     && <ShiftsView reports={shiftData} />}
          {activeReport === 'expenses'   && expenseData    && <ExpensesView r={expenseData} />}
          {activeReport === 'discounts'  && discountsData  && <DiscountsView r={discountsData} />}
          {activeReport === 'stock'      && stockData      && <StockView r={stockData} />}
          {activeReport === 'lowstock'   && <LowStockView items={lowStockData} />}
          {activeReport === 'debtors'    && <DebtorsView entries={debtorsData} />}
          {activeReport === 'hourly'     && hourlyData     && <HourlyView r={hourlyData} />}
          {loading === false && !salesData && activeReport === 'sales' && <EmptyState msg="No data for this period" />}
        </ScrollView>
      )}

      {/* Report Selector Modal */}
      <Modal visible={selectorOpen} animationType="slide" transparent>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} onPress={() => setSelectorOpen(false)} />
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', position: 'absolute', bottom: 0, left: 0, right: 0 }}>
          <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#1e1b4b' }}>Select Report</Text>
            <TouchableOpacity onPress={() => setSelectorOpen(false)}>
              <Text style={{ fontSize: 15, color: '#94a3b8' }}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView>
            {visibleReports.map((r) => (
              <TouchableOpacity
                key={r.key}
                onPress={() => { setActiveReport(r.key); setSelectorOpen(false); }}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f8fafc', backgroundColor: activeReport === r.key ? '#fef2f2' : '#fff' }}
              >
                <Text style={{ fontSize: 22, marginRight: 14 }}>{r.icon}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 14, fontWeight: '600', color: activeReport === r.key ? '#4338CA' : '#1e1b4b' }}>{r.label}</Text>
                  <Text style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{r.desc}</Text>
                </View>
                {activeReport === r.key && <Text style={{ color: '#4338CA', fontSize: 16 }}>✓</Text>}
              </TouchableOpacity>
            ))}
            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
