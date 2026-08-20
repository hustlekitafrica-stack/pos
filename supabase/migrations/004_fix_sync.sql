-- ============================================================================
-- Migration 004: Fix Sync — Missing shifts columns + Anon access policies
--
-- Run this in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/rusopielhzmdyskrrkaw/sql
--
-- What this does:
-- 1. Adds the 4 columns that WatermelonDB migration v2 added to `shifts`
--    but were never added to the Supabase table.
-- 2. Grants the `anon` role full CRUD on all 16 tables so the app's
--    anon-keyed Supabase client can push/pull sync data without requiring
--    Supabase Auth sign-in.  Safe for internal POS use only.
-- ============================================================================

-- ── 1. Add missing shifts columns ─────────────────────────────────────────

ALTER TABLE shifts
  ADD COLUMN IF NOT EXISTS status          text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS approved_by     uuid REFERENCES staff(id),
  ADD COLUMN IF NOT EXISTS approved_at     timestamptz,
  ADD COLUMN IF NOT EXISTS closure_notes   text;

-- ── 2. Anon access policies (internal POS — no Supabase Auth required) ────

CREATE POLICY "anon_all_staff"              ON staff              FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_devices"            ON devices            FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_categories"         ON categories         FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_products"           ON products           FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_stock_adjustments"  ON stock_adjustments  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_restaurant_tables"  ON restaurant_tables  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_orders"             ON orders             FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_order_items"        ON order_items        FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_payments"           ON payments           FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_refunds"            ON refunds            FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_customers"          ON customers          FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_credit_txn"         ON credit_transactions FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_expense_categories" ON expense_categories  FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_expenses"           ON expenses           FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_shifts"             ON shifts             FOR ALL TO anon USING (true) WITH CHECK (true);
CREATE POLICY "anon_all_audit_log"          ON audit_log          FOR ALL TO anon USING (true) WITH CHECK (true);
