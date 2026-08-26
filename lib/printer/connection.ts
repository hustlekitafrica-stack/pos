import { usePrinterStore } from '@/stores/printerStore';
import { Platform, PermissionsAndroid } from 'react-native';

let BleManager: any = null;
try {
  BleManager = require('react-native-ble-plx').BleManager;
} catch (e) {
  console.warn('react-native-ble-plx not available, printer functions will be no-ops');
}

let manager: any = null;
let barPeripheral: any = null;
let kitchenPeripheral: any = null;
let barMtu = 20;      // negotiated MTU payload size for bar printer
let kitchenMtu = 20;  // negotiated MTU payload size for kitchen printer

// Keep subscription references alive to prevent garbage collection
let barDisconnectSub: any = null;
let kitchenDisconnectSub: any = null;

const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const PRINTER_CHAR_UUID    = '00002af1-0000-1000-8000-00805f9b34fb';

function getManager() {
  if (!manager && BleManager) {
    manager = new BleManager();
  }
  return manager;
}

export interface PrinterDevice {
  name: string;
  address: string;
}

async function requestPermissions(): Promise<boolean> {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    return Object.values(granted).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  }
  return true;
}

export async function scanForPrinters(timeoutMs = 5000): Promise<PrinterDevice[]> {
  const mgr = getManager();
  if (!mgr) return [];

  const permOk = await requestPermissions();
  if (!permOk) return [];

  const devices: PrinterDevice[] = [];
  const seen = new Set<string>();

  return new Promise((resolve) => {
    mgr.startDeviceScan(null, null, (error: any, device: any) => {
      if (error) return;
      if (!device?.name) return;
      const addr = device.id;
      if (seen.has(addr)) return;
      seen.add(addr);
      devices.push({ name: device.name, address: addr });
    });

    setTimeout(() => {
      mgr.stopDeviceScan();
      resolve(devices);
    }, timeoutMs);
  });
}

async function connectToDevice(address: string): Promise<{ device: any; mtu: number }> {
  const mgr = getManager();
  if (!mgr) throw new Error('BLE not available');

  const device = await mgr.connectToDevice(address);
  await device.discoverAllServicesAndCharacteristics();

  // Negotiate the largest MTU the printer supports (up to 512).
  // Subtract 3 bytes for the ATT protocol header to get usable payload size.
  let mtu = 20;
  try {
    const negotiated = await device.requestMTU(512);
    mtu = Math.max(20, negotiated - 3);
  } catch {
    // Device doesn't support MTU negotiation — stay at safe 20-byte default
  }

  return { device, mtu };
}

export async function connectBarPrinter(address: string): Promise<boolean> {
  try {
    const { device, mtu } = await connectToDevice(address);
    barPeripheral = device;
    barMtu = mtu;

    // Remove any previous subscription before creating a new one
    if (barDisconnectSub) { try { barDisconnectSub.remove(); } catch {} }
    barDisconnectSub = device.onDisconnected(() => {
      barPeripheral = null;
      barMtu = 20;
      barDisconnectSub = null;
      usePrinterStore.getState().setBarPrinter(address, false);
    });

    usePrinterStore.getState().setBarPrinter(address, true);
    return true;
  } catch (e) {
    console.warn('Bar printer connection failed:', e);
    return false;
  }
}

export async function connectKitchenPrinter(address: string): Promise<boolean> {
  try {
    const { device, mtu } = await connectToDevice(address);
    kitchenPeripheral = device;
    kitchenMtu = mtu;

    if (kitchenDisconnectSub) { try { kitchenDisconnectSub.remove(); } catch {} }
    kitchenDisconnectSub = device.onDisconnected(() => {
      kitchenPeripheral = null;
      kitchenMtu = 20;
      kitchenDisconnectSub = null;
      usePrinterStore.getState().setKitchenPrinter(address, false);
    });

    usePrinterStore.getState().setKitchenPrinter(address, true);
    return true;
  } catch (e) {
    console.warn('Kitchen printer connection failed:', e);
    return false;
  }
}

export async function disconnectBarPrinter(): Promise<void> {
  const store = usePrinterStore.getState();
  const savedAddress = store.barPrinterAddress; // preserve address for re-connect
  if (barDisconnectSub) { try { barDisconnectSub.remove(); } catch {} barDisconnectSub = null; }
  if (barPeripheral) {
    try { await barPeripheral.cancelConnection(); } catch {}
    barPeripheral = null;
    barMtu = 20;
  }
  store.setBarPrinter(savedAddress, false);
}

export async function disconnectKitchenPrinter(): Promise<void> {
  const store = usePrinterStore.getState();
  const savedAddress = store.kitchenPrinterAddress; // preserve address for re-connect
  if (kitchenDisconnectSub) { try { kitchenDisconnectSub.remove(); } catch {} kitchenDisconnectSub = null; }
  if (kitchenPeripheral) {
    try { await kitchenPeripheral.cancelConnection(); } catch {}
    kitchenPeripheral = null;
    kitchenMtu = 20;
  }
  store.setKitchenPrinter(savedAddress, false);
}

/**
 * Ensure a printer is connected, auto-reconnecting if needed.
 * Returns the device + chunk size, or null if unavailable.
 */
async function getConnectedDevice(): Promise<{ device: any; chunkSz: number } | null> {
  // Use whichever peripheral is currently live
  if (barPeripheral)     return { device: barPeripheral,     chunkSz: barMtu };
  if (kitchenPeripheral) return { device: kitchenPeripheral, chunkSz: kitchenMtu };

  // Nothing connected — try to auto-reconnect using the saved address
  const store = usePrinterStore.getState();
  const savedAddress = store.barPrinterAddress ?? store.kitchenPrinterAddress;
  if (!savedAddress) return null;

  console.log('Printer disconnected — attempting auto-reconnect to', savedAddress);
  const reconnected = await connectBarPrinter(savedAddress);
  if (reconnected && barPeripheral) {
    return { device: barPeripheral, chunkSz: barMtu };
  }

  return null;
}

/**
 * Send raw ESC/POS bytes to a connected printer.
 * Auto-reconnects if the BLE link dropped since last use.
 * @param target 'bar' or 'kitchen'  (falls back to whichever is connected)
 * @param data ESC/POS command buffer as Uint8Array
 * @returns true on success, false if no printer could be reached
 */
export async function sendToPrinter(target: 'bar' | 'kitchen', data: Uint8Array): Promise<boolean> {
  const conn = await getConnectedDevice();
  if (!conn) {
    console.warn('sendToPrinter: no printer connected and auto-reconnect failed');
    return false;
  }
  const { device, chunkSz } = conn;

  try {
    // Send data in MTU-sized chunks so we never exceed the BLE payload limit.
    // A 10 ms pause between chunks prevents overflowing the printer's receive buffer.
    for (let offset = 0; offset < data.length; offset += chunkSz) {
      const chunk  = data.slice(offset, offset + chunkSz);
      const base64 = uint8ToBase64(chunk);
      await device.writeCharacteristicWithoutResponseForService(
        PRINTER_SERVICE_UUID,
        PRINTER_CHAR_UUID,
        base64
      );
      if (offset + chunkSz < data.length) {
        await new Promise<void>((r) => setTimeout(r, 10));
      }
    }
    return true;
  } catch (e) {
    console.warn(`Print to ${target} failed:`, e);
    return false;
  }
}

/**
 * Send a short test string to the connected printer.
 * Use this from Settings to verify the printer is reachable and responding.
 * @returns 'ok' | 'not_connected' | 'write_failed'
 */
export async function testPrint(): Promise<'ok' | 'not_connected' | 'write_failed'> {
  const conn = await getConnectedDevice();
  if (!conn) return 'not_connected';

  const text = '\x1b\x61\x01' +   // center
               '** TEST PRINT **\n' +
               'Printer is working!\n' +
               '\n\n\n';
  const data = new TextEncoder().encode(text);
  const ok = await sendToPrinter('bar', data);
  return ok ? 'ok' : 'write_failed';
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
