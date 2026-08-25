export const APP_CONFIG = {
  name: 'Bar POS',
  version: '1.0.0',
  currency: 'KES',
  sessionTimeoutMinutes: 15,
  defaultLowStockThreshold: 5,
};

export const SUPABASE_CONFIG = {
  url: process.env.EXPO_PUBLIC_SUPABASE_URL || '',
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '',
};

export const ORDER_STATUSES = ['open', 'sent', 'served', 'paid', 'closed', 'voided'] as const;

export const TABLE_STATUSES = ['free', 'open', 'awaiting_payment'] as const;

export const PAYMENT_METHODS = ['cash', 'mpesa', 'card', 'credit', 'other'] as const;
