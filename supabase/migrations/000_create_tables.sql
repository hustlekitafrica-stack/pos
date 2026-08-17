-- ============================================================================
-- Bar & Restaurant POS — Create All Tables
-- Run this FIRST before any other migrations.
-- ============================================================================

-- staff
CREATE TABLE IF NOT EXISTS staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  role text NOT NULL,
  pin text NOT NULL,
  phone text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- devices
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  device_fingerprint text UNIQUE NOT NULL,
  is_approved boolean DEFAULT false,
  registered_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- categories
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  prep_station text NOT NULL CHECK (prep_station IN ('bar', 'kitchen')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- products
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category_id uuid REFERENCES categories(id),
  price integer NOT NULL DEFAULT 0,
  cost_price integer NOT NULL DEFAULT 0,
  stock_qty integer NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'unit',
  low_stock_threshold integer NOT NULL DEFAULT 5,
  low_stock_alert_sent boolean DEFAULT false,
  is_out_of_stock boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- stock_adjustments
CREATE TABLE IF NOT EXISTS stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid REFERENCES products(id),
  adjusted_by uuid REFERENCES staff(id),
  change_qty integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- restaurant_tables
CREATE TABLE IF NOT EXISTS restaurant_tables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'open', 'awaiting_payment')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- customers (credit customers — admin-managed)
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text,
  credit_limit integer NOT NULL DEFAULT 0,
  is_active boolean DEFAULT true,
  notes text,
  created_by uuid REFERENCES staff(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- shifts
CREATE TABLE IF NOT EXISTS shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid REFERENCES staff(id),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  opening_cash integer NOT NULL DEFAULT 0,
  closing_cash_expected integer,
  closing_cash_actual integer,
  variance integer,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- orders
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_id uuid REFERENCES restaurant_tables(id),
  staff_id uuid REFERENCES staff(id),
  shift_id uuid REFERENCES shifts(id),
  device_id uuid REFERENCES devices(id),
  customer_id uuid REFERENCES customers(id),
  is_credit boolean DEFAULT false,
  room_number text,
  status text NOT NULL DEFAULT 'open',
  opened_at timestamptz DEFAULT now(),
  closed_at timestamptz,
  discount_amount integer NOT NULL DEFAULT 0,
  discount_reason text,
  total_amount integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- order_items
CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id),
  product_id uuid REFERENCES products(id),
  qty integer NOT NULL DEFAULT 1,
  unit_price integer NOT NULL DEFAULT 0,
  notes text,
  status text NOT NULL DEFAULT 'pending',
  is_complimentary boolean DEFAULT false,
  comp_reason text,
  comp_authorized_by uuid REFERENCES staff(id),
  voided boolean DEFAULT false,
  void_reason text,
  voided_by uuid REFERENCES staff(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- payments
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id),
  method text NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  mpesa_ref text,
  paid_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- refunds
CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid REFERENCES payments(id),
  amount integer NOT NULL DEFAULT 0,
  reason text NOT NULL,
  authorized_by uuid REFERENCES staff(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- credit_transactions
CREATE TABLE IF NOT EXISTS credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id),
  order_id uuid REFERENCES orders(id),
  type text NOT NULL CHECK (type IN ('credit_sale', 'repayment')),
  amount integer NOT NULL DEFAULT 0,
  payment_method text,
  mpesa_ref text,
  notes text,
  recorded_by uuid REFERENCES staff(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- expense_categories
CREATE TABLE IF NOT EXISTS expense_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- expenses
CREATE TABLE IF NOT EXISTS expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid REFERENCES expense_categories(id),
  description text NOT NULL,
  amount integer NOT NULL DEFAULT 0,
  paid_by uuid REFERENCES staff(id),
  logged_by uuid REFERENCES staff(id),
  date date NOT NULL,
  receipt_photo_url text,
  source text NOT NULL DEFAULT 'manual',
  vendor_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- audit_log
CREATE TABLE IF NOT EXISTS audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  staff_id uuid REFERENCES staff(id),
  device_id uuid REFERENCES devices(id),
  details jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
