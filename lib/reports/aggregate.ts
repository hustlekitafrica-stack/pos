import { Q } from '@nozbe/watermelondb';
import { database } from '../db';
import { Order, OrderItem, Payment, Expense, Shift, Customer, CreditTransaction, Product, Category } from '../db/models';

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
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export type Period = 'today' | 'week' | 'month' | 'custom';

function getDateRange(period: Period, customStart?: Date, customEnd?: Date): [Date, Date] {
  const now = new Date();
  switch (period) {
    case 'today':
      return [startOfDay(now), endOfDay(now)];
    case 'week':
      return [startOfWeek(now), endOfDay(now)];
    case 'month':
      return [startOfMonth(now), endOfDay(now)];
    case 'custom':
      return [customStart || startOfDay(now), customEnd || endOfDay(now)];
  }
}

// ─── Sales Report ───────────────────────────────────────────────────────────

export interface SalesReport {
  period: string;
  totalRevenue: number;
  totalOrders: number;
  avgOrderValue: number;
  paymentBreakdown: Record<string, number>;
  categoryBreakdown: Array<{ name: string; revenue: number; qty: number }>;
  dailyTotals: Array<{ date: string; revenue: number; orders: number }>;
}

export async function getSalesReport(period: Period, customStart?: Date, customEnd?: Date): Promise<SalesReport> {
  const [from, to] = getDateRange(period, customStart, customEnd);

  const orders = await database.get<Order>('orders')
    .query(
      Q.where('status', Q.oneOf(['paid', 'closed'])),
      Q.where('opened_at', Q.gte(from.getTime())),
      Q.where('opened_at', Q.lte(to.getTime()))
    )
    .fetch();

  const orderIds = orders.map((o) => o.id);
  let payments: Payment[] = [];
  if (orderIds.length > 0) {
    payments = await database.get<Payment>('payments')
      .query(Q.where('order_id', Q.oneOf(orderIds)))
      .fetch();
  }

  const totalRevenue = orders.reduce((s, o) => s + o.totalAmount, 0);
  const totalOrders = orders.length;
  const avgOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  // Payment method breakdown
  const paymentBreakdown: Record<string, number> = {};
  for (const p of payments) {
    paymentBreakdown[p.method] = (paymentBreakdown[p.method] || 0) + p.amount;
  }

  // Category breakdown
  const catMap: Record<string, { name: string; revenue: number; qty: number }> = {};
  if (orderIds.length > 0) {
    const items = await database.get<OrderItem>('order_items')
      .query(Q.where('order_id', Q.oneOf(orderIds)), Q.where('voided', false))
      .fetch();

    const cats = await database.get<Category>('categories').query().fetch();
    const catNames: Record<string, string> = {};
    for (const c of cats) catNames[c.id] = c.name;

    const products = await database.get<Product>('products').query().fetch();
    const prodCatMap: Record<string, string> = {};
    for (const p of products) prodCatMap[p.id] = p.categoryId;

    for (const item of items) {
      const catId = prodCatMap[item.productId] || 'unknown';
      const catName = catNames[catId] || 'Other';
      if (!catMap[catId]) catMap[catId] = { name: catName, revenue: 0, qty: 0 };
      catMap[catId].revenue += item.unitPrice * item.qty;
      catMap[catId].qty += item.qty;
    }
  }

  // Daily totals
  const dailyMap: Record<string, { revenue: number; orders: number }> = {};
  for (const o of orders) {
    const dateKey = new Date(o.openedAt).toISOString().split('T')[0];
    if (!dailyMap[dateKey]) dailyMap[dateKey] = { revenue: 0, orders: 0 };
    dailyMap[dateKey].revenue += o.totalAmount;
    dailyMap[dateKey].orders += 1;
  }

  const dailyTotals = Object.entries(dailyMap)
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    period: `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`,
    totalRevenue,
    totalOrders,
    avgOrderValue,
    paymentBreakdown,
    categoryBreakdown: Object.values(catMap).sort((a, b) => b.revenue - a.revenue),
    dailyTotals,
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
    .query(
      Q.where('date', Q.gte(fromStr)),
      Q.where('date', Q.lte(toStr))
    )
    .fetch();

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

    items.push({
      description: e.description,
      amount: e.amount,
      category: catName,
      date: e.expenseDate,
      vendor: e.vendorName,
    });
  }

  return {
    period: `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`,
    totalExpenses,
    categoryBreakdown: Object.values(catMap).sort((a, b) => b.total - a.total),
    dailyTotals: Object.entries(dailyMap)
      .map(([date, total]) => ({ date, total }))
      .sort((a, b) => a.date.localeCompare(b.date)),
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

  let query = [
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
    const shiftOrders = await database.get<Order>('orders')
      .query(Q.where('shift_id', shift.id))
      .fetch();

    const paidOrders = shiftOrders.filter((o) => o.status === 'paid' || o.status === 'closed');
    const orderIds = paidOrders.map((o) => o.id);

    let payments: Payment[] = [];
    if (orderIds.length > 0) {
      payments = await database.get<Payment>('payments')
        .query(Q.where('order_id', Q.oneOf(orderIds)))
        .fetch();
    }

    const paymentBreakdown: Record<string, number> = {};
    for (const p of payments) {
      paymentBreakdown[p.method] = (paymentBreakdown[p.method] || 0) + p.amount;
    }

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
}

export async function getDebtorsReport(): Promise<DebtorEntry[]> {
  const customers = await database.get<Customer>('customers')
    .query(Q.where('is_active', true))
    .fetch();

  const entries: DebtorEntry[] = [];

  for (const cust of customers) {
    const txns = await database.get<CreditTransaction>('credit_transactions')
      .query(Q.where('customer_id', cust.id))
      .fetch();

    let totalCharged = 0;
    let totalRepaid = 0;
    let lastActivity: Date | null = null;

    for (const t of txns) {
      if (t.type === 'credit_sale') totalCharged += t.amount;
      else totalRepaid += t.amount;
      if (!lastActivity || t.createdAt > lastActivity) lastActivity = t.createdAt;
    }

    const balance = totalCharged - totalRepaid;
    if (balance > 0 || txns.length > 0) {
      entries.push({
        customerId: cust.id,
        name: cust.name,
        phone: cust.phone,
        creditLimit: cust.creditLimit,
        totalCharged,
        totalRepaid,
        balance,
        lastActivity,
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
  stockQty: number;
  threshold: number;
  unit: string;
}

export async function getLowStockItems(): Promise<LowStockItem[]> {
  const products = await database.get<Product>('products')
    .query(Q.where('is_active', true))
    .fetch();

  const cats = await database.get<Category>('categories').query().fetch();
  const catNames: Record<string, string> = {};
  for (const c of cats) catNames[c.id] = c.name;

  return products
    .filter((p) => p.stockQty <= p.lowStockThreshold)
    .map((p) => ({
      productId: p.id,
      name: p.name,
      category: catNames[p.categoryId] || '',
      stockQty: p.stockQty,
      threshold: p.lowStockThreshold,
      unit: p.unit,
    }))
    .sort((a, b) => a.stockQty - b.stockQty);
}
