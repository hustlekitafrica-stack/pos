# Migration Deployment Guide

Since the Supabase CLI deployment failed due to account permissions, apply the migrations manually via the Supabase Dashboard.

## Migration 1: RLS Policies

1. Go to https://supabase.com/dashboard/project/rusopielhzmdyskrrkaw/sql
2. Open the SQL Editor
3. Copy and paste the entire contents of `supabase/migrations/001_rls_policies.sql`
4. Click "Run" to execute

## Migration 2: Receipts Storage Bucket

1. In the same SQL Editor
2. Copy and paste the entire contents of `supabase/migrations/002_create_receipts_bucket.sql`
3. Click "Run" to execute

This creates a public `receipts` bucket for storing receipt images with appropriate access policies.

## What the RLS migration does

- Enables Row Level Security on all 16 tables
- Creates a helper function `auth.user_role()` to extract the role from JWT claims
- Applies role-based policies:
  - **Admin**: full access including staff management, audit log
  - **Manager**: reports, menu editing, expenses, stock, shifts
  - **Stock Manager**: stock adjustments, expenses
  - **Cashier/Bartender**: orders, payments, own shift reports
  - All authenticated users can read menu, orders, and basic data
  - Sensitive operations (discounts, refunds, audit log) restricted to admin/manager

## After applying

The RLS policies will be active. Your app's auth flow must include the `user_role` claim in the JWT for the policies to work correctly.

If you need to disable RLS temporarily for debugging, run:

```sql
ALTER TABLE staff DISABLE ROW LEVEL SECURITY;
-- Repeat for other tables as needed
```

To re-enable:

```sql
ALTER TABLE staff ENABLE ROW LEVEL SECURITY;
```
