import { Role } from '@/types';

export const ROLES: Record<Role, { label: string; description: string }> = {
  admin: {
    label: 'Admin/Owner',
    description: 'Full access including staff management, credit customers, and all reports',
  },
  manager: {
    label: 'Manager',
    description: 'Full access to reports, menu editing, expenses, and stock',
  },
  stock_manager: {
    label: 'Stock Manager',
    description: 'Manages stock levels, logs expenses, no access to sales data',
  },
  cashier: {
    label: 'Cashier',
    description: 'Counter/till — takes orders, accepts payments, views own shift report',
  },
  bartender: {
    label: 'Bartender',
    description: 'Takes bar orders, accepts payments, views own shift report',
  },
  waiter: {
    label: 'Waiter',
    description: 'Floor/table service — takes orders, accepts payments, views own shift report',
  },
};

export const PERMISSIONS = {
  viewAllReports: ['admin', 'manager'] as Role[],
  editMenu: ['admin', 'manager'] as Role[],
  manageStaff: ['admin'] as Role[],
  manageExpenses: ['admin', 'manager', 'stock_manager'] as Role[],
  adjustStock: ['admin', 'manager', 'stock_manager'] as Role[],
  markOutOfStock: ['admin', 'manager', 'stock_manager'] as Role[],
  viewInventory: ['admin', 'manager', 'stock_manager', 'bartender'] as Role[],
  adjustBarStock: ['admin', 'manager', 'bartender'] as Role[],
  adjustKitchenStock: ['admin', 'manager', 'stock_manager'] as Role[],
  takeOrders: ['admin', 'manager', 'cashier', 'bartender', 'waiter'] as Role[],
  acceptPayments: ['admin', 'manager', 'cashier', 'bartender', 'waiter'] as Role[],
  viewOwnShiftReport: ['admin', 'manager', 'cashier', 'bartender', 'waiter'] as Role[],
  manageCreditCustomers: ['admin'] as Role[],
  recordCreditRepayments: ['admin'] as Role[],
  viewDebtors: ['admin'] as Role[],
  selectCreditCustomerAtCheckout: ['admin', 'manager', 'cashier', 'bartender', 'waiter'] as Role[],
  approveDevices: ['admin'] as Role[],
  voidItems: ['admin', 'manager', 'cashier', 'bartender', 'waiter'] as Role[],
  applyDiscount: ['admin', 'manager'] as Role[],
  processRefund: ['admin', 'manager'] as Role[],
  viewAuditLog: ['admin'] as Role[],
};

export function hasPermission(role: Role, permission: keyof typeof PERMISSIONS): boolean {
  return PERMISSIONS[permission].includes(role);
}
