import { Q } from '@nozbe/watermelondb';
import { database } from '../db';
import {
  Order, OrderItem, Payment, Expense, Shift, Customer,
  CreditTransaction, Product, Category, StockAdjustment, Refund, Staff,
} from '../db/models';

// ─── Date helpers ───────────────────────────────────────────────────────────

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return startOfDay(new Date(d.getFullYear(), d.getMonth(), diff));
}
function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export type Period = 'today' | 'week' | 'month' | 'custom';

function getDateRange(period: Period, customStart?: Date, customEnd?: Date): [Date, Date] {
  const now = new Date();
  switch (period) {
    case 'today':  return [startOfDay(now), endOfDay(now)];
    case 'week':   return [startOfWeek(now), endOfDay(now)];
    case 'month':  return [startOfMonth(now), endOfDay(now)];
    case 'custom': return [customStart || startOfDay(now), customEnd || endOfDay(now)];
  }
}

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

// ─── Sales Report ───────────────────────────────────────────────────────────

export interface SalesReport {
  period: string;
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  totalDiscounts: number;
  totalRefunds: number;
  totalComplimentary: number;
  creditOrders: number;
  paymentBreakdown: Record<string, number>;
  categoryBreakdown: Array<{ name: string; revenue: number; qty: number }>;
  topProducts: Array<{ name: string; revenue: number; qty: number; grossProfit: number; margin: number }>;
  dailyTotals: Array<{ date: string; revenue: number; orders: number }>;
}

export async function getSalesReport(period: Period, customStart?: Date, customEnd?: Date): Promise<SalesReport> {
  const [from, to] = getDateRange(period, customStart, customEnd);

  // ── Drive the report entirely from payment records ──────────────────────────
  // This ensures revenue always equals the sum of payment methods with no drift.
  const payments = await database.get<Payment>('payments')
    .query(
      Q.where('paid_at', Q.gte(from.getTime())),
      Q.where('paid_at', Q.lte(to.getTime()))
    ).fetch();

  // Derive unique order IDs touched by these payments
  const orderIdSet = new Set(payments.map((p) => p.orderId));
  const orderIds = Array.from(orderIdSet);

  // Fetch the corresponding orders (for discounts, credit flag, item breakdown)
  let orders: Order[] = [];
  if (orderIds.length > 0) {
    orders = await database.get<Order>('orders')
      .query(Q.where('id', Q.oneOf(orderIds))).fetch();
  }

  // Revenue = actual money received (sum of payments, not order.totalAmount)
  const totalRevenue = payments.reduce((s, p) => s + p.amount, 0);
  const totalOrders = orderIds.length;
  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;
  const totalDiscounts = orders.reduce((s, o) => s + (o.discountAmount || 0), 0);
  const creditOrders = orders.filter((o) => o.isCredit).length;

  // Payment breakdown directly from payment records → always matches totalRevenue
  const paymentBreakdown: Record<string, number> = {};
  for (const p of payments) {
    paymentBreakdown[p.method] = (paymentBreakdown[p.method] || 0) + p.amount;
  }

  // Refunds
  let totalRefunds = 0;
  if (payments.length > 0) {
    const paymentIds = payments.map((p) => p.id);
    const refunds = await database.get<Refund>('refunds')
      .query(Q.where('payment_id', Q.oneOf(paymentIds))).fetch();
    totalRefunds = refunds.reduce((s, r) => s + r.amount, 0);
  }

  const catMap: Record<string, { name: string; revenue: number; qty: number }> = {};
  const prodMap: Record<string, { name: string; revenue: number; qty: number; cogs: number }> = {};
  let totalComplimentary = 0;

  if (orderIds.length > 0) {
    const items = await database.get<OrderItem>('order_items')
      .query(Q.where('order_id', Q.oneOf(orderIds)), Q.where('voided', false)).fetch();

    const cats = await database.get<Category>('categories').query().fetch();
    const catNames: Record<string, string> = {};
    for (const c of cats) catNames[c.id] = c.name;

    const products = await database.get<Product>('products').query().fetch();
    const prodCatMap: Record<string, string> = {};
    const prodCostMap: Record<string, number> = {};
    const prodNameMap: Record<string, string> = {};
    for (const p of products) {
      prodCatMap[p.id] = p.categoryId;
      prodCostMap[p.id] = p.costPrice || 0;
      prodNameMap[p.id] = p.name;
    }

    for (const item of items) {
      const revenue = item.unitPrice * item.qty;
      const cost = (prodCostMap[item.productId] || 0) * item.qty;

      if (item.isComplimentary) {
        totalComplimentary += revenue;
        continue;
      }

      // Category breakdown
      const catId = prodCatMap[item.productId] || 'unknown';
      const catName = catNames[catId] || 'Other';
      if (!catMap[catId]) catMap[catId] = { name: catName, revenue: 0, qty: 0 };
      catMap[catId].revenue += revenue;
      catMap[catId].qty += item.qty;

      // Product breakdown
      const pName = prodNameMap[item.productId] || 'Unknown';
      if (!prodMap[item.productId]) prodMap[item.productId] = { name: pName, revenue: 0, qty: 0, cogs: 0 };
      prodMap[item.productId].revenue += revenue;
      prodMap[item.productId].qty += item.qty;
      prodMap[item.productId].cogs += cost;
    }
  }

  const topProducts = Object.values(prodMap)
    .map((p) => ({
      name: p.name,
      revenue: p.revenue,
      qty: p.qty,
      grossProfit: p.revenue - p.cogs,
      margin: pct(p.revenue - p.cogs, p.revenue),
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 10);

  // Daily totals keyed by payment date (not order open/close date)
  const dailyMap: Record<string, { revenue: number; orders: Set<string> }> = {};
  for (const p of payments) {
    const dateKey = new Date(p.paidAt).toISOString().split('T')[0];
    if (!dailyMap[dateKey]) dailyMap[dateKey] = { revenue: 0, orders: new Set() };
    dailyMap[dateKey].revenue += p.amount;
    dailyMap[dateKey].orders.add(p.orderId);
  }

  return {
    period: `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`,
    totalRevenue, totalOrders, avgOrderValue,
    totalDiscounts, totalRefunds, totalComplimentary, creditOrders,
    paymentBreakdown,
    categoryBreakdown: Object.values(catMap).sort((a, b) => b.revenue - a.revenue),
    topProducts,
    dailyTotals: Object.entries(dailyMap).map(([date, d]) => ({ date, revenue: d.revenue, orders: d.orders.size })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

// ─── Expense Report ─────────────────────────────────────────────────────────

export interface ExpenseReport {
  period: string;
  totalExpenses: number;
  categoryBreakdown: Array<{ name: string; total: number; count: number }>;
  dailyTotals: Array<{ date: string; total: number }>;
  items: Array<{ description: string; amount: number; category: string; date: string; vendor: string | null }>;
}

export async function getExpenseReport(period: Period, customStart?: Date, customEnd?: Date): Promise<ExpenseReport> {
  const [from, to] = getDateRange(period, customStart, customEnd);
  const fromStr = from.toISOString().split('T')[0];
  const toStr = to.toISOString().split('T')[0];

  const expenses = await database.get<Expense>('expenses')
    .query(Q.where('date', Q.gte(fromStr)), Q.where('date', Q.lte(toStr))).fetch();

  const expCats = await database.get('expense_categories').query().fetch();
  const catNames: Record<string, string> = {};
  for (const c of expCats as any[]) catNames[c.id] = c.name;

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const catMap: Record<string, { name: string; total: number; count: number }> = {};
  const dailyMap: Record<string, number> = {};
  const items: ExpenseReport['items'] = [];

  for (const e of expenses) {
    const catName = catNames[e.categoryId] || 'Other';
    if (!catMap[e.categoryId]) catMap[e.categoryId] = { name: catName, total: 0, count: 0 };
    catMap[e.categoryId].total += e.amount;
    catMap[e.categoryId].count += 1;
    dailyMap[e.expenseDate] = (dailyMap[e.expenseDate] || 0) + e.amount;
    items.push({ description: e.description, amount: e.amount, category: catName, date: e.expenseDate, vendor: e.vendorName });
  }

  return {
    period: `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`,
    totalExpenses,
    categoryBreakdown: Object.values(catMap).sort((a, b) => b.total - a.total),
    dailyTotals: Object.entries(dailyMap).map(([date, total]) => ({ date, total })).sort((a, b) => a.date.localeCompare(b.date)),
    items,
  };
}

// ─── Shift Report ───────────────────────────────────────────────────────────

export interface ShiftReport {
  shiftId: string;
  staffName: string;
  openedAt: string;
  closedAt: string | null;
  openingCash: number;
  closingCashExpected: number;
  closingCashActual: number;
  variance: number;
  totalOrders: number;
  totalRevenue: number;
  paymentBreakdown: Record<string, number>;
}

export async function getShiftReports(period: Period, staffId?: string): Promise<ShiftReport[]> {
  const [from, to] = getDateRange(period);

  const query: any[] = [
    Q.where('opened_at', Q.gte(from.getTime())),
    Q.where('opened_at', Q.lte(to.getTime())),
  ];
  if (staffId) query.push(Q.where('staff_id', staffId));

  const shifts = await database.get<Shift>('shifts').query(...query).fetch();
  const staffAll = await database.get('staff').query().fetch();
  const staffNames: Record<string, string> = {};
  for (const s of staffAll as any[]) staffNames[s.id] = s.name;

  const reports: ShiftReport[] = [];

  for (const shift of shifts) {
    const shiftOrders = await database.get<Order>('orders').query(Q.where('shift_id', shift.id)).fetch();
    const paidOrders = shiftOrders.filter((o) => o.status === 'paid' || o.status === 'closed');
    const orderIds = paidOrders.map((o) => o.id);

    let payments: Payment[] = [];
    if (orderIds.length > 0) {
      payments = await database.get<Payment>('payments').query(Q.where('order_id', Q.oneOf(orderIds))).fetch();
    }
    const paymentBreakdown: Record<string, number> = {};
    for (const p of payments) paymentBreakdown[p.method] = (paymentBreakdown[p.method] || 0) + p.amount;

    reports.push({
      shiftId: shift.id,
      staffName: staffNames[shift.staffId] || 'Unknown',
      openedAt: new Date(shift.openedAt).toLocaleString(),
      closedAt: shift.closedAt ? new Date(shift.closedAt).toLocaleString() : null,
      openingCash: shift.openingCash,
      closingCashExpected: shift.closingCashExpected || 0,
      closingCashActual: shift.closingCashActual || 0,
      variance: shift.variance || 0,
      totalOrders: paidOrders.length,
      totalRevenue: paidOrders.reduce((s, o) => s + o.totalAmount, 0),
      paymentBreakdown,
    });
  }

  return reports;
}

// ─── Debtors Report ─────────────────────────────────────────────────────────

export interface DebtorEntry {
  customerId: string;
  name: string;
  phone: string | null;
  creditLimit: number;
  totalCharged: number;
  totalRepaid: number;
  balance: number;
  lastActivity: Date | null;
  transactionCount: number;
}

export async function getDebtorsReport(): Promise<DebtorEntry[]> {
  const customers = await database.get<Customer>('customers').query(Q.where('is_active', true)).fetch();
  const entries: DebtorEntry[] = [];

  for (const cust of customers) {
    const txns = await database.get<CreditTransaction>('credit_transactions')
      .query(Q.where('customer_id', cust.id)).fetch();

    let totalCharged = 0, totalRepaid = 0;
    let lastActivity: Date | null = null;
    for (const t of txns) {
      if (t.type === 'credit_sale') totalCharged += t.amount;
      else totalRepaid += t.amount;
      if (!lastActivity || t.createdAt > lastActivity) lastActivity = t.createdAt;
    }

    const balance = totalCharged - totalRepaid;
    if (balance > 0 || txns.length > 0) {
      entries.push({
        customerId: cust.id, name: cust.name, phone: cust.phone,
        creditLimit: cust.creditLimit, totalCharged, totalRepaid, balance,
        lastActivity, transactionCount: txns.length,
      });
    }
  }

  entries.sort((a, b) => b.balance - a.balance);
  return entries;
}

// ─── Low Stock Report ───────────────────────────────────────────────────────

export interface LowStockItem {
  productId: string;
  name: string;
  category: string;
  station: string;
  stockQty: number;
  threshold: number;
  unit: string;
}

export async function getLowStockItems(): Promise<LowStockItem[]> {
  const products = await database.get<Product>('products').query(Q.where('is_active', true)).fetch();
  const cats = await database.get<Category>('categories').query().fetch();
  const catNames: Record<string, string> = {};
  const catStations: Record<string, string> = {};
  for (const c of cats) { catNames[c.id] = c.name; catStations[c.id] = c.prepStation || ''; }

  return products
    .filter((p) => p.stockQty <= p.lowStockThreshold)
    .map((p) => ({
      productId: p.id, name: p.name,
      category: catNames[p.categoryId] || '',
      station: catStations[p.categoryId] || '',
      stockQty: p.stockQty, threshold: p.lowStockThreshold, unit: p.unit,
    }))
    .sort((a, b) => a.stockQty - b.stockQty);
}

// ─── Profit & Loss Report ────────────────────────────────────────────────────

export interface ProfitLossReport {
  period: string;
  grossRevenue: number;
  totalDiscounts: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMargin: number;
  expenseLines: Array<{ category: string; amount: number; count: number }>;
  totalExpenses: number;
  netProfit: number;
  netMargin: number;
  totalRefunds: number;
  totalComplimentary: number;
  orderCount: number;
}

export async function getProfitLossReport(period: Period, customStart?: Date, customEnd?: Date): Promise<ProfitLossReport> {
  const [from, to] = getDateRange(period, customStart, customEnd);

  const orders = await database.get<Order>('orders')
    .query(
      Q.where('status', Q.oneOf(['paid', 'closed'])),
      Q.where('opened_at', Q.gte(from.getTime())),
      Q.where('opened_at', Q.lte(to.getTime()))
    ).fetch();

  const orderIds = orders.map((o) => o.id);
  const grossRevenue = orders.reduce((s, o) => s + o.totalAmount, 0);
  const totalDiscounts = orders.reduce((s, o) => s + (o.discountAmount || 0), 0);
  const netRevenue = grossRevenue;

  let cogs = 0, totalComplimentary = 0, totalRefunds = 0;

  if (orderIds.length > 0) {
    const items = await database.get<OrderItem>('order_items')
      .query(Q.where('order_id', Q.oneOf(orderIds)), Q.where('voided', false)).fetch();

    const products = await database.get<Product>('products').query().fetch();
    const costMap: Record<string, number> = {};
    for (const p of products) costMap[p.id] = p.costPrice || 0;

    for (const item of items) {
      if (item.isComplimentary) {
        totalComplimentary += item.unitPrice * item.qty;
      } else {
        cogs += (costMap[item.productId] || 0) * item.qty;
      }
    }

    const payments = await database.get<Payment>('payments')
      .query(Q.where('order_id', Q.oneOf(orderIds))).fetch();
    if (payments.length > 0) {
      const paymentIds = payments.map((p) => p.id);
      const refunds = await database.get<Refund>('refunds')
        .query(Q.where('payment_id', Q.oneOf(paymentIds))).fetch();
      totalRefunds = refunds.reduce((s, r) => s + r.amount, 0);
    }
  }

  const grossProfit = netRevenue - cogs;
  const grossMargin = pct(grossProfit, netRevenue);

  const fromStr = from.toISOString().split('T')[0];
  const toStr = to.toISOString().split('T')[0];
  const expenses = await database.get<Expense>('expenses')
    .query(Q.where('date', Q.gte(fromStr)), Q.where('date', Q.lte(toStr))).fetch();

  const expCats = await database.get('expense_categories').query().fetch();
  const catNames: Record<string, string> = {};
  for (const c of expCats as any[]) catNames[c.id] = c.name;

  const expMap: Record<string, { category: string; amount: number; count: number }> = {};
  for (const e of expenses) {
    const cat = catNames[e.categoryId] || 'Other';
    if (!expMap[e.categoryId]) expMap[e.categoryId] = { category: cat, amount: 0, count: 0 };
    expMap[e.categoryId].amount += e.amount;
    expMap[e.categoryId].count += 1;
  }

  const totalExpenses = expenses.reduce((s, e) => s + e.amount, 0);
  const netProfit = grossProfit - totalExpenses;
  const netMargin = pct(netProfit, grossRevenue);

  return {
    period: `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`,
    grossRevenue, totalDiscounts, netRevenue,
    cogs, grossProfit, grossMargin,
    expenseLines: Object.values(expMap).sort((a, b) => b.amount - a.amount),
    totalExpenses, netProfit, netMargin,
    totalRefunds, totalComplimentary, orderCount: orders.length,
  };
}

// ─── Product Performance Report ──────────────────────────────────────────────

export interface ProductPerformanceReport {
  period: string;
  totalRevenue: number;
  totalCogs: number;
  totalGrossProfit: number;
  products: Array<{
    name: string; category: string; station: string;
    qtySold: number; revenue: number; cogs: number;
    grossProfit: number; margin: number; pctOfRevenue: number;
  }>;
}

export async function getProductPerformanceReport(period: Period, customStart?: Date, customEnd?: Date): Promise<ProductPerformanceReport> {
  const [from, to] = getDateRange(period, customStart, customEnd);

  const orders = await database.get<Order>('orders')
    .query(
      Q.where('status', Q.oneOf(['paid', 'closed'])),
      Q.where('opened_at', Q.gte(from.getTime())),
      Q.where('opened_at', Q.lte(to.getTime()))
    ).fetch();

  const orderIds = orders.map((o) => o.id);
  const prodMap: Record<string, { name: string; category: string; station: string; qtySold: number; revenue: number; cogs: number }> = {};
  let totalRevenue = 0, totalCogs = 0;

  if (orderIds.length > 0) {
    const items = await database.get<OrderItem>('order_items')
      .query(Q.where('order_id', Q.oneOf(orderIds)), Q.where('voided', false), Q.where('is_complimentary', false)).fetch();

    const products = await database.get<Product>('products').query().fetch();
    const cats = await database.get<Category>('categories').query().fetch();
    const catNames: Record<string, string> = {};
    const catStations: Record<string, string> = {};
    for (const c of cats) { catNames[c.id] = c.name; catStations[c.id] = c.prepStation || ''; }

    const prodInfo: Record<string, { name: string; catId: string; costPrice: number }> = {};
    for (const p of products) prodInfo[p.id] = { name: p.name, catId: p.categoryId, costPrice: p.costPrice || 0 };

    for (const item of items) {
      const info = prodInfo[item.productId];
      if (!info) continue;
      const revenue = item.unitPrice * item.qty;
      const cost = info.costPrice * item.qty;
      if (!prodMap[item.productId]) {
        prodMap[item.productId] = {
          name: info.name,
          category: catNames[info.catId] || 'Other',
          station: catStations[info.catId] || '',
          qtySold: 0, revenue: 0, cogs: 0,
        };
      }
      prodMap[item.productId].qtySold += item.qty;
      prodMap[item.productId].revenue += revenue;
      prodMap[item.productId].cogs += cost;
      totalRevenue += revenue;
      totalCogs += cost;
    }
  }

  const totalGrossProfit = totalRevenue - totalCogs;
  const products = Object.values(prodMap)
    .map((p) => ({
      ...p,
      grossProfit: p.revenue - p.cogs,
      margin: pct(p.revenue - p.cogs, p.revenue),
      pctOfRevenue: pct(p.revenue, totalRevenue),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  return {
    period: `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`,
    totalRevenue, totalCogs, totalGrossProfit, products,
  };
}

// ─── Category Analysis Report ────────────────────────────────────────────────

export interface CategoryAnalysisReport {
  period: string;
  totalRevenue: number;
  totalCogs: number;
  categories: Array<{
    name: string; station: string;
    revenue: number; qty: number; cogs: number;
    grossProfit: number; margin: number; pctOfTotal: number;
  }>;
}

export async function getCategoryAnalysisReport(period: Period, customStart?: Date, customEnd?: Date): Promise<CategoryAnalysisReport> {
  const [from, to] = getDateRange(period, customStart, customEnd);

  const orders = await database.get<Order>('orders')
    .query(
      Q.where('status', Q.oneOf(['paid', 'closed'])),
      Q.where('opened_at', Q.gte(from.getTime())),
      Q.where('opened_at', Q.lte(to.getTime()))
    ).fetch();

  const orderIds = orders.map((o) => o.id);
  const catMap: Record<string, { name: string; station: string; revenue: number; qty: number; cogs: number }> = {};
  let totalRevenue = 0, totalCogs = 0;

  if (orderIds.length > 0) {
    const items = await database.get<OrderItem>('order_items')
      .query(Q.where('order_id', Q.oneOf(orderIds)), Q.where('voided', false), Q.where('is_complimentary', false)).fetch();

    const cats = await database.get<Category>('categories').query().fetch();
    const catInfo: Record<string, { name: string; station: string }> = {};
    for (const c of cats) catInfo[c.id] = { name: c.name, station: c.prepStation || '' };

    const products = await database.get<Product>('products').query().fetch();
    const prodInfo: Record<string, { catId: string; costPrice: number }> = {};
    for (const p of products) prodInfo[p.id] = { catId: p.categoryId, costPrice: p.costPrice || 0 };

    for (const item of items) {
      const prod = prodInfo[item.productId];
      if (!prod) continue;
      const cat = catInfo[prod.catId] || { name: 'Other', station: '' };
      const revenue = item.unitPrice * item.qty;
      const cost = prod.costPrice * item.qty;
      if (!catMap[prod.catId]) catMap[prod.catId] = { name: cat.name, station: cat.station, revenue: 0, qty: 0, cogs: 0 };
      catMap[prod.catId].revenue += revenue;
      catMap[prod.catId].qty += item.qty;
      catMap[prod.catId].cogs += cost;
      totalRevenue += revenue;
      totalCogs += cost;
    }
  }

  return {
    period: `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`,
    totalRevenue, totalCogs,
    categories: Object.values(catMap)
      .map((c) => ({
        ...c,
        grossProfit: c.revenue - c.cogs,
        margin: pct(c.revenue - c.cogs, c.revenue),
        pctOfTotal: pct(c.revenue, totalRevenue),
      }))
      .sort((a, b) => b.revenue - a.revenue),
  };
}

// ─── Payment Analysis Report ─────────────────────────────────────────────────

export interface PaymentAnalysisReport {
  period: string;
  totalCollected: number;
  totalRefunded: number;
  netReceived: number;
  methods: Array<{ method: string; amount: number; count: number; pct: number; refunded: number }>;
  hourlyTotals: Array<{ label: string; revenue: number; orders: number }>;
  peakLabel: string;
}

export async function getPaymentAnalysisReport(period: Period, customStart?: Date, customEnd?: Date): Promise<PaymentAnalysisReport> {
  const [from, to] = getDateRange(period, customStart, customEnd);

  const orders = await database.get<Order>('orders')
    .query(
      Q.where('status', Q.oneOf(['paid', 'closed'])),
      Q.where('opened_at', Q.gte(from.getTime())),
      Q.where('opened_at', Q.lte(to.getTime()))
    ).fetch();

  const orderIds = orders.map((o) => o.id);
  let payments: Payment[] = [];
  if (orderIds.length > 0) {
    payments = await database.get<Payment>('payments')
      .query(Q.where('order_id', Q.oneOf(orderIds))).fetch();
  }

  const totalCollected = payments.reduce((s, p) => s + p.amount, 0);

  // Refunds per payment method
  let totalRefunded = 0;
  const refundByPayment: Record<string, number> = {};
  if (payments.length > 0) {
    const paymentIds = payments.map((p) => p.id);
    const refunds = await database.get<Refund>('refunds')
      .query(Q.where('payment_id', Q.oneOf(paymentIds))).fetch();
    // Map paymentId → method
    const payMethodMap: Record<string, string> = {};
    for (const p of payments) payMethodMap[p.id] = p.method;
    for (const r of refunds) {
      totalRefunded += r.amount;
      const method = payMethodMap[r.paymentId] || 'other';
      refundByPayment[method] = (refundByPayment[method] || 0) + r.amount;
    }
  }

  const methodMap: Record<string, { amount: number; count: number }> = {};
  for (const p of payments) {
    if (!methodMap[p.method]) methodMap[p.method] = { amount: 0, count: 0 };
    methodMap[p.method].amount += p.amount;
    methodMap[p.method].count += 1;
  }

  const methods = Object.entries(methodMap).map(([method, d]) => ({
    method,
    amount: d.amount,
    count: d.count,
    pct: pct(d.amount, totalCollected),
    refunded: refundByPayment[method] || 0,
  })).sort((a, b) => b.amount - a.amount);

  // Hourly / daily grouping
  const isToday = period === 'today';
  const groupMap: Record<string, { revenue: number; orders: number }> = {};

  for (const o of orders) {
    const d = new Date(o.openedAt);
    const key = isToday
      ? `${String(d.getHours()).padStart(2, '0')}:00`
      : d.toISOString().split('T')[0];
    if (!groupMap[key]) groupMap[key] = { revenue: 0, orders: 0 };
    groupMap[key].revenue += o.totalAmount;
    groupMap[key].orders += 1;
  }

  const hourlyTotals = Object.entries(groupMap)
    .map(([label, d]) => ({ label, ...d }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const peak = hourlyTotals.reduce((best, h) => h.revenue > (best?.revenue ?? -1) ? h : best, hourlyTotals[0] ?? null);

  return {
    period: `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`,
    totalCollected, totalRefunded, netReceived: totalCollected - totalRefunded,
    methods, hourlyTotals,
    peakLabel: peak ? peak.label : '—',
  };
}

// ─── Staff Performance Report ─────────────────────────────────────────────────

export interface StaffPerformanceReport {
  period: string;
  staff: Array<{
    staffId: string; name: string; role: string;
    orders: number; revenue: number; avgOrder: number;
    discountsGiven: number; compsGiven: number; shifts: number;
  }>;
}

export async function getStaffPerformanceReport(period: Period, customStart?: Date, customEnd?: Date): Promise<StaffPerformanceReport> {
  const [from, to] = getDateRange(period, customStart, customEnd);

  const orders = await database.get<Order>('orders')
    .query(
      Q.where('status', Q.oneOf(['paid', 'closed'])),
      Q.where('opened_at', Q.gte(from.getTime())),
      Q.where('opened_at', Q.lte(to.getTime()))
    ).fetch();

  const shifts = await database.get<Shift>('shifts')
    .query(Q.where('opened_at', Q.gte(from.getTime())), Q.where('opened_at', Q.lte(to.getTime()))).fetch();

  const allStaff = await database.get<Staff>('staff').query(Q.where('is_active', true)).fetch();
  const staffInfo: Record<string, { name: string; role: string }> = {};
  for (const s of allStaff) staffInfo[s.id] = { name: s.name, role: s.role };

  const orderIds = orders.map((o) => o.id);
  let allItems: OrderItem[] = [];
  if (orderIds.length > 0) {
    allItems = await database.get<OrderItem>('order_items')
      .query(Q.where('order_id', Q.oneOf(orderIds)), Q.where('voided', false)).fetch();
  }

  // Map orderId → staffId
  const orderStaffMap: Record<string, string> = {};
  for (const o of orders) orderStaffMap[o.id] = o.staffId;

  // Comps per staff
  const compsPerStaff: Record<string, number> = {};
  for (const item of allItems) {
    if (item.isComplimentary) {
      const sid = orderStaffMap[item.orderId];
      if (sid) compsPerStaff[sid] = (compsPerStaff[sid] || 0) + item.unitPrice * item.qty;
    }
  }

  // Shifts per staff
  const shiftsPerStaff: Record<string, number> = {};
  for (const sh of shifts) shiftsPerStaff[sh.staffId] = (shiftsPerStaff[sh.staffId] || 0) + 1;

  // Orders & revenue per staff
  const staffMap: Record<string, { orders: number; revenue: number; discounts: number }> = {};
  for (const o of orders) {
    if (!staffMap[o.staffId]) staffMap[o.staffId] = { orders: 0, revenue: 0, discounts: 0 };
    staffMap[o.staffId].orders += 1;
    staffMap[o.staffId].revenue += o.totalAmount;
    staffMap[o.staffId].discounts += o.discountAmount || 0;
  }

  const result = Object.entries(staffMap).map(([sid, d]) => ({
    staffId: sid,
    name: staffInfo[sid]?.name || 'Unknown',
    role: staffInfo[sid]?.role || '',
    orders: d.orders,
    revenue: d.revenue,
    avgOrder: d.orders > 0 ? Math.round(d.revenue / d.orders) : 0,
    discountsGiven: d.discounts,
    compsGiven: compsPerStaff[sid] || 0,
    shifts: shiftsPerStaff[sid] || 0,
  })).sort((a, b) => b.revenue - a.revenue);

  return {
    period: `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`,
    staff: result,
  };
}

// ─── Discounts, Voids & Comps Report ─────────────────────────────────────────

export interface DiscountsVoidsReport {
  period: string;
  totalDiscountValue: number;
  discountedOrders: number;
  discountReasons: Array<{ reason: string; count: number; amount: number }>;
  totalVoidValue: number;
  voidedItemCount: number;
  voidReasons: Array<{ reason: string; count: number; value: number }>;
  totalCompValue: number;
  compItemCount: number;
  compReasons: Array<{ reason: string; count: number; value: number }>;
}

export async function getDiscountsVoidsReport(period: Period, customStart?: Date, customEnd?: Date): Promise<DiscountsVoidsReport> {
  const [from, to] = getDateRange(period, customStart, customEnd);

  const orders = await database.get<Order>('orders')
    .query(Q.where('opened_at', Q.gte(from.getTime())), Q.where('opened_at', Q.lte(to.getTime()))).fetch();

  const orderIds = orders.map((o) => o.id);

  // Discounts
  const discountedOrders = orders.filter((o) => (o.discountAmount || 0) > 0);
  const totalDiscountValue = discountedOrders.reduce((s, o) => s + (o.discountAmount || 0), 0);

  const discountReasonMap: Record<string, { count: number; amount: number }> = {};
  for (const o of discountedOrders) {
    const r = o.discountReason || 'No reason';
    if (!discountReasonMap[r]) discountReasonMap[r] = { count: 0, amount: 0 };
    discountReasonMap[r].count += 1;
    discountReasonMap[r].amount += o.discountAmount || 0;
  }

  let voidedItemCount = 0, totalVoidValue = 0, compItemCount = 0, totalCompValue = 0;
  const voidReasonMap: Record<string, { count: number; value: number }> = {};
  const compReasonMap: Record<string, { count: number; value: number }> = {};

  if (orderIds.length > 0) {
    const voidedItems = await database.get<OrderItem>('order_items')
      .query(Q.where('order_id', Q.oneOf(orderIds)), Q.where('voided', true)).fetch();

    for (const item of voidedItems) {
      const value = item.unitPrice * item.qty;
      totalVoidValue += value;
      voidedItemCount += 1;
      const r = item.voidReason || 'No reason';
      if (!voidReasonMap[r]) voidReasonMap[r] = { count: 0, value: 0 };
      voidReasonMap[r].count += 1;
      voidReasonMap[r].value += value;
    }

    const compItems = await database.get<OrderItem>('order_items')
      .query(Q.where('order_id', Q.oneOf(orderIds)), Q.where('is_complimentary', true), Q.where('voided', false)).fetch();

    for (const item of compItems) {
      const value = item.unitPrice * item.qty;
      totalCompValue += value;
      compItemCount += 1;
      const r = item.compReason || 'No reason';
      if (!compReasonMap[r]) compReasonMap[r] = { count: 0, value: 0 };
      compReasonMap[r].count += 1;
      compReasonMap[r].value += value;
    }
  }

  return {
    period: `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`,
    totalDiscountValue, discountedOrders: discountedOrders.length,
    discountReasons: Object.entries(discountReasonMap).map(([reason, d]) => ({ reason, ...d })).sort((a, b) => b.amount - a.amount),
    totalVoidValue, voidedItemCount,
    voidReasons: Object.entries(voidReasonMap).map(([reason, d]) => ({ reason, ...d })).sort((a, b) => b.count - a.count),
    totalCompValue, compItemCount,
    compReasons: Object.entries(compReasonMap).map(([reason, d]) => ({ reason, ...d })).sort((a, b) => b.value - a.value),
  };
}

// ─── Stock Movement Report ────────────────────────────────────────────────────

export interface StockMovementReport {
  period: string;
  restocks:    { count: number; totalUnits: number };
  wastage:     { count: number; totalUnits: number };
  breakage:    { count: number; totalUnits: number };
  corrections: { count: number; netUnits: number };
  movements: Array<{
    productName: string; reason: string; changeQty: number;
    adjustedBy: string; date: string;
  }>;
}

export async function getStockMovementReport(period: Period, customStart?: Date, customEnd?: Date): Promise<StockMovementReport> {
  const [from, to] = getDateRange(period, customStart, customEnd);

  const adjustments = await database.get<StockAdjustment>('stock_adjustments')
    .query(
      Q.where('created_at', Q.gte(from.getTime())),
      Q.where('created_at', Q.lte(to.getTime()))
    ).fetch();

  const products = await database.get<Product>('products').query().fetch();
  const prodNames: Record<string, string> = {};
  for (const p of products) prodNames[p.id] = p.name;

  const allStaff = await database.get<Staff>('staff').query().fetch();
  const staffNames: Record<string, string> = {};
  for (const s of allStaff) staffNames[s.id] = s.name;

  const restocks    = { count: 0, totalUnits: 0 };
  const wastage     = { count: 0, totalUnits: 0 };
  const breakage    = { count: 0, totalUnits: 0 };
  const corrections = { count: 0, netUnits: 0 };

  const movements = adjustments.map((a) => {
    switch (a.reason) {
      case 'restock':    restocks.count++;    restocks.totalUnits += Math.abs(a.changeQty);    break;
      case 'wastage':    wastage.count++;     wastage.totalUnits += Math.abs(a.changeQty);     break;
      case 'breakage':   breakage.count++;    breakage.totalUnits += Math.abs(a.changeQty);    break;
      case 'correction': corrections.count++; corrections.netUnits += a.changeQty;             break;
    }
    return {
      productName: prodNames[a.productId] || 'Unknown',
      reason: a.reason,
      changeQty: a.changeQty,
      adjustedBy: staffNames[a.adjustedBy] || a.adjustedBy,
      date: new Date(a.createdAt).toLocaleString(),
    };
  }).sort((a, b) => b.date.localeCompare(a.date));

  return {
    period: `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`,
    restocks, wastage, breakage, corrections, movements,
  };
}

// ─── Hourly Sales Report ──────────────────────────────────────────────────────

export interface HourlySalesReport {
  period: string;
  isHourly: boolean;
  hourlyData: Array<{ label: string; revenue: number; orders: number }>;
  peakLabel: string;
  peakRevenue: number;
  totalRevenue: number;
  totalOrders: number;
}

export async function getHourlySalesReport(period: Period, customStart?: Date, customEnd?: Date): Promise<HourlySalesReport> {
  const [from, to] = getDateRange(period, customStart, customEnd);

  const orders = await database.get<Order>('orders')
    .query(
      Q.where('status', Q.oneOf(['paid', 'closed'])),
      Q.where('opened_at', Q.gte(from.getTime())),
      Q.where('opened_at', Q.lte(to.getTime()))
    ).fetch();

  const isHourly = period === 'today';
  const groupMap: Record<string, { revenue: number; orders: number }> = {};

  for (const o of orders) {
    const d = new Date(o.openedAt);
    const key = isHourly
      ? `${String(d.getHours()).padStart(2, '0')}:00`
      : d.toISOString().split('T')[0];
    if (!groupMap[key]) groupMap[key] = { revenue: 0, orders: 0 };
    groupMap[key].revenue += o.totalAmount;
    groupMap[key].orders += 1;
  }

  const hourlyData = Object.entries(groupMap)
    .map(([label, d]) => ({ label, ...d }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const peak = hourlyData.reduce((best, h) => h.revenue > (best?.revenue ?? -1) ? h : best, hourlyData[0] ?? null);
  const totalRevenue = orders.reduce((s, o) => s + o.totalAmount, 0);

  return {
    period: `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`,
    isHourly, hourlyData,
    peakLabel: peak?.label ?? '—',
    peakRevenue: peak?.revenue ?? 0,
    totalRevenue, totalOrders: orders.length,
  };
}
