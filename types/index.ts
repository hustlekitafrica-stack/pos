export type Role = 'admin' | 'manager' | 'stock_manager' | 'cashier' | 'bartender';

export type PrepStation = 'bar' | 'kitchen';

export type OrderStatus = 'open' | 'sent' | 'served' | 'paid' | 'closed' | 'voided';

export type OrderItemStatus = 'pending' | 'sent' | 'preparing' | 'served' | 'voided';

export type TableStatus = 'free' | 'open' | 'awaiting_payment';

export type PaymentMethod = 'cash' | 'mpesa' | 'card' | 'credit' | 'other';

export type ExpenseSource = 'scanned' | 'manual';

export type StockAdjustmentReason = 'restock' | 'wastage' | 'breakage' | 'correction';

export type CreditTransactionType = 'credit_sale' | 'repayment';

export interface Staff {
  id: string;
  name: string;
  role: Role;
  pin: string;
  phone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Device {
  id: string;
  name: string;
  device_fingerprint: string;
  is_approved: boolean;
  registered_at: string;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  prep_station: PrepStation;
  created_at: string;
  updated_at: string;
}

export interface Product {
  id: string;
  name: string;
  category_id: string;
  price: number;
  cost_price: number;
  stock_qty: number;
  unit: string;
  low_stock_threshold: number;
  low_stock_alert_sent: boolean;
  is_out_of_stock: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StockAdjustment {
  id: string;
  product_id: string;
  adjusted_by: string;
  change_qty: number;
  reason: StockAdjustmentReason;
  created_at: string;
  updated_at: string;
}

export interface RestaurantTable {
  id: string;
  name: string;
  status: TableStatus;
  created_at: string;
  updated_at: string;
}

export interface Order {
  id: string;
  table_id: string;
  staff_id: string;
  shift_id: string;
  device_id: string;
  customer_id: string | null;
  is_credit: boolean;
  room_number: string | null;
  status: OrderStatus;
  opened_at: string;
  closed_at: string | null;
  discount_amount: number;
  discount_reason: string | null;
  total_amount: number;
  created_at: string;
  updated_at: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  qty: number;
  unit_price: number;
  notes: string | null;
  status: OrderItemStatus;
  is_complimentary: boolean;
  comp_reason: string | null;
  comp_authorized_by: string | null;
  voided: boolean;
  void_reason: string | null;
  voided_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  order_id: string;
  method: PaymentMethod;
  amount: number;
  mpesa_ref: string | null;
  paid_at: string;
  created_at: string;
  updated_at: string;
}

export interface Refund {
  id: string;
  payment_id: string;
  amount: number;
  reason: string;
  authorized_by: string;
  created_at: string;
  updated_at: string;
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  credit_limit: number;
  is_active: boolean;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreditTransaction {
  id: string;
  customer_id: string;
  order_id: string | null;
  type: CreditTransactionType;
  amount: number;
  payment_method: PaymentMethod | null;
  mpesa_ref: string | null;
  notes: string | null;
  recorded_by: string;
  created_at: string;
  updated_at: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface Expense {
  id: string;
  category_id: string;
  description: string;
  amount: number;
  paid_by: string;
  logged_by: string;
  date: string;
  receipt_photo_url: string | null;
  source: ExpenseSource;
  vendor_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Shift {
  id: string;
  staff_id: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash_expected: number | null;
  closing_cash_actual: number | null;
  variance: number | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  staff_id: string;
  device_id: string;
  details: Record<string, unknown>;
  created_at: string;
}
