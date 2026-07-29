import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { formatKES, fromCents } from '@/utils/currency';
import type { SalesReport, ExpenseReport, ShiftReport, DebtorEntry, LowStockItem } from './aggregate';

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
