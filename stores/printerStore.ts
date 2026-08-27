import { create } from 'zustand';
import { database } from '@/lib/db';
import { Settings } from '@/lib/db/models';

const SETTINGS_ID = 'global';

interface PrinterState {
  printerConnected: boolean;
  printerAddress: string | null;
  setPrinter: (address: string | null, connected: boolean) => void;
  loadSavedAddress: () => Promise<string | null>;
}

async function persistPrinterAddress(address: string | null): Promise<void> {
  try {
    let row: Settings;
    try {
      row = await database.get<Settings>('settings').find(SETTINGS_ID);
    } catch {
      row = await database.write(async () => {
        return database.get<Settings>('settings').create((s) => {
          (s as any)._raw.id = SETTINGS_ID;
          s.alertEmail = '';
          s.logoUrl = null;
          s.printerAddress = null;
          s.venueName = 'Bar POS';
        });
      });
    }
    await database.write(async () => {
      await row.update((s) => {
        s.printerAddress = address;
      });
    });
  } catch (e) {
    console.warn('persistPrinterAddress error:', e);
  }
}

export const usePrinterStore = create<PrinterState>((set) => ({
  printerConnected: false,
  printerAddress: null,

  setPrinter: (address, connected) => {
    set({ printerAddress: address, printerConnected: connected });
    persistPrinterAddress(address);
  },

  loadSavedAddress: async () => {
    try {
      const row = await database.get<Settings>('settings').find(SETTINGS_ID);
      const address = row.printerAddress ?? null;
      set({ printerAddress: address });
      return address;
    } catch {
      return null;
    }
  },
}));
