import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { formatKES, fromCents } from '@/utils/currency';
import type {
  SalesReport, ExpenseReport, ShiftReport, DebtorEntry, LowStockItem,
  ProfitLossReport, ProductPerformanceReport, CategoryAnalysisReport,
  PaymentAnalysisReport, StaffPerformanceReport, DiscountsVoidsReport,
  StockMovementReport, HourlySalesReport,
} from './aggregate';

// ─── CSV Export ─────────────────────────────────────────────────────────────

function toCsvRow(values: (string | number)[]): string {
  return values.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
}

export async function exportSalesCSV(report: SalesReport): Promise<void> {
  const rows: string[] = [];
  rows.push(toCsvRow(['Sales Report', report.period]));
  rows.push('');
  rows.push(toCsvRow(['Total Revenue', fromCents(report.totalRevenue)]));
  rows.push(toCsvRow(['Total Orders', report.totalOrders]));
  rows.push(toCsvRow(['Avg Order Value', fromCents(report.avgOrderValue)]));
  rows.push('');

  rows.push(toCsvRow(['Payment Method', 'Amount (KES)']));
  for (const [method, amount] of Object.entries(report.paymentBreakdown)) {
    rows.push(toCsvRow([method, fromCents(amount)]));
  }
  rows.push('');

  rows.push(toCsvRow(['Category', 'Revenue (KES)', 'Qty Sold']));
  for (const cat of report.categoryBreakdown) {
    rows.push(toCsvRow([cat.name, fromCents(cat.revenue), cat.qty]));
  }
  rows.push('');

  rows.push(toCsvRow(['Date', 'Revenue (KES)', 'Orders']));
  for (const d of report.dailyTotals) {
    rows.push(toCsvRow([d.date, fromCents(d.revenue), d.orders]));
  }

  await shareCSV(rows.join('\n'), `sales-report-${Date.now()}.csv`);
}

export async function exportExpenseCSV(report: ExpenseReport): Promise<void> {
  const rows: string[] = [];
  rows.push(toCsvRow(['Expense Report', report.period]));
  rows.push(toCsvRow(['Total Expenses', fromCents(report.totalExpenses)]));
  rows.push('');

  rows.push(toCsvRow(['Category', 'Total (KES)', 'Count']));
  for (const cat of report.categoryBreakdown) {
    rows.push(toCsvRow([cat.name, fromCents(cat.total), cat.count]));
  }
  rows.push('');

  rows.push(toCsvRow(['Date', 'Description', 'Amount (KES)', 'Category', 'Vendor']));
  for (const item of report.items) {
    rows.push(toCsvRow([item.date, item.description, fromCents(item.amount), item.category, item.vendor || '']));
  }

  await shareCSV(rows.join('\n'), `expense-report-${Date.now()}.csv`);
}

export async function exportShiftCSV(reports: ShiftReport[]): Promise<void> {
  const rows: string[] = [];
  rows.push(toCsvRow(['Staff', 'Opened', 'Closed', 'Orders', 'Revenue (KES)', 'Opening Cash', 'Expected Cash', 'Actual Cash', 'Variance']));
  for (const r of reports) {
    rows.push(toCsvRow([
      r.staffName,
      r.openedAt,
      r.closedAt || 'Open',
      r.totalOrders,
      fromCents(r.totalRevenue),
      fromCents(r.openingCash),
      fromCents(r.closingCashExpected),
      fromCents(r.closingCashActual),
      fromCents(r.variance),
    ]));
  }

  await shareCSV(rows.join('\n'), `shift-report-${Date.now()}.csv`);
}

export async function exportDebtorsCSV(entries: DebtorEntry[]): Promise<void> {
  const rows: string[] = [];
  rows.push(toCsvRow(['Customer', 'Phone', 'Credit Limit', 'Total Charged', 'Total Repaid', 'Balance', 'Last Activity']));
  for (const e of entries) {
    rows.push(toCsvRow([
      e.name,
      e.phone || '',
      fromCents(e.creditLimit),
      fromCents(e.totalCharged),
      fromCents(e.totalRepaid),
      fromCents(e.balance),
      e.lastActivity ? e.lastActivity.toLocaleDateString() : 'Never',
    ]));
  }

  await shareCSV(rows.join('\n'), `debtors-report-${Date.now()}.csv`);
}

export async function exportLowStockCSV(items: LowStockItem[]): Promise<void> {
  const rows: string[] = [];
  rows.push(toCsvRow(['Product', 'Category', 'Stock Qty', 'Threshold', 'Unit']));
  for (const i of items) {
    rows.push(toCsvRow([i.name, i.category, i.stockQty, i.threshold, i.unit]));
  }

  await shareCSV(rows.join('\n'), `low-stock-${Date.now()}.csv`);
}

async function shareCSV(content: string, filename: string): Promise<void> {
  const fileUri = `${FileSystem.documentDirectory}${filename}`;
  await FileSystem.writeAsStringAsync(fileUri, content, { encoding: FileSystem.EncodingType.UTF8 });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(fileUri, {
      mimeType: 'text/csv',
      dialogTitle: `Export ${filename}`,
      UTI: 'public.comma-separated-values-text',
    });
  }
}

// ─── PDF via HTML ───────────────────────────────────────────────────────────

export async function exportSalesPDF(report: SalesReport): Promise<void> {
  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  h2 { font-size: 14px; margin-top: 16px; color: #333; }
  .summary { display: flex; gap: 20px; margin: 12px 0; }
  .stat { background: #f3f4f6; padding: 10px; border-radius: 8px; text-align: center; }
  .stat .value { font-size: 20px; font-weight: bold; }
  .stat .label { color: #666; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  th { background: #1a1a2e; color: white; }
  tr:nth-child(even) { background: #f9fafb; }
</style></head><body>
  <h1>Sales Report</h1>
  <p>${report.period}</p>
  <div class="summary">
    <div class="stat"><div class="value">${formatKES(report.totalRevenue)}</div><div class="label">Revenue</div></div>
    <div class="stat"><div class="value">${report.totalOrders}</div><div class="label">Orders</div></div>
    <div class="stat"><div class="value">${formatKES(report.avgOrderValue)}</div><div class="label">Avg Order</div></div>
  </div>
  <h2>Payment Methods</h2>
  <table><tr><th>Method</th><th>Amount</th></tr>
    ${Object.entries(report.paymentBreakdown).map(([m, a]) => `<tr><td>${m}</td><td>${formatKES(a)}</td></tr>`).join('')}
  </table>
  <h2>By Category</h2>
  <table><tr><th>Category</th><th>Revenue</th><th>Qty</th></tr>
    ${report.categoryBreakdown.map((c) => `<tr><td>${c.name}</td><td>${formatKES(c.revenue)}</td><td>${c.qty}</td></tr>`).join('')}
  </table>
  <h2>Daily Breakdown</h2>
  <table><tr><th>Date</th><th>Revenue</th><th>Orders</th></tr>
    ${report.dailyTotals.map((d) => `<tr><td>${d.date}</td><td>${formatKES(d.revenue)}</td><td>${d.orders}</td></tr>`).join('')}
  </table>
</body></html>`;

  await sharePDF(html, `sales-report-${Date.now()}`);
}

export async function exportExpensePDF(report: ExpenseReport): Promise<void> {
  const html = `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: Arial, sans-serif; padding: 20px; font-size: 12px; }
  h1 { font-size: 18px; }
  h2 { font-size: 14px; margin-top: 16px; color: #333; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; }
  th { background: #1a1a2e; color: white; }
  tr:nth-child(even) { background: #f9fafb; }
  .total { font-size: 20px; font-weight: bold; color: #dc2626; margin: 8px 0; }
</style></head><body>
  <h1>Expense Report</h1>
  <p>${report.period}</p>
  <div class="total">Total: ${formatKES(report.totalExpenses)}</div>
  <h2>By Category</h2>
  <table><tr><th>Category</th><th>Total</th><th>Count</th></tr>
    ${report.categoryBreakdown.map((c) => `<tr><td>${c.name}</td><td>${formatKES(c.total)}</td><td>${c.count}</td></tr>`).join('')}
  </table>
  <h2>All Expenses</h2>
  <table><tr><th>Date</th><th>Description</th><th>Category</th><th>Vendor</th><th>Amount</th></tr>
    ${report.items.map((i) => `<tr><td>${i.date}</td><td>${i.description}</td><td>${i.category}</td><td>${i.vendor || '-'}</td><td>${formatKES(i.amount)}</td></tr>`).join('')}
  </table>
</body></html>`;

  await sharePDF(html, `expense-report-${Date.now()}`);
}

async function sharePDF(html: string, filename: string): Promise<void> {
  try {
    const { printToFileAsync } = require('expo-print');
    const { uri } = await printToFileAsync({ html, base64: false });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: 'application/pdf',
        dialogTitle: `Export ${filename}`,
        UTI: 'com.adobe.pdf',
      });
    }
  } catch (e) {
    // Fallback: share as HTML
    const htmlUri = `${FileSystem.documentDirectory}${filename}.html`;
    await FileSystem.writeAsStringAsync(htmlUri, html);
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(htmlUri, { mimeType: 'text/html' });
    }
  }
}

// ─── New report CSV exports ──────────────────────────────────────────────────

export async function exportProfitLossCSV(report: ProfitLossReport): Promise<void> {
  const rows: string[] = [];
  rows.push(toCsvRow(['Profit & Loss Statement', report.period]));
  rows.push('');
  rows.push(toCsvRow(['', 'Amount (KES)']));
  rows.push(toCsvRow(['Gross Revenue', fromCents(report.grossRevenue)]));
  rows.push(toCsvRow(['  Less: Discounts', fromCents(report.totalDiscounts)]));
  rows.push(toCsvRow(['  Less: Refunds', fromCents(report.totalRefunds)]));
  rows.push(toCsvRow(['  Less: Complimentary', fromCents(report.totalComplimentary)]));
  rows.push(toCsvRow(['Net Revenue', fromCents(report.netRevenue)]));
  rows.push(toCsvRow(['Cost of Goods Sold (COGS)', fromCents(report.cogs)]));
  rows.push(toCsvRow([`Gross Profit (${report.grossMargin}% margin)`, fromCents(report.grossProfit)]));
  rows.push('');
  rows.push(toCsvRow(['Operating Expenses', '']));
  for (const e of report.expenseLines) {
    rows.push(toCsvRow([`  ${e.category} (${e.count} entries)`, fromCents(e.amount)]));
  }
  rows.push(toCsvRow(['Total Expenses', fromCents(report.totalExpenses)]));
  rows.push('');
  rows.push(toCsvRow([`Net Profit (${report.netMargin}% margin)`, fromCents(report.netProfit)]));
  await shareCSV(rows.join('\n'), `profit-loss-${Date.now()}.csv`);
}

export async function exportProductPerformanceCSV(report: ProductPerformanceReport): Promise<void> {
  const rows: string[] = [];
  rows.push(toCsvRow(['Product Performance', report.period]));
  rows.push('');
  rows.push(toCsvRow(['Product', 'Category', 'Station', 'Qty Sold', 'Revenue (KES)', 'COGS (KES)', 'Gross Profit (KES)', 'Margin %', '% of Revenue']));
  for (const p of report.products) {
    rows.push(toCsvRow([p.name, p.category, p.station, p.qtySold, fromCents(p.revenue), fromCents(p.cogs), fromCents(p.grossProfit), `${p.margin}%`, `${p.pctOfRevenue}%`]));
  }
  rows.push('');
  rows.push(toCsvRow(['TOTAL', '', '', '', fromCents(report.totalRevenue), fromCents(report.totalCogs), fromCents(report.totalGrossProfit), '']));
  await shareCSV(rows.join('\n'), `product-performance-${Date.now()}.csv`);
}

export async function exportCategoryAnalysisCSV(report: CategoryAnalysisReport): Promise<void> {
  const rows: string[] = [];
  rows.push(toCsvRow(['Category Analysis', report.period]));
  rows.push('');
  rows.push(toCsvRow(['Category', 'Station', 'Revenue (KES)', 'Qty Sold', 'COGS (KES)', 'Gross Profit (KES)', 'Margin %', '% of Total']));
  for (const c of report.categories) {
    rows.push(toCsvRow([c.name, c.station, fromCents(c.revenue), c.qty, fromCents(c.cogs), fromCents(c.grossProfit), `${c.margin}%`, `${c.pctOfTotal}%`]));
  }
  await shareCSV(rows.join('\n'), `category-analysis-${Date.now()}.csv`);
}

export async function exportPaymentAnalysisCSV(report: PaymentAnalysisReport): Promise<void> {
  const rows: string[] = [];
  rows.push(toCsvRow(['Payment Analysis', report.period]));
  rows.push(toCsvRow(['Total Collected', fromCents(report.totalCollected)]));
  rows.push(toCsvRow(['Total Refunded', fromCents(report.totalRefunded)]));
  rows.push(toCsvRow(['Net Received', fromCents(report.netReceived)]));
  rows.push('');
  rows.push(toCsvRow(['Method', 'Amount (KES)', 'Transactions', '% of Total', 'Refunded (KES)']));
  for (const m of report.methods) {
    rows.push(toCsvRow([m.method, fromCents(m.amount), m.count, `${m.pct}%`, fromCents(m.refunded)]));
  }
  rows.push('');
  rows.push(toCsvRow(['Period', 'Revenue (KES)', 'Orders']));
  for (const h of report.hourlyTotals) {
    rows.push(toCsvRow([h.label, fromCents(h.revenue), h.orders]));
  }
  await shareCSV(rows.join('\n'), `payment-analysis-${Date.now()}.csv`);
}

export async function exportStaffPerformanceCSV(report: StaffPerformanceReport): Promise<void> {
  const rows: string[] = [];
  rows.push(toCsvRow(['Staff Performance', report.period]));
  rows.push('');
  rows.push(toCsvRow(['Staff', 'Role', 'Orders', 'Revenue (KES)', 'Avg Order (KES)', 'Discounts Given (KES)', 'Comps Given (KES)', 'Shifts']));
  for (const s of report.staff) {
    rows.push(toCsvRow([s.name, s.role, s.orders, fromCents(s.revenue), fromCents(s.avgOrder), fromCents(s.discountsGiven), fromCents(s.compsGiven), s.shifts]));
  }
  await shareCSV(rows.join('\n'), `staff-performance-${Date.now()}.csv`);
}

export async function exportDiscountsVoidsCSV(report: DiscountsVoidsReport): Promise<void> {
  const rows: string[] = [];
  rows.push(toCsvRow(['Discounts, Voids & Comps', report.period]));
  rows.push('');
  rows.push(toCsvRow(['DISCOUNTS', '']));
  rows.push(toCsvRow(['Total Discount Value', fromCents(report.totalDiscountValue)]));
  rows.push(toCsvRow(['Discounted Orders', report.discountedOrders]));
  rows.push(toCsvRow(['Reason', 'Count', 'Amount (KES)']));
  for (const r of report.discountReasons) rows.push(toCsvRow([r.reason, r.count, fromCents(r.amount)]));
  rows.push('');
  rows.push(toCsvRow(['VOIDS', '']));
  rows.push(toCsvRow(['Total Void Value', fromCents(report.totalVoidValue)]));
  rows.push(toCsvRow(['Voided Items', report.voidedItemCount]));
  rows.push(toCsvRow(['Reason', 'Count', 'Value (KES)']));
  for (const r of report.voidReasons) rows.push(toCsvRow([r.reason, r.count, fromCents(r.value)]));
  rows.push('');
  rows.push(toCsvRow(['COMPLIMENTARY', '']));
  rows.push(toCsvRow(['Total Comp Value', fromCents(report.totalCompValue)]));
  rows.push(toCsvRow(['Comp Items', report.compItemCount]));
  rows.push(toCsvRow(['Reason', 'Count', 'Value (KES)']));
  for (const r of report.compReasons) rows.push(toCsvRow([r.reason, r.count, fromCents(r.value)]));
  await shareCSV(rows.join('\n'), `discounts-voids-${Date.now()}.csv`);
}

export async function exportStockMovementCSV(report: StockMovementReport): Promise<void> {
  const rows: string[] = [];
  rows.push(toCsvRow(['Stock Movement', report.period]));
  rows.push('');
  rows.push(toCsvRow(['Type', 'Count', 'Units']));
  rows.push(toCsvRow(['Restocks', report.restocks.count, report.restocks.totalUnits]));
  rows.push(toCsvRow(['Wastage', report.wastage.count, report.wastage.totalUnits]));
  rows.push(toCsvRow(['Breakage', report.breakage.count, report.breakage.totalUnits]));
  rows.push(toCsvRow(['Corrections', report.corrections.count, report.corrections.netUnits]));
  rows.push('');
  rows.push(toCsvRow(['Product', 'Reason', 'Change', 'By', 'Date']));
  for (const m of report.movements) {
    rows.push(toCsvRow([m.productName, m.reason, m.changeQty > 0 ? `+${m.changeQty}` : m.changeQty, m.adjustedBy, m.date]));
  }
  await shareCSV(rows.join('\n'), `stock-movement-${Date.now()}.csv`);
}

export async function exportHourlySalesCSV(report: HourlySalesReport): Promise<void> {
  const rows: string[] = [];
  rows.push(toCsvRow(['Hourly Sales', report.period]));
  rows.push(toCsvRow(['Peak Period', report.peakLabel]));
  rows.push('');
  rows.push(toCsvRow([report.isHourly ? 'Hour' : 'Date', 'Revenue (KES)', 'Orders']));
  for (const h of report.hourlyData) {
    rows.push(toCsvRow([h.label, fromCents(h.revenue), h.orders]));
  }
  await shareCSV(rows.join('\n'), `hourly-sales-${Date.now()}.csv`);
}

export async function exportProfitLossPDF(report: ProfitLossReport): Promise<void> {
  const fk = formatKES;
  const row = (label: string, value: string, bold = false, color = '#1e293b') =>
    `<tr><td style="padding:6px 8px;${bold ? 'font-weight:700;' : ''}">${label}</td><td style="padding:6px 8px;text-align:right;font-weight:700;color:${color}">${value}</td></tr>`;

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Arial,sans-serif;padding:24px;font-size:12px;color:#1e293b}
    h1{font-size:20px;margin-bottom:2px}
    .sub{color:#64748b;font-size:11px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;margin-bottom:16px}
    th{background:#1e1b4b;color:#fff;padding:8px;text-align:left;font-size:11px}
    tr:nth-child(even){background:#f8fafc}
    .divider{border-top:2px solid #1e1b4b}
    .profit{background:#f0fdf4} .loss{background:#fef2f2}
  </style></head><body>
  <h1>Profit & Loss Statement</h1>
  <div class="sub">${report.period} &nbsp;|&nbsp; ${report.orderCount} orders</div>
  <table>
    <tr><th>Item</th><th style="text-align:right">Amount (KES)</th></tr>
    ${row('Gross Revenue', fk(report.grossRevenue))}
    ${row('  Less: Discounts', `(${fk(report.totalDiscounts)})`)}
    ${row('  Less: Refunds', `(${fk(report.totalRefunds)})`)}
    ${row('  Less: Complimentary', `(${fk(report.totalComplimentary)})`)}
    ${row('Net Revenue', fk(report.netRevenue), true)}
    <tr class="divider"></tr>
    ${row('Cost of Goods Sold (COGS)', `(${fk(report.cogs)})`)}
    ${row(`Gross Profit — ${report.grossMargin}% margin`, fk(report.grossProfit), true, report.grossProfit >= 0 ? '#16a34a' : '#dc2626')}
    <tr class="divider"></tr>
    <tr><th colspan="2">Operating Expenses</th></tr>
    ${report.expenseLines.map((e) => row(`  ${e.category} (${e.count})`, `(${fk(e.amount)})`)).join('')}
    ${row('Total Expenses', `(${fk(report.totalExpenses)})`, true, '#dc2626')}
    <tr class="divider"></tr>
    ${row(`Net Profit — ${report.netMargin}% margin`, fk(report.netProfit), true, report.netProfit >= 0 ? '#16a34a' : '#dc2626')}
  </table>
  </body></html>`;
  await sharePDF(html, `profit-loss-${Date.now()}`);
}


