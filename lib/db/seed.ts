import * as SecureStore from 'expo-secure-store';
import { database } from './index';
import { Staff } from './models';
import { hashPin } from '../auth/pin';

const SEED_KEY = 'db_seeded_v1';

/**
 * Creates one default Admin account on the very first install.
 * Uses a SecureStore flag so it never re-runs, even after the user
 * deletes or renames the admin.
 * Default login: PIN 1234 — change it via Settings → Staff.
 */
export async function seedDatabase() {
  const alreadySeeded = await SecureStore.getItemAsync(SEED_KEY);
  if (alreadySeeded) return;

  const adminPin = await hashPin('1234');
  await database.write(async () => {
    await database.get<Staff>('staff').create((s) => {
      s.name = 'Admin';
      s.role = 'admin';
      s.pin = adminPin;
      s.phone = '';
      s.isActive = true;
    });
  });

  await SecureStore.setItemAsync(SEED_KEY, 'true');
  console.log('✅ Database seeded');
}
