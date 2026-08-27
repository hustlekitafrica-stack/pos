/**
 * Printer connection — BLE GATT (single printer)
 *
 * One physical printer serves all print jobs: captain orders and receipts.
 * Uses react-native-ble-plx via RFCOMM-style write to 0x18F0/0x2AF1 (primary),
 * vendor e7810a71 (fallback), or ISSC UART (fallback).
 */
import { Platform, PermissionsAndroid } from 'react-native';
import { BleManager } from 'react-native-ble-plx';
import { usePrinterStore } from '@/stores/printerStore';

// ─── Printer profiles ──────────────────────────────────────────────────────
const PRINTER_PROFILES = [
  {
    label:        'Standard 0x18F0/0x2AF1',
    service:      '000018f0-0000-1000-8000-00805f9b34fb',
    char:         '00002af1-0000-1000-8000-00805f9b34fb',
    txNotifyChar: '00002af0-0000-1000-8000-00805f9b34fb',
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

let device:      any    = null;
let serviceUuid: string | null = null;
let charUuid:    string | null = null;
let mtu = 20;
let disconnectSub: any  = null;

// ─── Scan ────────────────────────────────────────────────────────────────────
export async function scanForPrinters(timeoutMs = 5000): Promise<PrinterDevice[]> {
  const mgr = getManager();
  if (!mgr) return [];
  const ok = await requestPermissions();
  if (!ok) return [];

  const devices: PrinterDevice[] = [];
  const seen = new Set<string>();

  return new Promise((resolve) => {
    mgr.startDeviceScan(null, null, (_err: any, d: any) => {
      if (!d?.name) return;
      if (seen.has(d.id)) return;
      seen.add(d.id);
      devices.push({ name: d.name, address: d.id });
    });
    setTimeout(() => {
      mgr.stopDeviceScan();
      resolve(devices);
    }, timeoutMs);
  });
}

// ─── Profile discovery ───────────────────────────────────────────────────────
async function discoverPrintCharacteristic(
  dev: any,
): Promise<{ serviceUuid: string; charUuid: string }> {
  for (const profile of PRINTER_PROFILES) {
    try {
      const chars: any[] = await dev.characteristicsForService(profile.service);
      const match = chars.find(
        (c) =>
          c.uuid.toLowerCase() === profile.char.toLowerCase() &&
          (c.isWritableWithoutResponse || c.isWritableWithResponse),
      );
      if (match) {
        console.log(`Printer: using profile "${profile.label}"`);
        if ('txNotifyChar' in profile && profile.txNotifyChar) {
          try {
            dev.monitorCharacteristicForService(profile.service, profile.txNotifyChar, () => {});
            await new Promise<void>((r) => setTimeout(r, 400));
          } catch {}
        }
        return { serviceUuid: profile.service, charUuid: profile.char };
      }
    } catch {}
  }
  console.warn('Printer: no confirmed profile — falling back to 0x18F0');
  return { serviceUuid: PRINTER_PROFILES[0].service, charUuid: PRINTER_PROFILES[0].char };
}

// ─── Connect ─────────────────────────────────────────────────────────────────
export async function connectPrinter(address: string): Promise<boolean> {
  const mgr = getManager();
  if (!mgr) return false;
  try {
    await requestPermissions();
    if (disconnectSub) { try { disconnectSub.remove(); } catch {} disconnectSub = null; }
    if (device) { try { await device.cancelConnection(); } catch {} device = null; }

    const dev = await mgr.connectToDevice(address, { autoConnect: false });
    await dev.discoverAllServicesAndCharacteristics();

    let negotiatedMtu = 20;
    try {
      const n = await dev.requestMTU(512);
      negotiatedMtu = Math.max(20, n.mtu - 3);
    } catch {}

    const profile = await discoverPrintCharacteristic(dev);
    await new Promise<void>((r) => setTimeout(r, 500));

    device      = dev;
    mtu         = negotiatedMtu;
    serviceUuid = profile.serviceUuid;
    charUuid    = profile.charUuid;

    disconnectSub = dev.onDisconnected(() => {
      device = null; serviceUuid = null; charUuid = null; mtu = 20;
      usePrinterStore.getState().setPrinter(address, false);
    });

    usePrinterStore.getState().setPrinter(address, true);
    return true;
  } catch (e) {
    console.warn('connectPrinter failed:', e);
    usePrinterStore.getState().setPrinter(address, false);
    return false;
  }
}

// Aliases kept for any legacy call sites
export const connectBarPrinter     = connectPrinter;
export const connectKitchenPrinter = connectPrinter;

// ─── Disconnect ───────────────────────────────────────────────────────────────
export async function disconnectPrinter(): Promise<void> {
  const saved = usePrinterStore.getState().printerAddress;
  if (disconnectSub) { try { disconnectSub.remove(); } catch {} disconnectSub = null; }
  if (device) { try { await device.cancelConnection(); } catch {} device = null; }
  serviceUuid = null; charUuid = null; mtu = 20;
  usePrinterStore.getState().setPrinter(saved, false);
}

export const disconnectBarPrinter     = disconnectPrinter;
export const disconnectKitchenPrinter = disconnectPrinter;

// ─── Auto-reconnect ───────────────────────────────────────────────────────────
async function getConnectedDevice(): Promise<{ device: any; chunkSz: number; serviceUuid: string; charUuid: string } | null> {
  if (device && serviceUuid && charUuid) {
    return { device, chunkSz: mtu, serviceUuid, charUuid };
  }
  const addr = usePrinterStore.getState().printerAddress;
  if (!addr) return null;
  console.log('Auto-reconnecting to', addr);
  const ok = await connectPrinter(addr);
  if (ok && device && serviceUuid && charUuid) {
    return { device, chunkSz: mtu, serviceUuid, charUuid };
  }
  return null;
}

// ─── Write ────────────────────────────────────────────────────────────────────
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function writeChunks(dev: any, svcUuid: string, cUuid: string, data: Uint8Array, chunkSz: number): Promise<void> {
  for (let offset = 0; offset < data.length; offset += chunkSz) {
    const chunk  = data.slice(offset, offset + chunkSz);
    const base64 = uint8ToBase64(chunk);
    try {
      await dev.writeCharacteristicWithResponseForService(svcUuid, cUuid, base64);
    } catch {
      await dev.writeCharacteristicWithoutResponseForService(svcUuid, cUuid, base64);
    }
    if (offset + chunkSz < data.length) await new Promise<void>((r) => setTimeout(r, 10));
  }
}

/** target is ignored — all jobs go to the single connected printer */
export async function sendToPrinter(_target: 'bar' | 'kitchen', data: Uint8Array): Promise<boolean> {
  const conn = await getConnectedDevice();
  if (!conn) { console.warn('sendToPrinter: no printer connected'); return false; }
  try {
    await writeChunks(conn.device, conn.serviceUuid, conn.charUuid, data, conn.chunkSz);
    return true;
  } catch (e) {
    console.warn('sendToPrinter failed:', e);
    return false;
  }
}

// ─── Test print ───────────────────────────────────────────────────────────────
export async function testPrint(): Promise<'ok' | 'not_connected' | 'write_failed'> {
  const conn = await getConnectedDevice();
  if (!conn) return 'not_connected';
  const text =
    '\x1b\x40' +
    '\x1b\x61\x01' +
    '*** TEST PRINT ***\n' +
    'Printer connected OK\n' +
    '\n\n\n';
  try {
    await writeChunks(conn.device, conn.serviceUuid, conn.charUuid, new TextEncoder().encode(text), conn.chunkSz);
    return 'ok';
  } catch {
    return 'write_failed';
  }
}
