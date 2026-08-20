-- ============================================================================
-- Migration 007: Fix FK Constraints That Break Sync
--
-- Run in the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/rusopielhzmdyskrrkaw/sql
--
-- WHY: Three FK constraints in migration 005 reject valid app data, causing
-- the entire WatermelonDB sync to abort before any row reaches Supabase.
--
-- Problem 1: expenses.paid_by REFERENCES staff(id)
--   The app stores a free-text name like "Manager" or "John", not a staff ID.
--   Every expense push fails with a FK violation → entire sync aborts.
--
-- Problem 2: orders.device_id REFERENCES devices(id)
--   Existing orders have a device_id that was never registered in the devices
--   table (set from Constants.sessionId before the device-registration fix).
--   FK violation → entire sync aborts.
--
-- Problem 3: audit_log.device_id REFERENCES devices(id)
--   Existing audit log rows have device_id = '' (empty string) or a random
--   session UUID, neither of which exists in the devices table.
--   FK violation → entire sync aborts.
--
-- This migration is safe to run: it does NOT delete or change any data.
-- It only removes the referential-integrity checks on those three columns.
-- ============================================================================

-- Fix 1: expenses.paid_by — free-text field, must not be a FK
ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_paid_by_fkey;

-- Fix 2: orders.device_id — informational only, existing records have wrong values
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_device_id_fkey;

-- Fix 3: audit_log.device_id — informational only, existing records have wrong values
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_device_id_fkey;
