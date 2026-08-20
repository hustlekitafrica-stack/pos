-- ============================================================================
-- Migration 005: Full Schema Reset — Change all IDs from uuid → text
-- ============================================================================
-- Run THIS FILE ONLY in the Supabase SQL Editor (replaces 000–004).
-- https://supabase.com/dashboard/project/rusopielhzmdyskrrkaw/sql
--
-- WHY: WatermelonDB generates 16-char alphanumeric IDs (e.g. "xkad7h3nqy1w8b2z"),
-- NOT valid UUIDs. PostgreSQL's `uuid` type rejected every upsert with:
--   "invalid input syntax for type uuid"
-- Changing all ID/FK columns to `text` fixes this.
-- Tables are empty (nothing synced yet) so dropping and recreating is safe.
-- ============================================================================

-- ── 1. Drop all tables (CASCADE removes FKs + all existing RLS policies) ──

DROP TABLE IF EXISTS audit_log          CASCADE;
DROP TABLE IF EXISTS expenses            CASCADE;
DROP TABLE IF EXISTS expense_categories  CASCADE;
DROP TABLE IF EXISTS credit_transactions CASCADE;
DROP TABLE IF EXISTS refunds             CASCADE;
DROP TABLE IF EXISTS payments            CASCADE;
DROP TABLE IF EXISTS order_items         CASCADE;
DROP TABLE IF EXISTS orders              CASCADE;
DROP TABLE IF EXISTS stock_adjustments   CASCADE;
DROP TABLE IF EXISTS products            CASCADE;
DROP TABLE IF EXISTS categories          CASCADE;
DROP TABLE IF EXISTS restaurant_tables   CASCADE;
DROP TABLE IF EXISTS customers           CASCADE;
DROP TABLE IF EXISTS shifts              CASCADE;
DROP TABLE IF EXISTS devices             CASCADE;
DROP TABLE IF EXISTS staff               CASCADE;

-- ── 2. Recreate all tables with text IDs ──────────────────────────────────

CREATE TABLE staff (
  id               text PRIMARY KEY,
  name             text NOT NULL,
  role             text NOT NULL,
  pin              text NOT NULL,
  phone            text,
  is_active        boolean DEFAULT true,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TABLE devices (
  id                   text PRIMARY KEY,
  name                 text NOT NULL,
  device_fingerprint   text UNIQUE NOT NULL,
  is_approved          boolean DEFAULT false,
  registered_at        timestamptz DEFAULT now(),
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE TABLE categories (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  prep_station  text NOT NULL CHECK (prep_station IN ('bar', 'kitchen')),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE TABLE products (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  category_id           text REFERENCES categories(id),
  price                 integer NOT NULL DEFAULT 0,
  cost_price            integer NOT NULL DEFAULT 0,
  stock_qty             integer NOT NULL DEFAULT 0,
  unit                  text NOT NULL DEFAULT 'unit',
  low_stock_threshold   integer NOT NULL DEFAULT 5,
  low_stock_alert_sent  boolean DEFAULT false,
  is_out_of_stock       boolean DEFAULT false,
  is_active             boolean DEFAULT true,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE TABLE stock_adjustments (
  id           text PRIMARY KEY,
  product_id   text REFERENCES products(id),
  adjusted_by  text REFERENCES staff(id),
  change_qty   integer NOT NULL,
  reason       text NOT NULL,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

CREATE TABLE restaurant_tables (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'free' CHECK (status IN ('free', 'open', 'awaiting_payment')),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE customers (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  phone         text,
  credit_limit  integer NOT NULL DEFAULT 0,
  is_active     boolean DEFAULT true,
  notes         text,
  created_by    text REFERENCES staff(id),
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- shifts — includes WatermelonDB migration v2 columns (status, approved_by, approved_at, closure_notes)
CREATE TABLE shifts (
  id                    text PRIMARY KEY,
  staff_id              text REFERENCES staff(id),
  opened_at             timestamptz NOT NULL DEFAULT now(),
  closed_at             timestamptz,
  opening_cash          integer NOT NULL DEFAULT 0,
  closing_cash_expected integer,
  closing_cash_actual   integer,
  variance              integer,
  status                text NOT NULL DEFAULT 'open',
  approved_by           text REFERENCES staff(id),
  approved_at           timestamptz,
  closure_notes         text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE TABLE orders (
  id               text PRIMARY KEY,
  table_id         text REFERENCES restaurant_tables(id),
  staff_id         text REFERENCES staff(id),
  shift_id         text REFERENCES shifts(id),
  device_id        text REFERENCES devices(id),
  customer_id      text REFERENCES customers(id),
  is_credit        boolean DEFAULT false,
  room_number      text,
  status           text NOT NULL DEFAULT 'open',
  opened_at        timestamptz DEFAULT now(),
  closed_at        timestamptz,
  discount_amount  integer NOT NULL DEFAULT 0,
  discount_reason  text,
  total_amount     integer NOT NULL DEFAULT 0,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE TABLE order_items (
  id                   text PRIMARY KEY,
  order_id             text REFERENCES orders(id),
  product_id           text REFERENCES products(id),
  qty                  integer NOT NULL DEFAULT 1,
  unit_price           integer NOT NULL DEFAULT 0,
  notes                text,
  status               text NOT NULL DEFAULT 'pending',
  is_complimentary     boolean DEFAULT false,
  comp_reason          text,
  comp_authorized_by   text REFERENCES staff(id),
  voided               boolean DEFAULT false,
  void_reason          text,
  voided_by            text REFERENCES staff(id),
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now()
);

CREATE TABLE payments (
  id          text PRIMARY KEY,
  order_id    text REFERENCES orders(id),
  method      text NOT NULL,
  amount      integer NOT NULL DEFAULT 0,
  mpesa_ref   text,
  paid_at     timestamptz DEFAULT now(),
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE refunds (
  id             text PRIMARY KEY,
  payment_id     text REFERENCES payments(id),
  amount         integer NOT NULL DEFAULT 0,
  reason         text NOT NULL,
  authorized_by  text REFERENCES staff(id),
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

CREATE TABLE credit_transactions (
  id              text PRIMARY KEY,
  customer_id     text REFERENCES customers(id),
  order_id        text REFERENCES orders(id),
  type            text NOT NULL CHECK (type IN ('credit_sale', 'repayment')),
  amount          integer NOT NULL DEFAULT 0,
  payment_method  text,
  mpesa_ref       text,
  notes           text,
  recorded_by     text REFERENCES staff(id),
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE expense_categories (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now()
);

CREATE TABLE expenses (
  id                text PRIMARY KEY,
  category_id       text REFERENCES expense_categories(id),
  description       text NOT NULL,
  amount            integer NOT NULL DEFAULT 0,
  paid_by           text,
  logged_by         text REFERENCES staff(id),
  date              date NOT NULL,
  receipt_photo_url text,
  source            text NOT NULL DEFAULT 'manual',
  vendor_name       text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE TABLE audit_log (
  id           text PRIMARY KEY,
  action       text NOT NULL,
  entity_type  text NOT NULL,
  entity_id    text NOT NULL,
  staff_id     text REFERENCES staff(id),
  device_id    text REFERENCES devices(id),
  details      jsonb,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- ── 3. Enable Row Level Security ──────────────────────────────────────────

ALTER TABLE staff              ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories         ENABLE ROW LEVEL SECURITY;
ALTER TABLE products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_tables  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds            ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers          ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses           ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log          ENABLE ROW LEVEL SECURITY;

-- ── 4. Helper function for JWT role (public schema — auth schema is restricted) ─

CREATE OR REPLACE FUNCTION public.pos_user_role()
RETURNS text AS $$
  SELECT coalesce(
    current_setting('request.jwt.claims', true)::json->>'user_role',
    'cashier'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ── 5. Authenticated role policies (role-based access) ────────────────────

CREATE POLICY "staff_select"  ON staff FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_insert"  ON staff FOR INSERT TO authenticated WITH CHECK (public.pos_user_role() = 'admin');
CREATE POLICY "staff_update"  ON staff FOR UPDATE TO authenticated USING (public.pos_user_role() = 'admin');
CREATE POLICY "staff_delete"  ON staff FOR DELETE TO authenticated USING (public.pos_user_role() = 'admin');

CREATE POLICY "devices_select" ON devices FOR SELECT TO authenticated USING (true);
CREATE POLICY "devices_manage" ON devices FOR ALL    TO authenticated USING (public.pos_user_role() = 'admin');

CREATE POLICY "categories_select" ON categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "categories_manage" ON categories FOR ALL    TO authenticated USING (public.pos_user_role() IN ('admin', 'manager'));

CREATE POLICY "products_select" ON products FOR SELECT TO authenticated USING (true);
CREATE POLICY "products_manage" ON products FOR ALL    TO authenticated USING (public.pos_user_role() IN ('admin', 'manager'));

CREATE POLICY "stock_adj_select" ON stock_adjustments FOR SELECT TO authenticated USING (true);
CREATE POLICY "stock_adj_insert" ON stock_adjustments FOR INSERT TO authenticated WITH CHECK (public.pos_user_role() IN ('admin', 'manager', 'stock_manager'));

CREATE POLICY "tables_select" ON restaurant_tables FOR SELECT TO authenticated USING (true);
CREATE POLICY "tables_manage" ON restaurant_tables FOR ALL    TO authenticated USING (public.pos_user_role() IN ('admin', 'manager'));

CREATE POLICY "orders_select" ON orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "orders_insert" ON orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "orders_update" ON orders FOR UPDATE TO authenticated USING (true);

CREATE POLICY "order_items_select" ON order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "order_items_insert" ON order_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "order_items_update" ON order_items FOR UPDATE TO authenticated USING (true);

CREATE POLICY "payments_select" ON payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "payments_insert" ON payments FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "refunds_select" ON refunds FOR SELECT TO authenticated USING (true);
CREATE POLICY "refunds_insert" ON refunds FOR INSERT TO authenticated WITH CHECK (public.pos_user_role() IN ('admin', 'manager'));

CREATE POLICY "customers_select" ON customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "customers_manage" ON customers FOR ALL    TO authenticated USING (public.pos_user_role() = 'admin');

CREATE POLICY "credit_txn_select" ON credit_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "credit_txn_insert" ON credit_transactions FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "exp_cat_select" ON expense_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "exp_cat_manage" ON expense_categories FOR ALL    TO authenticated USING (public.pos_user_role() IN ('admin', 'manager'));

CREATE POLICY "expenses_select" ON expenses FOR SELECT TO authenticated USING (public.pos_user_role() IN ('admin', 'manager', 'stock_manager'));
CREATE POLICY "expenses_insert" ON expenses FOR INSERT TO authenticated WITH CHECK (public.pos_user_role() IN ('admin', 'manager', 'stock_manager'));

CREATE POLICY "shifts_select" ON shifts FOR SELECT TO authenticated USING (true);
CREATE POLICY "shifts_insert" ON shifts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "shifts_update" ON shifts FOR UPDATE TO authenticated USING (true);

CREATE POLICY "audit_log_select" ON audit_log FOR SELECT TO authenticated USING (public.pos_user_role() = 'admin');
CREATE POLICY "audit_log_insert" ON audit_log FOR INSERT TO authenticated WITH CHECK (true);

-- ── 6. Anon role policies (allows POS devices to sync without Supabase Auth) ─

CREATE POLICY "anon_all_staff"               ON staff               FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_devices"             ON devices             FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_categories"          ON categories          FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_products"            ON products            FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_stock_adjustments"   ON stock_adjustments   FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_restaurant_tables"   ON restaurant_tables   FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_orders"              ON orders              FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_order_items"         ON order_items         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_payments"            ON payments            FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_refunds"             ON refunds             FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_customers"           ON customers           FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_credit_transactions" ON credit_transactions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_expense_categories"  ON expense_categories  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_expenses"            ON expenses            FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_shifts"              ON shifts              FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_audit_log"           ON audit_log           FOR ALL TO anon USING (true) WITH CHECK (true);
