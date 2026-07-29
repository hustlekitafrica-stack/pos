-- ============================================================================
-- Row Level Security (RLS) Policies for Bar & Restaurant POS
-- ============================================================================
-- Run this migration against your Supabase project.
-- Assumes all tables mirror the WatermelonDB schema names.
-- Authenticated users only; role-based access via JWT claim `user_role`.
-- ============================================================================

-- Enable RLS on all tables
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE restaurant_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- Helper function to extract role from JWT
CREATE OR REPLACE FUNCTION auth.user_role()
RETURNS text AS $$
  SELECT coalesce(
    current_setting('request.jwt.claims', true)::json->>'user_role',
    'cashier'
  );
$$ LANGUAGE sql STABLE;

-- ── Staff ───────────────────────────────────────────────────────────────────
-- All authenticated can read (need to look up PINs for login)
CREATE POLICY "staff_select" ON staff FOR SELECT TO authenticated USING (true);
-- Only admin can modify
CREATE POLICY "staff_insert" ON staff FOR INSERT TO authenticated WITH CHECK (auth.user_role() = 'admin');
CREATE POLICY "staff_update" ON staff FOR UPDATE TO authenticated USING (auth.user_role() = 'admin');
CREATE POLICY "staff_delete" ON staff FOR DELETE TO authenticated USING (auth.user_role() = 'admin');

-- ── Devices ─────────────────────────────────────────────────────────────────
CREATE POLICY "devices_select" ON devices FOR SELECT TO authenticated USING (true);
CREATE POLICY "devices_manage" ON devices FOR ALL TO authenticated USING (auth.user_role() = 'admin');

-- ── Categories & Products (menu) ────────────────────────────────────────────
-- Everyone can read menu
CREATE POLICY "categories_select" ON categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "products_select" ON products FOR SELECT TO authenticated USING (true);
-- Admin/Manager can edit
CREATE POLICY "categories_manage" ON categories FOR ALL TO authenticated
  USING (auth.user_role() IN ('admin', 'manager'));
CREATE POLICY "products_manage" ON products FOR ALL TO authenticated
  USING (auth.user_role() IN ('admin', 'manager'));

-- ── Stock Adjustments ───────────────────────────────────────────────────────
CREATE POLICY "stock_adj_select" ON stock_adjustments FOR SELECT TO authenticated USING (true);
CREATE POLICY "stock_adj_insert" ON stock_adjustments FOR INSERT TO authenticated
  WITH CHECK (auth.user_role() IN ('admin', 'manager', 'stock_manager'));

-- ── Tables ──────────────────────────────────────────────────────────────────
CREATE POLICY "tables_select" ON restaurant_tables FOR SELECT TO authenticated USING (true);
CREATE POLICY "tables_manage" ON restaurant_tables FOR ALL TO authenticated
  USING (auth.user_role() IN ('admin', 'manager'));

-- ── Orders & Items ──────────────────────────────────────────────────────────
-- All staff can read and create orders
CREATE POLICY "orders_select" ON orders FOR SELECT TO authenticated USING (true);
CREATE POLICY "orders_insert" ON orders FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "orders_update" ON orders FOR UPDATE TO authenticated USING (true);

CREATE POLICY "order_items_select" ON order_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "order_items_insert" ON order_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "order_items_update" ON order_items FOR UPDATE TO authenticated USING (true);

-- ── Payments ────────────────────────────────────────────────────────────────
CREATE POLICY "payments_select" ON payments FOR SELECT TO authenticated USING (true);
CREATE POLICY "payments_insert" ON payments FOR INSERT TO authenticated WITH CHECK (true);

-- ── Refunds ─────────────────────────────────────────────────────────────────
CREATE POLICY "refunds_select" ON refunds FOR SELECT TO authenticated USING (true);
CREATE POLICY "refunds_insert" ON refunds FOR INSERT TO authenticated
  WITH CHECK (auth.user_role() IN ('admin', 'manager'));

-- ── Customers & Credit ──────────────────────────────────────────────────────
CREATE POLICY "customers_select" ON customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "customers_manage" ON customers FOR ALL TO authenticated
  USING (auth.user_role() = 'admin');

CREATE POLICY "credit_txn_select" ON credit_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "credit_txn_insert" ON credit_transactions FOR INSERT TO authenticated WITH CHECK (true);

-- ── Expense Categories & Expenses ───────────────────────────────────────────
CREATE POLICY "exp_cat_select" ON expense_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "exp_cat_manage" ON expense_categories FOR ALL TO authenticated
  USING (auth.user_role() IN ('admin', 'manager'));

CREATE POLICY "expenses_select" ON expenses FOR SELECT TO authenticated
  USING (auth.user_role() IN ('admin', 'manager', 'stock_manager'));
CREATE POLICY "expenses_insert" ON expenses FOR INSERT TO authenticated
  WITH CHECK (auth.user_role() IN ('admin', 'manager', 'stock_manager'));

-- ── Shifts ──────────────────────────────────────────────────────────────────
-- Staff can see their own shifts; admin/manager can see all
CREATE POLICY "shifts_select_own" ON shifts FOR SELECT TO authenticated
  USING (staff_id = auth.uid()::text OR auth.user_role() IN ('admin', 'manager'));
CREATE POLICY "shifts_insert" ON shifts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "shifts_update" ON shifts FOR UPDATE TO authenticated USING (true);

-- ── Audit Log ───────────────────────────────────────────────────────────────
CREATE POLICY "audit_log_select" ON audit_log FOR SELECT TO authenticated
  USING (auth.user_role() = 'admin');
CREATE POLICY "audit_log_insert" ON audit_log FOR INSERT TO authenticated WITH CHECK (true);
