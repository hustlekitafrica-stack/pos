# Bluetooth Printer Setup Guide

This guide walks through connecting a 58mm thermal Bluetooth printer to the POS system.

## Prerequisites

- A 58mm ESC/POS-compatible thermal Bluetooth printer
- React Native app running on a physical device (not simulator)
- `react-native-ble-plx` installed (already in `package.json`)

## Step 1: Install BLE Library

```bash
npx expo install react-native-ble-plx
```

For bare React Native (not Expo), also install:

```bash
npm install react-native-ble-plx
npx pod-install
```

## Step 2: Configure Android Permissions

Add to `android/app/src/main/AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

## Step 3: Pair the Printer

1. Turn on the printer and put it in pairing mode (usually hold the feed button for 3 seconds)
2. Go to phone Bluetooth settings
3. Scan and pair the printer
4. Note the printer's name (e.g., "POS-58MM" or "Printer-001")

## Step 4: Connect via POS App

1. Open the POS app
2. Go to **Settings** tab
3. Under **Printers**, tap **Scan & Connect** for Bar or Kitchen printer
4. The app will scan for nearby BLE devices
5. Select your printer from the list
6. Confirm connection — it should show "Connected"

## Step 5: Test Printing

1. Create an order
2. Tap "Send" to kitchen
3. The kitchen printer should print the order ticket
4. Tap "Pay" and complete payment
5. The bar printer should print the receipt

## Troubleshooting

- **Printer not found**: Ensure printer is in pairing mode and Bluetooth is on
- **Connection fails**: Unpair and re-pair the printer in phone settings
- **No print output**: Check printer has paper and is powered on
- **Garbled text**: Ensure printer uses ESC/POS protocol (most 58mm thermal printers do)

## Multiple Printers

The app supports two printers:
- **Bar Printer**: For receipts and customer bills
- **Kitchen Printer**: For order tickets

Connect each separately in Settings.

## Printer Service UUIDs

The default BLE service/characteristic UUIDs in `lib/printer/connection.ts` are:
- Service: `000018f0-0000-1000-8000-00805f9b34fb`
- Characteristic: `00002af1-0000-1000-8000-00805f9b34fb`

If your printer uses different UUIDs, update them in the file.
