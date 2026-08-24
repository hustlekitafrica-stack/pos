import { supabase as _supabase } from '../supabase';

export interface ReceiptScanResult {
  vendorName: string | null;
  items: Array<{ description: string; amount: number; category?: string }>;
  totalAmount: number;
  date: string | null;
  category: string | null;
  imageUrl?: string; // Added by edge function
}

/**
 * Scan a receipt photo using OpenAI gpt-4o Vision via Supabase Edge Function.
 * The Edge Function handles the OPENAI_API_KEY secret and API call.
 *
 * @param base64Image - Base64-encoded image data
 * @returns Parsed receipt data
 */
export async function scanReceipt(base64Image: string): Promise<ReceiptScanResult | null> {
  if (!_supabase) {
    console.warn('scanReceipt: Supabase not configured — set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in .env');
    return null;
  }
  try {
    const { data, error } = await _supabase.functions.invoke('scan-receipt', {
      body: {
        image: base64Image,
        prompt: `Analyze this receipt image and extract:
1. Vendor/store name
2. Each line item with description, amount in KES, and a suggested category for that item
3. Total amount in KES
4. Date of purchase

For each item's category, choose the best match from: Supplies/Stock, Salaries, Utilities, Rent, Transport, Maintenance, Other

Return JSON with this exact structure:
{
  "vendorName": "string or null",
  "items": [{"description": "string", "amount": number_in_kes_cents, "category": "string"}],
  "totalAmount": number_in_kes_cents,
  "date": "YYYY-MM-DD or null"
}`,
      },
    });

    if (error) {
      console.warn('Receipt scan error:', error);
      return null;
    }

    // Guard: some Supabase client versions surface non-2xx response bodies as
    // `data` (with error=null) instead of setting `error`.
    if (data && typeof (data as any).error === 'string') {
      console.warn('Receipt scan returned error field:', (data as any).error);
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
