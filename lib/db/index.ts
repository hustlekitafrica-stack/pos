import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { schema } from './schema';
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
} from './models';

const adapter = new SQLiteAdapter({
  schema,
  jsi: true,
  onSetUpError: (error) => {
    console.error('WatermelonDB setup error:', error);
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
  ],
});
