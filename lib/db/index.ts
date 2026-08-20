import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from './schema';
import { migrations } from './migrations';
import {
  Staff,
  Device,
  Category,
  Product,
  StockAdjustment,
  RestaurantTable,
  Order,
  OrderItem,
  Payment,
  Refund,
  Customer,
  CreditTransaction,
  ExpenseCategory,
  Expense,
  Shift,
  AuditLog,
  Settings,
} from './models';

// Native (Android / iOS): SQLite adapter
// Web uses lib/db/index.web.ts (LokiJS) picked automatically by Metro
const adapter = new SQLiteAdapter({
  schema,
  migrations,
  jsi: false,
  onSetUpError: (error) => {
    console.error('WatermelonDB (SQLite) setup error:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [
    Staff,
    Device,
    Category,
    Product,
    StockAdjustment,
    RestaurantTable,
    Order,
    OrderItem,
    Payment,
    Refund,
    Customer,
    CreditTransaction,
    ExpenseCategory,
    Expense,
    Shift,
    AuditLog,
    Settings,
  ],
});
