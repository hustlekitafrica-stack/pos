import { synchronize } from '@nozbe/watermelondb/sync';
import { database } from './index';
import { supabase } from '../supabase';
import { SUPABASE_CONFIG } from '@/constants/config';

const SYNC_TABLES = [
  'staff', 'devices', 'categories', 'products', 'stock_adjustments',
  'restaurant_tables', 'orders', 'order_items', 'payments', 'refunds',
  'customers', 'credit_transactions', 'expense_categories', 'expenses',
  'shifts', 'audit_log',
];

/**
 * Sync local WatermelonDB with Supabase.
 * Skips silently if Supabase is not configured or offline.
 */
export async function syncDatabase() {
  if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
    console.log('Supabase not configured, skipping sync');
    return;
  }

  try {
    await synchronize({
      database,
      pullChanges: async ({ lastPulledAt }) => {
        const timestamp = lastPulledAt ?? 0;
        const changes: Record<string, { created: any[]; updated: any[]; deleted: string[] }> = {};

        for (const table of SYNC_TABLES) {
          const { data: created, error: createErr } = await supabase
            .from(table)
            .select('*')
            .gt('created_at', new Date(timestamp).toISOString())
            .order('created_at', { ascending: true });

          const { data: updated, error: updateErr } = await supabase
            .from(table)
            .select('*')
            .gt('updated_at', new Date(timestamp).toISOString())
            .lte('created_at', new Date(timestamp).toISOString())
            .order('updated_at', { ascending: true });

          changes[table] = {
            created: created || [],
            updated: updated || [],
            deleted: [],
          };
        }

        return { changes, timestamp: Date.now() };
      },
      pushChanges: async ({ changes }) => {
        for (const table of SYNC_TABLES) {
          const tableChanges = (changes as any)[table];
          if (!tableChanges) continue;

          if (tableChanges.created?.length > 0) {
            await supabase.from(table).upsert(tableChanges.created);
          }
          if (tableChanges.updated?.length > 0) {
            await supabase.from(table).upsert(tableChanges.updated);
          }
          if (tableChanges.deleted?.length > 0) {
            await supabase.from(table).delete().in('id', tableChanges.deleted);
          }
        }
      },
      migrationsEnabledAtVersion: 1,
    });
    console.log('✅ Sync complete');
  } catch (error) {
    console.warn('Sync failed (offline?):', error);
  }
}
