# Bar & Restaurant POS System — Product Requirements Document

**Target user:** Single-location bar/restaurant adjacent to hotel rooms in Kisumu, Kenya
**Platform:** Android tablet/phone (Expo React Native app)
**Multi-device:** Yes — multiple tablets operating simultaneously (bar counter, floor)
**Author:** Mizzo

---

## 1. Overview

A point-of-sale app for taking orders, tracking table/tab status, accepting payments (cash, M-Pesa, card, credit), recording expenses, managing credit customers (debtors), and generating daily/weekly/monthly sales and expense reports. Built offline-first with WatermelonDB since connectivity can't be guaranteed — the app keeps working and syncs when back online. The bar/restaurant is adjacent to hotel rooms, so most customers are hotel guests identified by room number.

---

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Mobile app | Expo (React Native) + TypeScript + NativeWind | Fast to build, good Android support |
| Backend/DB | Supabase (Postgres + Auth + Realtime + Storage) | Auth + RLS + realtime out of the box |
| Local/offline DB | WatermelonDB | Multi-device offline-first with built-in sync protocol |
| State management | Zustand | Lightweight, works well with React Native |
| Payments | M-Pesa Daraja (STK Push) via Node/Express on Railway | Standard Daraja integration |
| Receipt printing | 2x Bluetooth 58mm ESC/POS thermal printers (bar + kitchen) | Auto-route by category prep station |
| Low-stock alerts | Supabase Edge Function + Resend (email) | Owner notified without checking app |
| Expense receipt scan | Anthropic Claude vision API | Photo in → vendor/amount/date/line-items out |
| Reports/charts | react-native-chart-kit or Victory Native | Simple bar/line charts |

---

## 3. Core Modules

### 3.1 Auth & Roles
- PIN-based quick login backed by Supabase Auth (bcrypt hashed PINs)
- Device registration — admin must approve new devices before they can access the system
- Session timeout with auto-lock after inactivity
- Roles: **Admin/Owner**, **Manager**, **Stock Manager**, **Cashier/Waiter**, **Bartender**

**Role permissions:**
| Action | Admin | Manager | Stock Mgr | Cashier | Bartender |
|---|---|---|---|---|---|
| All reports (business-wide) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Menu editing | ✅ | ✅ | ❌ | ❌ | ❌ |
| Staff management | ✅ | ❌ | ❌ | ❌ | ❌ |
| Expenses | ✅ | ✅ | ✅ | ❌ | ❌ |
| Stock adjustments | ✅ | ✅ | ✅ | ❌ | ❌ |
| Take orders / accept payments | ✅ | ✅ | ❌ | ✅ | ✅ |
| Own shift report | ✅ | ✅ | ❌ | ✅ | ✅ |
| Credit customer management | ✅ | ❌ | ❌ | ❌ | ❌ |
| Select credit customer at checkout | ✅ | ✅ | ❌ | ✅ | ✅ |
| Device approval | ✅ | ❌ | ❌ | ❌ | ❌ |

### 3.2 Menu & Inventory
- Categories with **prep station** tag (`bar` or `kitchen`) for printer routing
- Products: name, category, price, cost price, stock qty, unit, active/inactive
- **Stock deducts on order send** (not payment) — matches physical reality
- Stock Manager: adjust stock (restock, wastage, breakage, correction with reason), mark items out-of-stock manually
- **Auto-clear out-of-stock** when restocked
- **Low-stock email alert** when `stock_qty` crosses `low_stock_threshold`

### 3.3 Orders / Tables / Tabs
- Table/tab view — open tables as cards with status (free, open, awaiting_payment)
- **Room number** — optional field on orders for hotel guest identification
- Add items, quantity, notes (e.g. "no ice")
- Split bill / split payment support
- Order statuses: `open → sent → served → paid → closed`
- Item-level statuses: `pending → sent → preparing → served` (or `voided`)
- Void/cancel item with reason + who voided (audit trail)
- **Dual printer routing**: items auto-split by prep station — drinks → bar printer, food → kitchen printer

### 3.4 Payments
- Methods: Cash, M-Pesa (STK Push), Card, Credit, Other
- M-Pesa flow: enter phone → STK push → poll confirmation → mark paid
- Record partial/split payments against one order
- Print or share digital receipt (include M-Pesa ref on receipt)
- Credit payment: select pre-approved customer, creates credit_transaction

### 3.5 Credit / Debtors (Admin-only management)
- **Known regulars only** — admin registers credit customers (name, phone, credit limit, notes)
- At checkout: cashier selects "Pay on Credit" → picks customer from list → order marked as credit sale
- Repayments: admin records full or partial repayments (cash/M-Pesa/card) with notes
- Running balance computed from credit_transactions ledger
- Credit limit enforcement — blocks sale if it would exceed limit (0 = no limit, trust-based)
- Debtors screen: all customers with outstanding balances, sorted by amount owed

### 3.6 Expenses
- **AI receipt scan**: Claude vision extracts vendor/amount/date/line-items, pre-fills form
- **Manual entry**: category, description, amount, date
- Categories: Supplies/Stock, Salaries, Utilities, Rent, Transport, Maintenance, Other
- Stock Manager logs expenses day-to-day; Admin/Manager can review/edit

### 3.7 Shifts & Cash Reconciliation
- Open shift with opening cash float
- Close shift with counted closing cash → expected vs actual → variance flagged
- **Shift closure blocked if open orders exist**
- Orders and payments tied to shifts via `shift_id`

### 3.8 Reports
- **Daily/Weekly/Monthly**: total sales, by payment method, total expenses, net, top items, by category
- **Filters**: by staff, category, payment method (Admin/Manager only)
- **Export**: PDF or CSV
- **Visibility**: Cashier/Waiter/Bartender see own shift report only. Admin/Manager see everything.
- **Debtors report**: outstanding balances across all credit customers
- Charts: daily sales trend, expense breakdown

---

## 4. Database Schema

See `.windsurf/rules/pos-system.md` for the complete schema reference (kept in sync with actual implementation).

---

## 5. Offline-First Sync Strategy

1. **WatermelonDB** on each device with `synchronize()` protocol syncing to Supabase
2. **Supabase Realtime** broadcasts changes to all connected devices instantly
3. **Stock operations use server-side atomic SQL** — no client-side read-modify-write
4. **Multi-device table access** — multiple waiters can serve the same table, real-time sync keeps order state consistent
5. **Conflict resolution**: WatermelonDB pull-then-push; rare conflicts resolved by server timestamp
6. **M-Pesa** requires connectivity — show "No connection" when offline

---

## 6. Build Phases

### Phase 1 — Core POS (MVP)
Auth, menu, stock tracking, table/order flow, cash payments, shifts, printer routing, offline sync

### Phase 2 — Payments, Splits, Credit & Expenses
M-Pesa, card, split bills, credit sales module, expenses, stock adjustments

### Phase 3 — Reports & Alerts
Sales/expense reports, charts, PDF/CSV export, low-stock alerts, debtors report

### Phase 4 — Hardening & Polish
Discounts, comps, refunds, audit log viewer, session timeout, RLS, end-of-day process

---

## 7. Key Decisions

- ✅ Multi-device with WatermelonDB sync (not raw SQLite)
- ✅ Stock deducts on order send, not payment
- ✅ Credit sales for known regulars only, admin-managed, with credit limits
- ✅ Room number on orders for hotel guest identification (reference only, not room-charge)
- ✅ Dual Bluetooth printers — bar + kitchen, auto-routed by category
- ✅ Expenses via AI receipt scan + manual entry
- ✅ Shift-based cash reconciliation
- ✅ Staff see own shift report only; admin sees everything
- ✅ KES stored as integer cents to avoid floating-point rounding
- ✅ Auto-clear out-of-stock on restock
- ✅ `.windsurf/rules/pos-system.md` as living architecture doc for AI context
