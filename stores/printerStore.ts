import { create } from 'zustand';
import { database } from '@/lib/db';
import { Settings } from '@/lib/db/models';

const SETTINGS_ID = 'global';

interface PrinterState {
  barPrinterConnected: boolean;
  kitchenPrinterConnected: boolean;
  barPrinterAddress: string | null;
  kitchenPrinterAddress: string | null;
  setBarPrinter: (address: string | null, connected: boolean) => void;
  setKitchenPrinter: (address: string | null, connected: boolean) => void;
  loadSavedAddresses: () => Promise<{ bar: string | null; kitchen: string | null }>;
}

// ── Helper: update the global settings row with printer addresses ─────────────

async function persistPrinterAddress(
  field: 'barPrinterAddress' | 'kitchenPrinterAddress',
  address: string | null
): Promise<void> {
  try {
    let row: Settings;
    try {
      row = await database.get<Settings>('settings').find(SETTINGS_ID);
    } catch {
      // Row doesn't exist yet — create it
      row = await database.write(async () => {
        return database.get<Settings>('settings').create((s) => {
          (s as any)._raw.id = SETTINGS_ID;
          s.alertEmail = '';
          s.logoUrl = null;
          s.barPrinterAddress = null;
          s.kitchenPrinterAddress = null;
          s.venueName = 'Bar POS';
        });
      });
    }
    await database.write(async () => {
      await row.update((s) => {
        if (field === 'barPrinterAddress') s.barPrinterAddress = address;
        if (field === 'kitchenPrinterAddress') s.kitchenPrinterAddress = address;
      });
    });
  } catch (e) {
    console.warn('persistPrinterAddress error:', e);
  }
}

export const usePrinterStore = create<PrinterState>((set) => ({
  barPrinterConnected: false,
  kitchenPrinterConnected: false,
  barPrinterAddress: null,
  kitchenPrinterAddress: null,

  setBarPrinter: (address, connected) => {
    set({ barPrinterAddress: address, barPrinterConnected: connected });
    persistPrinterAddress('barPrinterAddress', address);
  },

  setKitchenPrinter: (address, connected) => {
    set({ kitchenPrinterAddress: address, kitchenPrinterConnected: connected });
    persistPrinterAddress('kitchenPrinterAddress', address);
  },

  loadSavedAddresses: async () => {
    try {
      const row = await database.get<Settings>('settings').find(SETTINGS_ID);
      const bar = row.barPrinterAddress ?? null;
      const kitchen = row.kitchenPrinterAddress ?? null;
      // Populate the store with saved addresses (not connected yet — BLE reconnect is manual)
      set({ barPrinterAddress: bar, kitchenPrinterAddress: kitchen });
      return { bar, kitchen };
    } catch {
      return { bar: null, kitchen: null };
    }
  },
}));
