import { create } from 'zustand';

interface DeviceState {
  deviceId: string | null;
  setDeviceId: (id: string) => void;
}

/**
 * Holds the WatermelonDB `devices` row ID for the current device.
 * Populated on app startup via `registerOrGetDevice()` in app/_layout.tsx.
 * Used as `device_id` on orders and audit_log records so the Supabase FK is satisfied.
 */
export const useDeviceStore = create<DeviceState>((set) => ({
  deviceId: null,
  setDeviceId: (id) => set({ deviceId: id }),
}));
