import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
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

// Web build: LokiJS adapter persists to IndexedDB in the browser
const adapter = new LokiJSAdapter({
  schema,
  useWebWorker: false,
  useIncrementalIndexedDB: true,
  onSetUpError: (error: Error) => {
    console.error('WatermelonDB (LokiJS) setup error:', error);
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
