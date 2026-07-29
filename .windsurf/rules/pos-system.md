# Bar & Restaurant POS System — Architecture & Rules

> **IMPORTANT**: This is the single source of truth for the POS project. Read this file before making ANY changes. Update this file in the SAME session whenever you add a feature, change the schema, or make an architectural decision.

---

## Project Overview

- **App name**: Bar POS
- **Target user**: Single-location bar/restaurant adjacent to hotel rooms in Kisumu, Kenya
- **Platform**: Android tablet/phone (Expo React Native)
- **Multi-device**: Yes — multiple tablets (bar, floor) operate simultaneously
- **Connectivity**: WiFi usually available; offline is a fallback for outages
- **Currency**: KES — stored as **integer cents** in the database, displayed with 2 decimal places in the UI

---

## Tech Stack

| Layer | Choice |
|---|---|
| Mobile app | Expo (React Native) + TypeScript + NativeWind (TailwindCSS) |
| Backend/DB | Supabase (Postgres + Auth + Realtime + Storage) |
| Local/offline DB | WatermelonDB (offline-first, built-in sync protocol) |
| State management | Zustand |
| Payments | M-Pesa Daraja STK Push via Node/Express on Railway |
| Receipt printing | 2x Bluetooth 58mm ESC/POS thermal printers (bar + kitchen) |
| Low-stock alerts | Supabase Edge Function + email provider (e.g. Resend) |
| Expense receipt scan | Anthropic Claude vision API |
| Reports/charts | react-native-chart-kit or Victory Native |
| Navigation | Expo Router (file-based) |

---

## Current Build Phase

**Phase 1 — Core POS (MVP)** ✅ COMPLETE
- [x] Auth (PIN login + device registration)
- [x] Menu & category management
- [x] Stock tracking with auto-deduction on order confirmation
- [x] Table/tab view + order flow (open → send → serve → pay → close)
- [x] Cash payments
- [x] Shift open/close with cash reconciliation
- [x] Dual Bluetooth printer routing (bar + kitchen) — logic ready, BLE needs device testing
- [x] Basic receipt printing — ESC/POS templates ready
- [x] Offline-first with WatermelonDB sync

**Phase 2 — Payments, Splits, Credit & Expenses** ✅ COMPLETE
- [x] M-Pesa STK Push integration (STK push + polling via Supabase Edge Function)
- [x] Card payment recording
- [x] Split bill / split payment
- [x] Credit sales module (customer registration, credit checkout, repayments, debtors list)
- [x] Expense tracking (manual + AI receipt scan via Claude Vision)
- [x] Stock Manager role + stock adjustment workflow
- [x] Menu management CRUD (categories + products)

**Phase 3 — Reports & Alerts** ✅ COMPLETE
- [x] Daily/weekly/monthly sales reports (revenue, orders, avg order, payment breakdown, category breakdown, daily totals)
- [x] Expense reports (total, by category, line items)
- [x] Per-staff shift reports (scoped visibility — staff see own, admin/manager see all)
- [x] Charts — stat cards with color-coded data (chart lib deferred to avoid native dep overhead)
- [x] PDF/CSV export (expo-print for PDF, expo-file-system + expo-sharing for CSV)
- [x] Low-stock email alerts (via Supabase Edge Function, marks alerted products)
- [x] Debtors report (outstanding balances, charged/repaid/limit per customer)

**Phase 4 — Hardening & Polish** ✅ COMPLETE
- [x] Discount & complimentary item support (per-order discount + per-item COMP toggle)
- [x] Refund flow (void order, restore stock, create refund record)
- [x] Audit log viewer (admin only, app/admin/audit-log.tsx)
- [x] Session timeout + auto-lock (wired in _layout.tsx with session monitor)
- [x] RLS policy hardening (supabase/migrations/001_rls_policies.sql)
- [x] End-of-day close process (app/admin/end-of-day.tsx — summary, force-close shifts, low-stock alerts)

**Infrastructure** ✅ COMPLETE
- [x] Supabase Edge Functions (mpesa-stk-push, mpesa-stk-query, scan-receipt, low-stock-alert)
- [x] Bluetooth printer BLE integration (react-native-ble-plx scan/connect/send)
- [x] Settings screen (staff CRUD, printer management, sync, logout, admin links)

---

## Database Schema

All monetary values are **integer (cents)**. All tables have `created_at` and `updated_at` (timestamptz) for WatermelonDB sync.

### staff
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| role | text | 'admin', 'manager', 'stock_manager', 'cashier', 'bartender' |
| pin | text | bcrypt hashed |
| phone | text | |
| is_active | boolean | default true |

### devices
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | e.g. "Bar Tablet" |
| device_fingerprint | text | unique device ID |
| is_approved | boolean | default false, admin must approve |

### categories
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | e.g. "Beers", "Spirits", "Food" |
| prep_station | text | 'bar' or 'kitchen' — routes printing |

### products
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | |
| category_id | uuid FK→categories | |
| price | integer | cents |
| cost_price | integer | cents, for margin calc |
| stock_qty | integer | default 0 |
| unit | text | 'bottle', 'plate', 'portion', etc. |
| low_stock_threshold | integer | default 5 |
| low_stock_alert_sent | boolean | default false, reset on restock |
| is_out_of_stock | boolean | default false, manual override |
| is_active | boolean | default true |

### stock_adjustments
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| product_id | uuid FK→products | |
| adjusted_by | uuid FK→staff | |
| change_qty | integer | positive=restock, negative=wastage |
| reason | text | 'restock', 'wastage', 'breakage', 'correction' |

### restaurant_tables
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | e.g. "Table 1", "Bar Seat 3" |
| status | text | 'free', 'open', 'awaiting_payment' |

### orders
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| table_id | uuid FK→restaurant_tables | |
| staff_id | uuid FK→staff | |
| shift_id | uuid FK→shifts | ties order to a shift |
| device_id | uuid FK→devices | which tablet created it |
| customer_id | uuid FK→customers | nullable, for credit sales |
| is_credit | boolean | default false |
| room_number | text | nullable, hotel room for guest identification |
| status | text | 'open', 'sent', 'served', 'paid', 'closed', 'voided' |
| opened_at | timestamptz | |
| closed_at | timestamptz | |
| discount_amount | integer | cents, default 0 |
| discount_reason | text | |
| total_amount | integer | cents |

### order_items
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| order_id | uuid FK→orders | |
| product_id | uuid FK→products | |
| qty | integer | |
| unit_price | integer | cents, snapshot at time of order |
| notes | text | e.g. "no ice" |
| status | text | 'pending', 'sent', 'preparing', 'served', 'voided' |
| is_complimentary | boolean | default false |
| comp_reason | text | |
| comp_authorized_by | uuid FK→staff | |
| voided | boolean | default false |
| void_reason | text | |
| voided_by | uuid FK→staff | |

### payments
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| order_id | uuid FK→orders | |
| method | text | 'cash', 'mpesa', 'card', 'credit', 'other' |
| amount | integer | cents |
| mpesa_ref | text | |
| paid_at | timestamptz | |

### refunds
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| payment_id | uuid FK→payments | |
| amount | integer | cents |
| reason | text | |
| authorized_by | uuid FK→staff | |

### customers (credit customers)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | not null |
| phone | text | for follow-up |
| credit_limit | integer | cents, 0 = no limit |
| is_active | boolean | default true |
| notes | text | |
| created_by | uuid FK→staff | must be admin |

### credit_transactions
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| customer_id | uuid FK→customers | |
| order_id | uuid FK→orders | null for standalone repayments |
| type | text | 'credit_sale' or 'repayment' |
| amount | integer | cents |
| payment_method | text | for repayments only |
| mpesa_ref | text | |
| notes | text | |
| recorded_by | uuid FK→staff | |

### expense_categories
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text | 'Supplies', 'Salaries', 'Utilities', 'Rent', 'Transport', 'Maintenance', 'Other' |

### expenses
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| category_id | uuid FK→expense_categories | |
| description | text | |
| amount | integer | cents |
| paid_by | uuid FK→staff | who spent the money |
| logged_by | uuid FK→staff | who entered it (usually Stock Manager) |
| date | date | |
| receipt_photo_url | text | |
| source | text | 'scanned' or 'manual' |
| vendor_name | text | from scan extraction, nullable |

### shifts
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| staff_id | uuid FK→staff | |
| opened_at | timestamptz | |
| closed_at | timestamptz | |
| opening_cash | integer | cents |
| closing_cash_expected | integer | cents, computed from cash sales |
| closing_cash_actual | integer | cents, counted by staff |
| variance | integer | cents |

### audit_log
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| action | text | 'void_item', 'price_change', 'stock_adjust', 'discount_applied', 'comp_given', 'refund', 'credit_sale', 'credit_repayment' |
| entity_type | text | 'order_item', 'product', 'payment', 'customer', etc. |
| entity_id | uuid | |
| staff_id | uuid FK→staff | |
| device_id | uuid FK→devices | |
| details | jsonb | flexible payload |

---

## Role Permissions Matrix

| Action | Admin | Manager | Stock Manager | Cashier/Waiter | Bartender |
|---|---|---|---|---|---|
| Full access to all reports | ✅ | ✅ | ❌ | ❌ | ❌ |
| Menu editing (products, categories) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Staff management | ✅ | ❌ | ❌ | ❌ | ❌ |
| Expense management | ✅ | ✅ | ✅ | ❌ | ❌ |
| Stock adjustments | ✅ | ✅ | ✅ | ❌ | ❌ |
| Mark item out-of-stock | ✅ | ✅ | ✅ | ❌ | ❌ |
| Take orders | ✅ | ✅ | ❌ | ✅ | ✅ |
| Accept payments | ✅ | ✅ | ❌ | ✅ | ✅ |
| View own shift report | ✅ | ✅ | ❌ | ✅ | ✅ |
| Register credit customers | ✅ | ❌ | ❌ | ❌ | ❌ |
| Record credit repayments | ✅ | ❌ | ❌ | ❌ | ❌ |
| View debtors list | ✅ | ❌ | ❌ | ❌ | ❌ |
| Select credit customer at checkout | ✅ | ✅ | ❌ | ✅ | ✅ |
| Approve devices | ✅ | ❌ | ❌ | ❌ | ❌ |
| Void items (with reason) | ✅ | ✅ | ❌ | ✅ | ✅ |

---

## Architecture Decisions

1. **Offline-first via WatermelonDB**: All writes go to local WatermelonDB first. Sync to Supabase via `synchronize()` protocol when connected. Supabase Realtime broadcasts changes to all connected devices.
2. **Stock deduction on order send, not payment**: Stock decrements when order status → `sent`. Voiding an item increments stock back.
3. **Server-side atomic stock operations**: `UPDATE products SET stock_qty = stock_qty - $1 WHERE stock_qty >= $1` — no client-side read-modify-write to avoid race conditions across devices.
4. **Multi-device table access**: Multiple devices can add items to the same table's order. Real-time sync via Supabase Realtime keeps all devices in sync.
5. **Dual printer routing**: Order items auto-split by `categories.prep_station` — 'bar' items → bar printer, 'kitchen' items → kitchen printer.
6. **Credit sales are admin-only**: Only admin can register credit customers, set limits, and record repayments. Cashiers can only select from pre-approved list at checkout.
7. **Shift closure blocked if open orders exist**: Forces staff to close or transfer all orders before ending shift.
8. **Room number is a reference field only**: Not tied to a hotel management system. Optional free-text on orders for guest identification.
9. **Auto-clear out-of-stock on restock**: When stock is restocked via `stock_adjustments`, `is_out_of_stock` and `low_stock_alert_sent` are automatically reset.

---

## Coding Conventions

- **Language**: TypeScript (strict mode)
- **Styling**: NativeWind (TailwindCSS classes in React Native)
- **File naming**: kebab-case for files, PascalCase for components and models
- **Folder structure**: Feature-grouped under `components/`, domain logic in `lib/`, React hooks in `hooks/`, Zustand stores in `stores/`
- **Currency**: Always store as integer cents. Use `utils/currency.ts` helpers for display formatting (`formatKES(amountInCents)`)
- **IDs**: UUID v4 everywhere
- **Dates**: `timestamptz` in DB, ISO strings in transit, `Date` objects in app
- **State**: Zustand for UI state (auth, printer connection), WatermelonDB for persistent data
- **Navigation**: Expo Router file-based routing. Auth gate via `(auth)/` group, main app via `(tabs)/` group.

---

## Folder Structure

```
f:\POS\
├── app/                          # Expo Router screens
│   ├── (auth)/
│   │   ├── _layout.tsx
│   │   └── login.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx
│   │   ├── tables.tsx
│   │   ├── menu.tsx
│   │   ├── orders.tsx
│   │   ├── reports.tsx
│   │   ├── expenses.tsx
│   │   ├── debtors.tsx
│   │   ├── stock.tsx
│   │   └── settings.tsx
│   ├── order/[id].tsx
│   ├── shift/
│   │   ├── open.tsx
│   │   └── close.tsx
│   └── _layout.tsx
├── components/
│   ├── ui/
│   ├── orders/
│   ├── menu/
│   ├── reports/
│   └── payments/
├── lib/
│   ├── supabase.ts
│   ├── db/
│   │   ├── schema.ts
│   │   ├── models/
│   │   ├── sync.ts
│   │   └── index.ts
│   ├── mpesa/
│   ├── printer/
│   ├── auth/
│   └── reports/
├── hooks/
├── types/
│   └── index.ts
├── constants/
│   ├── roles.ts
│   └── config.ts
├── stores/
│   ├── authStore.ts
│   └── printerStore.ts
└── utils/
    ├── currency.ts
    └── dateHelpers.ts
```
