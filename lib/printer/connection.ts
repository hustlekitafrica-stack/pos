/**
 * Printer connection — Classic Bluetooth SPP (Serial Port Profile)
 *
 * Uses react-native-bluetooth-classic to connect via RFCOMM.
 * No BLE GATT, no UUID discovery, no write-type juggling.
 * ESC/POS bytes stream directly to the printer's serial input.
 */
import { usePrinterStore } from '@/stores/printerStore';

let RNBluetoothClassic: any = null;
try {
  RNBluetoothClassic = require('react-native-bluetooth-classic').default;
} catch (e) {
  console.warn('react-native-bluetooth-classic not available');
}

let barDevice: any = null;
let kitchenDevice: any = null;

export interface PrinterDevice {
  name: string;
  address: string;
}

// ── Scan ─────────────────────────────────────────────────────────────────────

/**
 * Return devices that are already bonded (paired) with this Android phone.
 * Classic BT requires OS-level pairing before an RFCOMM connection can open.
 * New unpaired devices must first be paired in Android Settings → Bluetooth.
 */
export async function scanForPrinters(): Promise<PrinterDevice[]> {
  if (!RNBluetoothClassic) return [];
  try {
    const bonded = await RNBluetoothClassic.getBondedDevices();
    return (bonded ?? []).map((d: any) => ({ name: d.name ?? d.address, address: d.address }));
  } catch (e) {
    console.warn('getBondedDevices failed:', e);
    return [];
  }
}

// ── Connect ───────────────────────────────────────────────────────────────────

async function openRfcomm(address: string): Promise<any> {
  if (!RNBluetoothClassic) throw new Error('Bluetooth Classic not available');
  // connect() opens an RFCOMM socket using the SPP service UUID automatically
  const device = await RNBluetoothClassic.connectToDevice(address);
  return device;
}

export async function connectBarPrinter(address: string): Promise<boolean> {
  try {
    if (barDevice) {
      try { await barDevice.disconnect(); } catch {}
      barDevice = null;
    }
    barDevice = await openRfcomm(address);
    usePrinterStore.getState().setBarPrinter(address, true);

    // Monitor disconnection
    barDevice.onDisconnected?.(() => {
      barDevice = null;
      usePrinterStore.getState().setBarPrinter(address, false);
    });

    return true;
  } catch (e) {
    console.warn('Bar printer connect failed:', e);
    usePrinterStore.getState().setBarPrinter(address, false);
    return false;
  }
}

export async function connectKitchenPrinter(address: string): Promise<boolean> {
  try {
    if (kitchenDevice) {
      try { await kitchenDevice.disconnect(); } catch {}
      kitchenDevice = null;
    }
    kitchenDevice = await openRfcomm(address);
    usePrinterStore.getState().setKitchenPrinter(address, true);

    kitchenDevice.onDisconnected?.(() => {
      kitchenDevice = null;
      usePrinterStore.getState().setKitchenPrinter(address, false);
    });

    return true;
  } catch (e) {
    console.warn('Kitchen printer connect failed:', e);
    usePrinterStore.getState().setKitchenPrinter(address, false);
    return false;
  }
}

// ── Disconnect ────────────────────────────────────────────────────────────────

export async function disconnectBarPrinter(): Promise<void> {
  const saved = usePrinterStore.getState().barPrinterAddress;
  if (barDevice) {
    try { await barDevice.disconnect(); } catch {}
    barDevice = null;
  }
  usePrinterStore.getState().setBarPrinter(saved, false);
}

export async function disconnectKitchenPrinter(): Promise<void> {
  const saved = usePrinterStore.getState().kitchenPrinterAddress;
  if (kitchenDevice) {
    try { await kitchenDevice.disconnect(); } catch {}
    kitchenDevice = null;
  }
  usePrinterStore.getState().setKitchenPrinter(saved, false);
}

// ── Auto-reconnect ────────────────────────────────────────────────────────────

async function getConnectedDevice(): Promise<any | null> {
  // Return whichever slot is live
  if (barDevice) {
    try {
      const ok = await barDevice.isConnected();
      if (ok) return barDevice;
    } catch {}
    barDevice = null;
  }
  if (kitchenDevice) {
    try {
      const ok = await kitchenDevice.isConnected();
      if (ok) return kitchenDevice;
    } catch {}
    kitchenDevice = null;
  }

  // Auto-reconnect from saved address
  const store = usePrinterStore.getState();
  const addr = store.barPrinterAddress ?? store.kitchenPrinterAddress;
  if (!addr) return null;

  console.log('Printer not connected — auto-reconnecting to', addr);
  const ok = await connectBarPrinter(addr);
  return ok ? barDevice : null;
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Send raw ESC/POS bytes to the printer via Classic BT RFCOMM.
 * @returns true on success, false if no printer or write failed
 */
export async function sendToPrinter(target: 'bar' | 'kitchen', data: Uint8Array): Promise<boolean> {
  const device = await getConnectedDevice();
  if (!device) {
    console.warn('sendToPrinter: no printer connected');
    return false;
  }

  try {
    // react-native-bluetooth-classic accepts a Buffer / Uint8Array or base64 string
    await device.write(data);
    return true;
  } catch (e) {
    console.warn(`Print (${target}) failed:`, e);
    return false;
  }
}

// ── Test print ────────────────────────────────────────────────────────────────

/**
 * Send a short test page. Returns 'ok', 'not_connected', or 'write_failed'.
 */
export async function testPrint(): Promise<'ok' | 'not_connected' | 'write_failed'> {
  const device = await getConnectedDevice();
  if (!device) return 'not_connected';

  const text =
    '\x1b\x40' +             // ESC @ — initialize printer
    '\x1b\x61\x01' +         // center align
    '*** TEST PRINT ***\n' +
    'Printer connected OK\n' +
    '\n\n\n';

  try {
    await device.write(new TextEncoder().encode(text));
    return 'ok';
  } catch (e) {
    console.warn('testPrint failed:', e);
    return 'write_failed';
  }
}
