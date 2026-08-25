import * as SecureStore from 'expo-secure-store';
import { database } from './index';
import { Staff, RestaurantTable } from './models';
import { hashPin } from '../auth/pin';

const SEED_KEY = 'db_seeded_v1';

/**
 * Seed the database with initial data for first run only.
 * Uses an AsyncStorage flag so this never re-runs after the first install,
 * even if the user later deletes all staff or categories.
 * Expense categories are NOT seeded — manage them via the Expenses screen.
 */
export async function seedDatabase() {
  const alreadySeeded = await SecureStore.getItemAsync(SEED_KEY);
  if (alreadySeeded) return;

  const adminPin = await hashPin('1234');

  await database.write(async () => {
    // One default admin so the user can log in on first launch
    await database.get<Staff>('staff').create((s) => {
      s.name = 'Admin';
      s.role = 'admin';
      s.pin = adminPin;
      s.phone = '';
      s.isActive = true;
    });

    // Default restaurant tables
    const tableNames = [
      'Table 1', 'Table 2', 'Table 3', 'Table 4', 'Table 5', 'Table 6',
      'Bar Seat 1', 'Bar Seat 2', 'Bar Seat 3', 'Bar Seat 4',
    ];

    for (const name of tableNames) {
      await database.get<RestaurantTable>('restaurant_tables').create((t) => {
        t.name = name;
        t.status = 'free';
      });
    }
  });

  await SecureStore.setItemAsync(SEED_KEY, 'true');
  console.log('✅ Database seeded');
}
