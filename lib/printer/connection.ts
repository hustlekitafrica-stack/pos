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
let barMtu = 20;
let kitchenMtu = 20;

// Discovered service + characteristic UUIDs for each printer slot.
// connectToDevice probes the printer to find the correct write channel.
let barServiceUuid: string | null = null;
let barCharUuid: string | null = null;
let kitchenServiceUuid: string | null = null;
let kitchenCharUuid: string | null = null;

// Subscription references kept alive to prevent garbage collection
let barDisconnectSub: any = null;
let kitchenDisconnectSub: any = null;

// ─── Printer profiles ──────────────────────────────────────────────────────
// Tried in order at connection time. The first profile whose characteristic
// is confirmed writable on the device is used for all subsequent writes.
//
// UUIDs verified against nRF Connect scan of the P502A-3E3A printer:
//   Service e7810a71-73ae-499d-8c15-faa9aef0c3f2
//     Char  bef8d6c9-9c21-4c9e-b632-bd58c1009f9f  WRITE + WRITE NO RESPONSE
//   Service 49535343-fe7d-4ae5-8fa9-9fafd205e455   (ISSC Transparent UART)
//     Char  49535343-8841-43f4-a8d4-ecbe34729bb3   WRITE NO RESPONSE
//     Char  49535343-1e4d-4bd9-ba61-23c647249616   NOTIFY (TX — must subscribe)
//   Service 0x18F0
//     Char  0x2AF1  WRITE + WRITE NO RESPONSE
const PRINTER_PROFILES: Array<{
  label: string;
  service: string;
  char: string;
  txNotifyChar?: string;   // ISSC: subscribe to this to activate the UART write path
}> = [
  {
    // Primary print channel confirmed by nRF Connect (Image 2)
    label:   'Vendor print e7810a71',
    service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    char:    'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  },
  {
    // ISSC Transparent UART — needs TX notification enabled to activate RX path
    label:        'ISSC UART',
    service:      '49535343-fe7d-4ae5-8fa9-9fafd205e455',
    char:         '49535343-8841-43f4-a8d4-ecbe34729bb3',
    txNotifyChar: '49535343-1e4d-4bd9-ba61-23c647249616',
  },
  {
    // Standard thermal fallback
    label:   'Standard 0x18F0/0x2AF1',
    service: '000018f0-0000-1000-8000-00805f9b34fb',
    char:    '00002af1-0000-1000-8000-00805f9b34fb',
  },
];

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

/**
 * Probe the connected device to find which service/characteristic it uses for
 * printing. Returns the first profile whose characteristic is confirmed
 * writable, or falls back to the first profile if none is confirmed.
 *
 * For the ISSC UART profile, also subscribes to the TX notification
 * characteristic — this activates the UART receive path in the ISSC module,
 * without which writes to the RX characteristic are silently dropped.
 */
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

        // For ISSC UART, subscribe to TX notifications to activate the UART path
        if (profile.txNotifyChar) {
          try {
            device.monitorCharacteristicForService(
              profile.service,
              profile.txNotifyChar,
              () => {},   // we only need the subscription active, not the data
            );
            // Give the subscription a moment to register before the first write
            await new Promise<void>((r) => setTimeout(r, 300));
          } catch {
            // Non-fatal — proceed anyway
          }
        }

        return { serviceUuid: profile.service, charUuid: profile.char };
      }
    } catch {
      // Service not present on this device — try next profile
    }
  }

  // Last resort: use first profile even if not confirmed
  console.warn('Printer: no known profile matched — defaulting to first profile');
  return { serviceUuid: PRINTER_PROFILES[0].service, charUuid: PRINTER_PROFILES[0].char };
}

async function connectToDevice(
  address: string,
): Promise<{ device: any; mtu: number; serviceUuid: string; charUuid: string }> {
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

  const { serviceUuid, charUuid } = await discoverPrintCharacteristic(device);

  return { device, mtu, serviceUuid, charUuid };
}

export async function connectBarPrinter(address: string): Promise<boolean> {
  try {
    const { device, mtu, serviceUuid, charUuid } = await connectToDevice(address);
    barPeripheral  = device;
    barMtu         = mtu;
    barServiceUuid = serviceUuid;
    barCharUuid    = charUuid;

    if (barDisconnectSub) { try { barDisconnectSub.remove(); } catch {} }
    barDisconnectSub = device.onDisconnected(() => {
      barPeripheral  = null;
      barMtu         = 20;
      barServiceUuid = null;
      barCharUuid    = null;
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
    const { device, mtu, serviceUuid, charUuid } = await connectToDevice(address);
    kitchenPeripheral  = device;
    kitchenMtu         = mtu;
    kitchenServiceUuid = serviceUuid;
    kitchenCharUuid    = charUuid;

    if (kitchenDisconnectSub) { try { kitchenDisconnectSub.remove(); } catch {} }
    kitchenDisconnectSub = device.onDisconnected(() => {
      kitchenPeripheral  = null;
      kitchenMtu         = 20;
      kitchenServiceUuid = null;
      kitchenCharUuid    = null;
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
  const savedAddress = store.barPrinterAddress;
  if (barDisconnectSub) { try { barDisconnectSub.remove(); } catch {} barDisconnectSub = null; }
  if (barPeripheral) {
    try { await barPeripheral.cancelConnection(); } catch {}
    barPeripheral  = null;
    barMtu         = 20;
    barServiceUuid = null;
    barCharUuid    = null;
  }
  store.setBarPrinter(savedAddress, false);
}

export async function disconnectKitchenPrinter(): Promise<void> {
  const store = usePrinterStore.getState();
  const savedAddress = store.kitchenPrinterAddress;
  if (kitchenDisconnectSub) { try { kitchenDisconnectSub.remove(); } catch {} kitchenDisconnectSub = null; }
  if (kitchenPeripheral) {
    try { await kitchenPeripheral.cancelConnection(); } catch {}
    kitchenPeripheral  = null;
    kitchenMtu         = 20;
    kitchenServiceUuid = null;
    kitchenCharUuid    = null;
  }
  store.setKitchenPrinter(savedAddress, false);
}

/**
 * Ensure a printer is connected, auto-reconnecting if the BLE link dropped.
 */
async function getConnectedDevice(): Promise<{
  device: any;
  chunkSz: number;
  serviceUuid: string;
  charUuid: string;
} | null> {
  if (barPeripheral && barServiceUuid && barCharUuid) {
    return { device: barPeripheral, chunkSz: barMtu, serviceUuid: barServiceUuid, charUuid: barCharUuid };
  }
  if (kitchenPeripheral && kitchenServiceUuid && kitchenCharUuid) {
    return { device: kitchenPeripheral, chunkSz: kitchenMtu, serviceUuid: kitchenServiceUuid, charUuid: kitchenCharUuid };
  }

  // Auto-reconnect using the saved address
  const store = usePrinterStore.getState();
  const savedAddress = store.barPrinterAddress ?? store.kitchenPrinterAddress;
  if (!savedAddress) return null;

  console.log('Printer disconnected — auto-reconnecting to', savedAddress);
  const ok = await connectBarPrinter(savedAddress);
  if (ok && barPeripheral && barServiceUuid && barCharUuid) {
    return { device: barPeripheral, chunkSz: barMtu, serviceUuid: barServiceUuid, charUuid: barCharUuid };
  }

  return null;
}

/**
 * Write ESC/POS data in MTU-sized chunks to the printer.
 */
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
    // Try write-without-response first (faster); fall back to write-with-response
    try {
      await device.writeCharacteristicWithoutResponseForService(serviceUuid, charUuid, base64);
    } catch {
      await device.writeCharacteristicWithResponseForService(serviceUuid, charUuid, base64);
    }
    if (offset + chunkSz < data.length) {
      await new Promise<void>((r) => setTimeout(r, 10));
    }
  }
}

/**
 * Send raw ESC/POS bytes to a connected printer.
 * Auto-reconnects if the BLE link dropped since last use.
 * @returns true on success, false if no printer could be reached
 */
export async function sendToPrinter(target: 'bar' | 'kitchen', data: Uint8Array): Promise<boolean> {
  const conn = await getConnectedDevice();
  if (!conn) {
    console.warn('sendToPrinter: no printer connected and auto-reconnect failed');
    return false;
  }
  const { device, chunkSz, serviceUuid, charUuid } = conn;

  try {
    await writeChunks(device, serviceUuid, charUuid, data, chunkSz);
    return true;
  } catch (e) {
    console.warn(`Print to ${target} failed:`, e);
    return false;
  }
}

/**
 * Send a short test page to verify the printer is connected and responding.
 * @returns 'ok' | 'not_connected' | 'write_failed'
 */
export async function testPrint(): Promise<'ok' | 'not_connected' | 'write_failed'> {
  const conn = await getConnectedDevice();
  if (!conn) return 'not_connected';

  // Plain text + paper feed — works on any ESC/POS printer regardless of command support
  const text = '\x1b\x40' +          // ESC @ — initialize printer
               'TEST PRINT\r\n' +
               'Printer OK\r\n' +
               '\r\n\r\n\r\n';
  const data = new TextEncoder().encode(text);

  try {
    await writeChunks(conn.device, conn.serviceUuid, conn.charUuid, data, conn.chunkSz);
    return 'ok';
  } catch (e) {
    console.warn('testPrint write failed:', e);
    return 'write_failed';
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
