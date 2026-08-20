import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { database } from '@/lib/db';
import { Device } from '@/lib/db/models';
import { Q } from '@nozbe/watermelondb';

const SECURE_KEY = 'pos_device_id';

/**
 * Returns a stable device fingerprint for this installation.
 * Uses Constants.sessionId which is stable per install in Expo SDK 52.
 */
function getDeviceFingerprint(): string {
  return (
    (Constants as any).sessionId ??
    (Constants as any).installationId ??
    'device-unknown'
  );
}

/**
 * Returns a human-readable default device name based on current date.
 */
function getDefaultDeviceName(): string {
  return `Device ${new Date().toLocaleDateString('en-KE')}`;
}

/**
 * Register-or-get the current device.
 *
 * 1. Check SecureStore for a previously saved device row ID.
 * 2. If found, verify the row still exists in WatermelonDB.
 * 3. If not found or row is gone, look up by fingerprint, then create if needed.
 * 4. Save the row ID to SecureStore and return it.
 *
 * This ID is used as `device_id` on orders and audit_log records so that the
 * Supabase FK constraint `orders.device_id REFERENCES devices(id)` is satisfied.
 */
export async function registerOrGetDevice(): Promise<string> {
  const fingerprint = getDeviceFingerprint();

  // ── 1. Check SecureStore ────────────────────────────────────────────────
  const stored = await SecureStore.getItemAsync(SECURE_KEY).catch(() => null);
  if (stored) {
    // Verify the row still exists
    try {
      await database.get<Device>('devices').find(stored);
      return stored; // still valid
    } catch {
      // Row was deleted or database was wiped — fall through to re-create
    }
  }

  // ── 2. Look up by fingerprint ───────────────────────────────────────────
  const existing = await database
    .get<Device>('devices')
    .query(Q.where('device_fingerprint', fingerprint))
    .fetch();

  if (existing.length > 0) {
    const id = existing[0].id;
    await SecureStore.setItemAsync(SECURE_KEY, id).catch(() => {});
    return id;
  }

  // ── 3. Create a new device row ──────────────────────────────────────────
  const device = await database.write(async () => {
    return database.get<Device>('devices').create((d) => {
      d.name = getDefaultDeviceName();
      d.deviceFingerprint = fingerprint;
      d.isApproved = false; // admin must approve in device management
      d.registeredAt = new Date();
    });
  });

  await SecureStore.setItemAsync(SECURE_KEY, device.id).catch(() => {});
  return device.id;
}
