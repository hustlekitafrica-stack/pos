-- ============================================================================
-- Bar & Restaurant POS — Initial Seed Data (Supabase-side only)
-- Run AFTER 000_create_tables.sql and 001_rls_policies.sql.
--
-- NOTE: The app auto-seeds WatermelonDB locally on first launch and syncs to
-- Supabase. This file is only needed if you want to pre-populate Supabase
-- directly (e.g. for a fresh install without running the app first).
--
-- PINs are stored as SHA-256 hex digests (via expo-crypto in the app).
-- SHA-256("1234") = 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
-- SHA-256("5678") = ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f
-- SHA-256("9012") = 5765f916b4f259c5b54aaa98f3fe3dc4c5b93d0ef2fe71e6e5e63d7b36428b57
-- ============================================================================

-- Expense categories
INSERT INTO expense_categories (name) VALUES
  ('Supplies/Stock'),
  ('Salaries'),
  ('Utilities'),
  ('Rent'),
  ('Transport'),
  ('Maintenance'),
  ('Other')
ON CONFLICT DO NOTHING;

-- Restaurant tables
INSERT INTO restaurant_tables (name, status) VALUES
  ('Table 1', 'free'),
  ('Table 2', 'free'),
  ('Table 3', 'free'),
  ('Table 4', 'free'),
  ('Table 5', 'free'),
  ('Table 6', 'free'),
  ('Bar Seat 1', 'free'),
  ('Bar Seat 2', 'free'),
  ('Bar Seat 3', 'free'),
  ('Bar Seat 4', 'free')
ON CONFLICT DO NOTHING;

-- Default staff accounts (matching app's seedDatabase() in lib/db/seed.ts)
INSERT INTO staff (id, name, role, pin, phone, is_active) VALUES
  (gen_random_uuid(), 'Admin',             'admin',     '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', '', true),
  (gen_random_uuid(), 'Jane (Cashier)',    'cashier',   'ef797c8118f02dfb649607dd5d3f8c7623048c9c063d532cc95c5ed7a898a64f', '', true),
  (gen_random_uuid(), 'Mike (Bartender)', 'bartender', '5765f916b4f259c5b54aaa98f3fe3dc4c5b93d0ef2fe71e6e5e63d7b36428b57', '', true)
ON CONFLICT DO NOTHING;
