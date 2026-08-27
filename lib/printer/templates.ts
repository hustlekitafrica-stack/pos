import { formatKES } from '@/utils/currency';
import { formatDateTime } from '@/utils/dateHelpers';

// Standard 58 mm paper = 32 printable columns.
// All layout arithmetic is based on this width.
const W = 32;

function center(text: string): string {
  const t = text.substring(0, W);
  const pad = Math.max(0, Math.floor((W - t.length) / 2));
  return ' '.repeat(pad) + t;
}

function rule(char = '-'): string {
  return char.repeat(W);
}

/** Right-align `value` within a `width`-char field; `label` fills the left. */
function labelValue(label: string, value: string): string {
  const space = W - label.length - value.length;
  return label + (space > 0 ? ' '.repeat(space) : ' ') + value;
}

/** Build one item line: "2x Name           KES 1,400" */
function itemLine(qty: number, name: string, amount: number | null): string {
  const price = amount === null ? 'FREE' : formatKES(amount);
  const prefix = `${qty}x `;
  const maxName = W - prefix.length - price.length - 1;
  const truncName = name.substring(0, Math.max(1, maxName));
  const gap = W - prefix.length - truncName.length - price.length;
  return `${prefix}${truncName}${' '.repeat(Math.max(1, gap))}${price}`;
}

interface ReceiptData {
  orderNumber: string;
  tableName: string;
  staffName: string;
  clientName?: string;
  items: Array<{ name: string; qty: number; unitPrice: number; isComplimentary?: boolean }>;
  total: number;
  paymentMethod?: string;
  mpesaRef?: string;
  timestamp: string;
  // Venue / setup
  venueName: string;
  venuePhone?: string;
  venueAddress?: string;
  mpesaPaybill?: string;
}

/**
 * Generate ESC/POS bytes for a professional customer receipt.
 */
export function buildCustomerReceipt(data: ReceiptData): string {
  const lines: string[] = [];

  const push = (...parts: string[]) => lines.push(...parts);

  // ── Header ──────────────────────────────────────────────────────────────────
  push(
    '\x1b\x40',         // ESC @ — initialize printer
    '\x1b\x61\x01',     // center align
    '\x1b\x45\x01',     // bold on
    '\x1b\x21\x10',     // double height
    `${data.venueName}\n`,
    '\x1b\x21\x00',     // normal size
    '\x1b\x45\x00',     // bold off
  );

  if (data.venueAddress) push(`${center(data.venueAddress)}\n`);
  if (data.venuePhone)   push(`${center('Tel: ' + data.venuePhone)}\n`);

  push(
    `${rule('=')}\n`,
    '\x1b\x61\x00',     // left align
  );

  // ── Order meta ──────────────────────────────────────────────────────────────
  const dt  = new Date(data.timestamp);
  const date = dt.toLocaleDateString('en-GB');   // DD/MM/YYYY
  const time = dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

  push(`Server: ${data.staffName}\n`);

  // Date + time on same line, right-aligned
  const serverLine = `Table: ${data.tableName}`;
  const dateTime   = `${date} ${time}`;
  const gap = W - serverLine.length - dateTime.length;
  push(`${serverLine}${' '.repeat(Math.max(1, gap))}${dateTime}\n`);

  if (data.clientName) push(`Guest: ${data.clientName}\n`);
  push(`Order: #${data.orderNumber}\n`);

  push(`${rule('-')}\n`);

  // ── Items ────────────────────────────────────────────────────────────────────
  for (const item of data.items) {
    const amount = item.isComplimentary ? null : item.unitPrice * item.qty;
    push(`${itemLine(item.qty, item.name, amount)}\n`);
  }

  push(`${rule('-')}\n`);

  // ── Totals ───────────────────────────────────────────────────────────────────
  push(
    `${labelValue('Subtotal:', formatKES(data.total))}\n`,
    '\x1b\x45\x01',     // bold on
    `${labelValue('TOTAL:', formatKES(data.total))}\n`,
    '\x1b\x45\x00',     // bold off
    `${rule('=')}\n`,
  );

  // ── Payment / M-Pesa ─────────────────────────────────────────────────────────
  if (data.paymentMethod) push(`Paid via: ${data.paymentMethod}\n`);
  if (data.mpesaRef)      push(`M-Pesa Ref: ${data.mpesaRef}\n`);

  // ── M-Pesa Paybill block ─────────────────────────────────────────────────────
  if (data.mpesaPaybill) {
    push(
      '\x1b\x61\x01',   // center
      `M-Pesa Paybill: ${data.mpesaPaybill}\n`,
      `Account: ${data.tableName}\n`,
      '\x1b\x61\x00',   // left
    );
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  push(
    '\x1b\x61\x01',     // center
    '\n',
    'Thank you! Visit again.\n',
    '\n\n\n\n\n\n',     // 6 blank lines — feeds past the tear bar
  );

  return lines.join('');
}

/**
 * Generate ESC/POS commands for a kitchen/bar order slip.
 */
export function buildOrderSlip(
  tableName: string,
  items: Array<{ name: string; qty: number; notes?: string }>,
  station: 'bar' | 'kitchen',
  roomNumber?: string,
): string {
  const lines: string[] = [];

  lines.push('\x1b\x40');           // initialize
  lines.push('\x1b\x61\x01');       // center
  lines.push('\x1b\x45\x01');       // bold
  lines.push(`** ${station.toUpperCase()} ORDER **\n`);
  lines.push('\x1b\x45\x00');       // bold off
  lines.push(`${rule('=')}\n`);
  lines.push('\x1b\x61\x00');       // left
  lines.push(`Table: ${tableName}\n`);
  if (roomNumber) lines.push(`Room: ${roomNumber}\n`);
  lines.push(`Time: ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}\n`);
  lines.push(`${rule('-')}\n`);

  for (const item of items) {
    lines.push(`${item.qty}x ${item.name}\n`);
    if (item.notes) lines.push(`   >> ${item.notes}\n`);
  }

  lines.push(`${rule('=')}\n`);
  lines.push('\n\n\n\n');

  return lines.join('');
}
