import { create } from 'zustand';

interface PrinterState {
  barPrinterConnected: boolean;
  kitchenPrinterConnected: boolean;
  barPrinterAddress: string | null;
  kitchenPrinterAddress: string | null;
  setBarPrinter: (address: string | null, connected: boolean) => void;
  setKitchenPrinter: (address: string | null, connected: boolean) => void;
}

export const usePrinterStore = create<PrinterState>((set) => ({
  barPrinterConnected: false,
  kitchenPrinterConnected: false,
  barPrinterAddress: null,
  kitchenPrinterAddress: null,

  setBarPrinter: (address, connected) => {
    set({ barPrinterAddress: address, barPrinterConnected: connected });
  },

  setKitchenPrinter: (address, connected) => {
    set({ kitchenPrinterAddress: address, kitchenPrinterConnected: connected });
  },
}));
