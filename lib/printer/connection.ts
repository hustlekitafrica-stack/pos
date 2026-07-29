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

const PRINTER_SERVICE_UUID = '000018f0-0000-1000-8000-00805f9b34fb';
const PRINTER_CHAR_UUID = '00002af1-0000-1000-8000-00805f9b34fb';

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

async function connectToDevice(address: string): Promise<any> {
  const mgr = getManager();
  if (!mgr) throw new Error('BLE not available');

  const device = await mgr.connectToDevice(address);
  await device.discoverAllServicesAndCharacteristics();
  return device;
}

export async function connectBarPrinter(address: string): Promise<boolean> {
  try {
    barPeripheral = await connectToDevice(address);
    const store = usePrinterStore.getState();
    store.setBarPrinter(address, true);
    return true;
  } catch (e) {
    console.warn('Bar printer connection failed:', e);
    return false;
  }
}

export async function connectKitchenPrinter(address: string): Promise<boolean> {
  try {
    kitchenPeripheral = await connectToDevice(address);
    const store = usePrinterStore.getState();
    store.setKitchenPrinter(address, true);
    return true;
  } catch (e) {
    console.warn('Kitchen printer connection failed:', e);
    return false;
  }
}

export async function disconnectBarPrinter(): Promise<void> {
  if (barPeripheral) {
    try { await barPeripheral.cancelConnection(); } catch (e) {}
    barPeripheral = null;
  }
  const store = usePrinterStore.getState();
  store.setBarPrinter(null, false);
}

export async function disconnectKitchenPrinter(): Promise<void> {
  if (kitchenPeripheral) {
    try { await kitchenPeripheral.cancelConnection(); } catch (e) {}
    kitchenPeripheral = null;
  }
  const store = usePrinterStore.getState();
  store.setKitchenPrinter(null, false);
}

/**
 * Send raw ESC/POS bytes to a connected printer.
 * @param target 'bar' or 'kitchen'
 * @param data ESC/POS command buffer as Uint8Array
 */
export async function sendToPrinter(target: 'bar' | 'kitchen', data: Uint8Array): Promise<boolean> {
  const device = target === 'bar' ? barPeripheral : kitchenPeripheral;
  if (!device) {
    console.warn(`${target} printer not connected`);
    return false;
  }

  try {
    // Convert Uint8Array to base64 for BLE write
    const base64 = uint8ToBase64(data);
    await device.writeCharacteristicWithResponseForService(
      PRINTER_SERVICE_UUID,
      PRINTER_CHAR_UUID,
      base64
    );
    return true;
  } catch (e) {
    console.warn(`Print to ${target} failed:`, e);
    return false;
  }
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
