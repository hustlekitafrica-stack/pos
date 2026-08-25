import * as SecureStore from 'expo-secure-store';

const SEED_KEY = 'db_seeded_v1';

/**
 * No-op after the first launch — just marks the device as initialised.
 * All real data (staff, categories, etc.) comes from Supabase via sync.
 * Nothing is auto-created so hardcoded demo records never reappear.
 */
export async function seedDatabase() {
  const alreadySeeded = await SecureStore.getItemAsync(SEED_KEY);
  if (alreadySeeded) return;
  await SecureStore.setItemAsync(SEED_KEY, 'true');
  console.log('✅ Database initialised');
}
