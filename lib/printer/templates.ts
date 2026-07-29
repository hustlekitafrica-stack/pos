import { OrderItem, Product } from '@/types';
import { formatKES } from '@/utils/currency';
import { formatDateTime } from '@/utils/dateHelpers';

interface ReceiptData {
  orderNumber: string;
  tableName: string;
  staffName: string;
  items: Array<{ name: string; qty: number; unitPrice: number; subtotal: number }>;
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: string;
  mpesaRef?: string;
  roomNumber?: string;
  timestamp: string;
}

/**
 * Generate ESC/POS commands for a customer receipt.
 * Returns a string of ESC/POS formatted text.
 */
export function buildCustomerReceipt(data: ReceiptData): string {
  const lines: string[] = [];

  lines.push('\x1b\x61\x01'); // center align
  lines.push('BAR POS\n');
  lines.push('================================\n');
  lines.push('\x1b\x61\x00'); // left align
  lines.push(`Table: ${data.tableName}\n`);
  lines.push(`Staff: ${data.staffName}\n`);
  if (data.roomNumber) {
    lines.push(`Room: ${data.roomNumber}\n`);
  }
  lines.push(`Date: ${formatDateTime(data.timestamp)}\n`);
  lines.push('--------------------------------\n');

  for (const item of data.items) {
    lines.push(`${item.qty}x ${item.name}\n`);
    lines.push(`   ${formatKES(item.unitPrice)} x ${item.qty} = ${formatKES(item.subtotal)}\n`);
  }

  lines.push('--------------------------------\n');
  if (data.discount > 0) {
    lines.push(`Discount: -${formatKES(data.discount)}\n`);
  }
  lines.push(`TOTAL: ${formatKES(data.total)}\n`);
  lines.push(`Paid: ${data.paymentMethod}\n`);
  if (data.mpesaRef) {
    lines.push(`M-Pesa Ref: ${data.mpesaRef}\n`);
  }
  lines.push('================================\n');
  lines.push('\x1b\x61\x01'); // center
  lines.push('Thank you!\n');
  lines.push('\n\n\n'); // feed paper

  return lines.join('');
}

/**
 * Generate ESC/POS commands for a kitchen/bar order slip.
 */
export function buildOrderSlip(
  tableName: string,
  items: Array<{ name: string; qty: number; notes?: string }>,
  station: 'bar' | 'kitchen',
  roomNumber?: string
): string {
  const lines: string[] = [];

  lines.push('\x1b\x61\x01'); // center
  lines.push(`** ${station.toUpperCase()} ORDER **\n`);
  lines.push('================================\n');
  lines.push('\x1b\x61\x00'); // left
  lines.push(`Table: ${tableName}\n`);
  if (roomNumber) {
    lines.push(`Room: ${roomNumber}\n`);
  }
  lines.push(`Time: ${formatDateTime(new Date().toISOString())}\n`);
  lines.push('--------------------------------\n');

  for (const item of items) {
    lines.push(`${item.qty}x ${item.name}\n`);
    if (item.notes) {
      lines.push(`   >> ${item.notes}\n`);
    }
  }

  lines.push('================================\n');
  lines.push('\n\n\n');

  return lines.join('');
}
