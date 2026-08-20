import { synchronize } from '@nozbe/watermelondb/sync';
import { database } from './index';
import { supabase as _supabase } from '../supabase';
const supabase = _supabase!;
import { SUPABASE_CONFIG } from '@/constants/config';

const SYNC_TABLES = [
  'staff', 'devices', 'categories', 'products', 'stock_adjustments',
  'restaurant_tables', 'orders', 'order_items', 'payments', 'refunds',
  'customers', 'credit_transactions', 'expense_categories', 'expenses',
  'shifts', 'audit_log', 'settings',
];

// Timestamp columns that WatermelonDB stores as Unix ms but Supabase stores as timestamptz
const TS_COLUMNS = ['created_at', 'updated_at', 'opened_at', 'closed_at', 'paid_at', 'registered_at', 'approved_at'];

/**
 * Convert WatermelonDB raw records (number timestamps) → Supabase-ready format (ISO strings).
 * Also converts audit_log.details from a JSON string to an object (for jsonb storage).
 */
function toSupabase(records: any[]): any[] {
  return records.map((r) => {
    const out = { ...r };
    for (const col of TS_COLUMNS) {
      if (out[col] != null) {
        out[col] = new Date(out[col] as number).toISOString();
      }
    }
    // audit_log.details is stored as a JSON string in WatermelonDB but must be
    // sent as a parsed object so Supabase stores it as jsonb (not a text literal).
    if (out['details'] != null && typeof out['details'] === 'string') {
      try { out['details'] = JSON.parse(out['details']); } catch {}
    }
    return out;
  });
}

/**
 * Convert Supabase records (ISO string timestamps) → WatermelonDB-ready format (Unix ms).
 * Also converts audit_log.details from a jsonb object back to a JSON string.
 */
function fromSupabase(records: any[]): any[] {
  return records.map((r) => {
    const out = { ...r };
    for (const col of TS_COLUMNS) {
      if (out[col] != null) {
        out[col] = new Date(out[col] as string).getTime();
      }
    }
    // audit_log.details comes back from Supabase as a parsed object (jsonb).
    // WatermelonDB only supports string fields, so stringify it back.
    if (out['details'] != null && typeof out['details'] === 'object') {
      out['details'] = JSON.stringify(out['details']);
    }
    return out;
  });
}

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

          if (createErr) throw new Error(`Pull ${table} created: ${createErr.message}`);

          const { data: updated, error: updateErr } = await supabase
            .from(table)
            .select('*')
            .gt('updated_at', new Date(timestamp).toISOString())
            .lte('created_at', new Date(timestamp).toISOString())
            .order('updated_at', { ascending: true });

          if (updateErr) throw new Error(`Pull ${table} updated: ${updateErr.message}`);

          changes[table] = {
            created: fromSupabase(created || []),
            updated: fromSupabase(updated || []),
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
            const { error } = await supabase.from(table).upsert(toSupabase(tableChanges.created));
            if (error) throw new Error(`Push ${table} created: ${error.message}`);
          }
          if (tableChanges.updated?.length > 0) {
            const { error } = await supabase.from(table).upsert(toSupabase(tableChanges.updated));
            if (error) throw new Error(`Push ${table} updated: ${error.message}`);
          }
          if (tableChanges.deleted?.length > 0) {
            const { error } = await supabase.from(table).delete().in('id', tableChanges.deleted);
            if (error) throw new Error(`Push ${table} deleted: ${error.message}`);
          }
        }
      },
      migrationsEnabledAtVersion: 1,
    });
    console.log('✅ Sync complete');
  } catch (error) {
    console.warn('Sync failed:', error);
    throw error;
  }
}
