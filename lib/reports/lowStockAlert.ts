import { supabase } from '../supabase';
import { getLowStockItems } from './aggregate';
import { database } from '../db';
import { Product } from '../db/models';

/**
 * Check for low-stock items and trigger an alert email
 * via Supabase Edge Function.
 *
 * Call this periodically (e.g. on shift close or daily).
 */
export async function triggerLowStockAlerts(): Promise<{ sent: number }> {
  const lowItems = await getLowStockItems();

  // Filter to only items that haven't already been alerted
  const unalerted: typeof lowItems = [];
  for (const item of lowItems) {
    const prod = await database.get<Product>('products').find(item.productId);
    if (!prod.lowStockAlertSent) {
      unalerted.push(item);
    }
  }

  if (unalerted.length === 0) return { sent: 0 };

  try {
    const { error } = await supabase.functions.invoke('low-stock-alert', {
      body: {
        items: unalerted.map((i) => ({
          name: i.name,
          category: i.category,
          currentStock: i.stockQty,
          threshold: i.threshold,
          unit: i.unit,
        })),
      },
    });

    if (!error) {
      // Mark items as alerted
      await database.write(async () => {
        for (const item of unalerted) {
          const prod = await database.get<Product>('products').find(item.productId);
          await prod.update((p) => {
            p.lowStockAlertSent = true;
          });
        }
      });
    }

    return { sent: unalerted.length };
  } catch (e) {
    console.warn('Low stock alert failed:', e);
    return { sent: 0 };
  }
}
