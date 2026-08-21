import { synchronize } from '@nozbe/watermelondb/sync';
import { database } from './index';
import { supabase as _supabase } from '../supabase';
const supabase = _supabase!;
import { SUPABASE_CONFIG } from '@/constants/config';

// Tables must be listed in FK-dependency order so that when data is pushed
// to Supabase, parent rows always exist before child rows that reference them.
//   staff / devices / categories / expense_categories / customers / restaurant_tables
//     → products (needs categories)
//     → shifts (needs staff)
//     → orders (needs staff, devices, shifts, restaurant_tables, customers)
//       → order_items (needs orders, products)
//       → payments (needs orders)
//         → refunds (needs payments)
//       → credit_transactions (needs customers, orders)
//     → stock_adjustments (needs products, staff)
//     → expenses (needs expense_categories)
//     → audit_log (needs staff, devices)
//     → settings (no deps)
const SYNC_TABLES = [
  'staff', 'devices', 'categories', 'expense_categories', 'customers',
  'restaurant_tables', 'products', 'shifts', 'orders', 'order_items',
  'payments', 'refunds', 'credit_transactions', 'stock_adjustments',
  'expenses', 'audit_log', 'settings',
];

// Timestamp columns that WatermelonDB stores as Unix ms but Supabase stores as timestamptz
const TS_COLUMNS = ['created_at', 'updated_at', 'opened_at', 'closed_at', 'paid_at', 'registered_at', 'approved_at'];

/**
 * Convert WatermelonDB raw records (number timestamps) → Supabase-ready format (ISO strings).
 * Also:
 * - Strips WatermelonDB internal fields (_status, _changed) that PostgREST rejects
 *   as unknown columns (PostgREST v12+ returns an error for unrecognised column names).
 * - Converts audit_log.details from a JSON string to a parsed object (jsonb storage).
 */
function toSupabase(records: any[]): any[] {
  return records.map((r) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _status, _changed, ...out } = r as any;
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

export type TablePushResult = {
  table: string;
  count: number;
  ok: boolean;
  error?: string;
};

/**
 * Direct push: reads EVERY record from every local WatermelonDB table and
 * upserts it to Supabase. Does NOT use WatermelonDB's sync protocol — it is
 * completely independent so it always retries everything regardless of prior
 * sync state. Returns a per-table result list with counts and any error text.
 */
export async function pushAllToSupabase(): Promise<TablePushResult[]> {
  if (!SUPABASE_CONFIG.url || !SUPABASE_CONFIG.anonKey) {
    return [{ table: 'connection', count: 0, ok: false, error: 'Supabase URL / key not configured in .env' }];
  }

  // Quick connectivity check before doing anything
  const { error: pingErr } = await supabase.from('staff').select('id').limit(1);
  if (pingErr) {
    return [{ table: 'connection', count: 0, ok: false, error: `Cannot reach Supabase: ${pingErr.message}` }];
  }

  const results: TablePushResult[] = [];

  for (const table of SYNC_TABLES) {
    try {
      const collection = (database as any).get(table);
      const records = await collection.query().fetch();

      if (records.length === 0) {
        results.push({ table, count: 0, ok: true });
        continue;
      }

      // Access raw SQLite row, strip WatermelonDB internals, convert timestamps
      const rawRecords = toSupabase(
        records.map((r: any) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { _status, _changed, ...raw } = r._raw as any;
          return raw;
        })
      );

      const { error } = await supabase.from(table).upsert(rawRecords, { onConflict: 'id' });
      if (error) {
        results.push({ table, count: rawRecords.length, ok: false, error: error.message });
      } else {
        results.push({ table, count: rawRecords.length, ok: true });
      }
    } catch (e: any) {
      results.push({ table, count: 0, ok: false, error: e?.message ?? String(e) });
    }
  }

  return results;
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

// ─── Auto-sync on write ──────────────────────────────────────────────────────

let _syncTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Fire-and-forget debounced sync. Call after any local write.
 * Collapses rapid consecutive writes into a single sync 2 s later.
 */
export function triggerAutoSync(): void {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    syncDatabase().catch(() => {});
    _syncTimer = null;
  }, 2000);
}
