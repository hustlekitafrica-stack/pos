import { SUPABASE_CONFIG } from '@/constants/config';
import { supabase } from '../supabase';

export interface ReceiptScanResult {
  vendorName: string | null;
  items: Array<{ description: string; amount: number }>;
  totalAmount: number;
  date: string | null;
  category: string | null;
  imageUrl?: string; // Added by edge function
}

/**
 * Scan a receipt photo using Claude Vision API via Supabase Edge Function.
 * The Edge Function handles the Anthropic API key and call.
 *
 * @param base64Image - Base64-encoded image data
 * @returns Parsed receipt data
 */
export async function scanReceipt(base64Image: string): Promise<ReceiptScanResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke('scan-receipt', {
      body: {
        image: base64Image,
        prompt: `Analyze this receipt image and extract:
1. Vendor/store name
2. Each line item with description and amount in KES
3. Total amount in KES
4. Date of purchase
5. Suggested expense category (one of: Supplies/Stock, Salaries, Utilities, Rent, Transport, Maintenance, Other)

Return JSON with this exact structure:
{
  "vendorName": "string or null",
  "items": [{"description": "string", "amount": number_in_kes_cents}],
  "totalAmount": number_in_kes_cents,
  "date": "YYYY-MM-DD or null",
  "category": "string or null"
}`,
      },
    });

    if (error) {
      console.warn('Receipt scan error:', error);
      return null;
    }

    return data as ReceiptScanResult;
  } catch (e) {
    console.warn('Receipt scan failed:', e);
    return null;
  }
}

/**
 * Scan receipt using local device camera.
 * Returns base64-encoded image for processing.
 */
export async function captureReceiptImage(): Promise<string | null> {
  try {
    // Dynamic import to avoid bundling camera when not used
    const ImagePicker = require('expo-image-picker');

    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      base64: true,
      quality: 0.7,
    });

    if (result.canceled || !result.assets?.[0]?.base64) {
      return null;
    }

    return result.assets[0].base64;
  } catch (e) {
    console.warn('Camera error:', e);
    return null;
  }
}
