/**
 * Printer connection — BLE GATT
 *
 * Uses react-native-ble-plx to connect to the thermal printer.
 * Profile order:
 *   1. 0x18F0 / 0x2AF1 — standard BLE ESC/POS service (primary)
 *      Subscribes to 0x2AF0 NOTIFY to activate the print data path.
 *   2. e7810a71 / bef8d6c9 — vendor service (fallback)
 *   3. ISSC Transparent UART — fallback, subscribes to TX notify
 */
import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import { usePrinterStore } from '@/stores/printerStore';

// ─── Printer profiles ──────────────────────────────────────────────────────
// Tried in order. First profile whose write characteristic is found on the
// device is used. txNotifyChar (when set) is subscribed to before any write —
// this activates the data path on ISSC and 0x18F0 type firmware.
const PRINTER_PROFILES = [
  {
    label:        'Standard 0x18F0/0x2AF1',
    service:      '000018f0-0000-1000-8000-00805f9b34fb',
    char:         '00002af1-0000-1000-8000-00805f9b34fb',
    txNotifyChar: '00002af0-0000-1000-8000-00805f9b34fb', // subscribe to activate print path
  },
  {
    label:   'Vendor e7810a71',
    service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    char:    'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  },
  {
    label:        'ISSC Transparent UART',
    service:      '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    char:         '49535343-8841-43f4-a8d4-ecbe34729bb3',
    txNotifyChar: '49535343-1e4d-4bd9-ba61-23c647249616',
  },
] as const;

// ─── Singleton BLE manager ──────────────────────────────────────────────────
let manager: BleManager | null = null;

function getManager(): BleManager | null {
  if (!BleManager) return null;
  if (!manager) manager = new BleManager();
  return manager;
}

// ─── Permissions ────────────────────────────────────────────────────────────
async function requestPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const sdk = typeof Platform.Version === 'number' ? Platform.Version : parseInt(Platform.Version, 10);
  if (sdk >= 31) {
    const granted = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    ]);
    return Object.values(granted).every((v) => v === PermissionsAndroid.RESULTS.GRANTED);
  }
  const loc = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
  return loc === PermissionsAndroid.RESULTS.GRANTED;
}

// ─── State ──────────────────────────────────────────────────────────────────
export interface PrinterDevice {
  name: string;
  address: string;
}

let barPeripheral:    any    = null;
let kitchenPeripheral: any   = null;
let barServiceUuid:   string | null = null;
let barCharUuid:      string | null = null;
let kitchenServiceUuid: string | null = null;
let kitchenCharUuid:  string | null = null;
let barMtu  = 20;
let kitchenMtu = 20;
let barDisconnectSub: any    = null;
let kitchenDisconnectSub: any = null;

// ─── Scan ────────────────────────────────────────────────────────────────────
export async function scanForPrinters(timeoutMs = 5000): Promise<PrinterDevice[]> {
  const mgr = getManager();
  if (!mgr) return [];
  const ok = await requestPermissions();
  if (!ok) return [];

  const devices: PrinterDevice[] = [];
  const seen = new Set<string>();

  return new Promise((resolve) => {
    mgr.startDeviceScan(null, null, (_err: any, device: any) => {
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

// ─── Profile discovery ───────────────────────────────────────────────────────
async function discoverPrintCharacteristic(
  device: any,
): Promise<{ serviceUuid: string; charUuid: string }> {
  for (const profile of PRINTER_PROFILES) {
    try {
      const chars: any[] = await device.characteristicsForService(profile.service);
      const match = chars.find(
        (c) =>
          c.uuid.toLowerCase() === profile.char.toLowerCase() &&
          (c.isWritableWithoutResponse || c.isWritableWithResponse),
      );
      if (match) {
        console.log(`Printer: using profile "${profile.label}"`);

        // Subscribe to notification char if present — this activates the data path
        // (required for 0x18F0 and ISSC UART firmware)
        if ('txNotifyChar' in profile && profile.txNotifyChar) {
          try {
            device.monitorCharacteristicForService(
              profile.service,
              profile.txNotifyChar,
              () => {},
            );
            // Give the subscription time to register before the first write
            await new Promise<void>((r) => setTimeout(r, 400));
          } catch {
            // Non-fatal — proceed anyway
          }
        }

        return { serviceUuid: profile.service, charUuid: profile.char };
      }
    } catch {
      // Service not present on this device — try next
    }
  }
  // Fallback: use the first profile (standard 0x18F0)
  console.warn('Printer: no confirmed profile — falling back to 0x18F0');
  return {
    serviceUuid: PRINTER_PROFILES[0].service,
    charUuid:    PRINTER_PROFILES[0].char,
  };
}

// ─── Low-level connect ───────────────────────────────────────────────────────
async function connectToDevice(address: string): Promise<{
  device: any;
  mtu: number;
  serviceUuid: string;
  charUuid: string;
}> {
  const mgr = getManager();
  if (!mgr) throw new Error('BLE manager not available');

  const device = await mgr.connectToDevice(address, { autoConnect: false });
  await device.discoverAllServicesAndCharacteristics();

  // Negotiate MTU for larger payloads
  let mtu = 20;
  try {
    const negotiated = await device.requestMTU(512);
    mtu = Math.max(20, negotiated.mtu - 3);
  } catch {}

  const { serviceUuid, charUuid } = await discoverPrintCharacteristic(device);

  // Give the printer firmware time to finish initializing before the first write
  await new Promise<void>((r) => setTimeout(r, 500));

  return { device, mtu, serviceUuid, charUuid };
}

// ─── Connect ─────────────────────────────────────────────────────────────────
export async function connectBarPrinter(address: string): Promise<boolean> {
  try {
    await requestPermissions();
    if (barDisconnectSub) { try { barDisconnectSub.remove(); } catch {} barDisconnectSub = null; }
    if (barPeripheral) { try { await barPeripheral.cancelConnection(); } catch {} barPeripheral = null; }

    const { device, mtu, serviceUuid, charUuid } = await connectToDevice(address);
    barPeripheral    = device;
    barMtu           = mtu;
    barServiceUuid   = serviceUuid;
    barCharUuid      = charUuid;

    barDisconnectSub = device.onDisconnected(() => {
      barPeripheral  = null;
      barServiceUuid = null;
      barCharUuid    = null;
      usePrinterStore.getState().setBarPrinter(address, false);
    });

    usePrinterStore.getState().setBarPrinter(address, true);
    return true;
  } catch (e) {
    console.warn('connectBarPrinter failed:', e);
    usePrinterStore.getState().setBarPrinter(address, false);
    return false;
  }
}

export async function connectKitchenPrinter(address: string): Promise<boolean> {
  try {
    await requestPermissions();
    if (kitchenDisconnectSub) { try { kitchenDisconnectSub.remove(); } catch {} kitchenDisconnectSub = null; }
    if (kitchenPeripheral) { try { await kitchenPeripheral.cancelConnection(); } catch {} kitchenPeripheral = null; }

    const { device, mtu, serviceUuid, charUuid } = await connectToDevice(address);
    kitchenPeripheral    = device;
    kitchenMtu           = mtu;
    kitchenServiceUuid   = serviceUuid;
    kitchenCharUuid      = charUuid;

    kitchenDisconnectSub = device.onDisconnected(() => {
      kitchenPeripheral  = null;
      kitchenServiceUuid = null;
      kitchenCharUuid    = null;
      usePrinterStore.getState().setKitchenPrinter(address, false);
    });

    usePrinterStore.getState().setKitchenPrinter(address, true);
    return true;
  } catch (e) {
    console.warn('connectKitchenPrinter failed:', e);
    usePrinterStore.getState().setKitchenPrinter(address, false);
    return false;
  }
}

// ─── Disconnect ───────────────────────────────────────────────────────────────
export async function disconnectBarPrinter(): Promise<void> {
  const saved = usePrinterStore.getState().barPrinterAddress;
  if (barDisconnectSub) { try { barDisconnectSub.remove(); } catch {} barDisconnectSub = null; }
  if (barPeripheral) { try { await barPeripheral.cancelConnection(); } catch {} barPeripheral = null; }
  barServiceUuid = null; barCharUuid = null; barMtu = 20;
  usePrinterStore.getState().setBarPrinter(saved, false);
}

export async function disconnectKitchenPrinter(): Promise<void> {
  const saved = usePrinterStore.getState().kitchenPrinterAddress;
  if (kitchenDisconnectSub) { try { kitchenDisconnectSub.remove(); } catch {} kitchenDisconnectSub = null; }
  if (kitchenPeripheral) { try { await kitchenPeripheral.cancelConnection(); } catch {} kitchenPeripheral = null; }
  kitchenServiceUuid = null; kitchenCharUuid = null; kitchenMtu = 20;
  usePrinterStore.getState().setKitchenPrinter(saved, false);
}

// ─── Auto-reconnect ───────────────────────────────────────────────────────────
async function getConnectedDevice(): Promise<{
  device: any; chunkSz: number; serviceUuid: string; charUuid: string;
} | null> {
  if (barPeripheral && barServiceUuid && barCharUuid) {
    return { device: barPeripheral, chunkSz: barMtu, serviceUuid: barServiceUuid, charUuid: barCharUuid };
  }
  if (kitchenPeripheral && kitchenServiceUuid && kitchenCharUuid) {
    return { device: kitchenPeripheral, chunkSz: kitchenMtu, serviceUuid: kitchenServiceUuid, charUuid: kitchenCharUuid };
  }

  // Auto-reconnect from saved address
  const store = usePrinterStore.getState();
  const addr = store.barPrinterAddress ?? store.kitchenPrinterAddress;
  if (!addr) return null;

  console.log('Auto-reconnecting to', addr);
  const ok = await connectBarPrinter(addr);
  if (ok && barPeripheral && barServiceUuid && barCharUuid) {
    return { device: barPeripheral, chunkSz: barMtu, serviceUuid: barServiceUuid, charUuid: barCharUuid };
  }
  return null;
}

// ─── Write ────────────────────────────────────────────────────────────────────
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function writeChunks(
  device: any,
  serviceUuid: string,
  charUuid: string,
  data: Uint8Array,
  chunkSz: number,
): Promise<void> {
  for (let offset = 0; offset < data.length; offset += chunkSz) {
    const chunk  = data.slice(offset, offset + chunkSz);
    const base64 = uint8ToBase64(chunk);
    // Write with response first — waits for printer ACK, enforces security level.
    // Falls back to write without response for WRITE NO RESPONSE-only characteristics.
    try {
      await device.writeCharacteristicWithResponseForService(serviceUuid, charUuid, base64);
    } catch {
      await device.writeCharacteristicWithoutResponseForService(serviceUuid, charUuid, base64);
    }
    if (offset + chunkSz < data.length) {
      await new Promise<void>((r) => setTimeout(r, 10));
    }
  }
}

export async function sendToPrinter(target: 'bar' | 'kitchen', data: Uint8Array): Promise<boolean> {
  const conn = await getConnectedDevice();
  if (!conn) {
    console.warn('sendToPrinter: no printer connected');
    return false;
  }
  try {
    await writeChunks(conn.device, conn.serviceUuid, conn.charUuid, data, conn.chunkSz);
    return true;
  } catch (e) {
    console.warn(`Print (${target}) failed:`, e);
    return false;
  }
}

// ─── Test print ───────────────────────────────────────────────────────────────
export async function testPrint(): Promise<'ok' | 'not_connected' | 'write_failed'> {
  const conn = await getConnectedDevice();
  if (!conn) return 'not_connected';

  const text =
    '\x1b\x40' +             // ESC @ — initialize printer
    '\x1b\x61\x01' +         // center align
    '*** TEST PRINT ***\n' +
    'Printer connected OK\n' +
    '\n\n\n';

  try {
    await writeChunks(conn.device, conn.serviceUuid, conn.charUuid, new TextEncoder().encode(text), conn.chunkSz);
    return 'ok';
  } catch (e) {
    console.warn('testPrint failed:', e);
    return 'write_failed';
  }
}
