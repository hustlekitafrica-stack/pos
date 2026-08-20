-- ============================================================================
-- Migration 006: Settings Table + Logos Storage Bucket
--
-- Run in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/rusopielhzmdyskrrkaw/sql
--
-- What this does:
-- 1. Creates a `settings` table for venue-wide app settings (single global row)
-- 2. Creates a `logos` storage bucket for the venue logo
-- 3. Adds RLS policies for anon and authenticated access
-- ============================================================================

-- ── 1. Create settings table ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
  id                      text PRIMARY KEY DEFAULT 'global',
  alert_email             text NOT NULL DEFAULT '',
  logo_url                text,
  bar_printer_address     text,
  kitchen_printer_address text,
  venue_name              text NOT NULL DEFAULT 'Bar POS',
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz DEFAULT now()
);

-- Seed the single global row
INSERT INTO settings (id) VALUES ('global') ON CONFLICT DO NOTHING;

-- ── 2. Enable RLS ─────────────────────────────────────────────────────────────

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Drop first so this file can be re-run safely
DROP POLICY IF EXISTS "anon_all_settings" ON settings;
DROP POLICY IF EXISTS "settings_select"   ON settings;
DROP POLICY IF EXISTS "settings_update"   ON settings;
DROP POLICY IF EXISTS "settings_insert"   ON settings;

-- Anon (POS device sync without Supabase Auth)
CREATE POLICY "anon_all_settings" ON settings FOR ALL TO anon USING (true) WITH CHECK (true);

-- Authenticated (role-based access — admin manages settings)
CREATE POLICY "settings_select" ON settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_update" ON settings FOR UPDATE TO authenticated USING (true);
CREATE POLICY "settings_insert" ON settings FOR INSERT TO authenticated WITH CHECK (true);

-- ── 3. Create logos storage bucket ───────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;

-- Public read
DROP POLICY IF EXISTS "Logos Public Read" ON storage.objects;
CREATE POLICY "Logos Public Read" ON storage.objects
  FOR SELECT USING (bucket_id = 'logos');

-- Anon upload (POS device can upload without Supabase Auth)
DROP POLICY IF EXISTS "Logos Anon Upload" ON storage.objects;
CREATE POLICY "Logos Anon Upload" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'logos');

-- Anon update/upsert
DROP POLICY IF EXISTS "Logos Anon Update" ON storage.objects;
CREATE POLICY "Logos Anon Update" ON storage.objects
  FOR UPDATE WITH CHECK (bucket_id = 'logos');
