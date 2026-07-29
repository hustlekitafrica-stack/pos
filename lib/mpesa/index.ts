import { supabase } from '../supabase';

export interface MpesaSTKResponse {
  success: boolean;
  checkoutRequestId?: string;
  merchantRequestId?: string;
  errorMessage?: string;
}

export interface MpesaCallbackResult {
  resultCode: number;
  resultDesc: string;
  mpesaReceiptNumber?: string;
  amount?: number;
  phoneNumber?: string;
}

/**
 * Initiate M-Pesa STK Push via a backend endpoint.
 * The backend (Node/Express on Railway or Supabase Edge Function)
 * handles Daraja API auth and STK push request.
 * 
 * @param phoneNumber - Customer phone (254XXXXXXXXX format)
 * @param amount - Amount in KES (whole number, not cents)
 * @param orderId - Reference for the transaction
 */
export async function initiateSTKPush(
  phoneNumber: string,
  amount: number,
  orderId: string
): Promise<MpesaSTKResponse> {
  try {
    // Call Supabase Edge Function or external API
    const { data, error } = await supabase.functions.invoke('mpesa-stk-push', {
      body: {
        phoneNumber: formatPhoneNumber(phoneNumber),
        amount: Math.ceil(amount / 100), // Convert cents to whole KES
        accountReference: `Order-${orderId.slice(0, 8)}`,
        transactionDesc: 'Bar POS Payment',
      },
    });

    if (error) {
      return { success: false, errorMessage: error.message };
    }

    return {
      success: true,
      checkoutRequestId: data?.CheckoutRequestID,
      merchantRequestId: data?.MerchantRequestID,
    };
  } catch (e: any) {
    return { success: false, errorMessage: e.message || 'Network error' };
  }
}

/**
 * Poll for M-Pesa payment confirmation.
 * Calls the backend to check the status of an STK push.
 */
export async function checkSTKStatus(checkoutRequestId: string): Promise<MpesaCallbackResult | null> {
  try {
    const { data, error } = await supabase.functions.invoke('mpesa-stk-query', {
      body: { checkoutRequestId },
    });

    if (error || !data) return null;

    return {
      resultCode: data.ResultCode,
      resultDesc: data.ResultDesc,
      mpesaReceiptNumber: data.MpesaReceiptNumber,
      amount: data.Amount,
      phoneNumber: data.PhoneNumber,
    };
  } catch {
    return null;
  }
}

/**
 * Format phone number to 254XXXXXXXXX format.
 */
function formatPhoneNumber(phone: string): string {
  let cleaned = phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');

  if (cleaned.startsWith('+254')) {
    cleaned = cleaned.slice(1);
  } else if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.slice(1);
  } else if (!cleaned.startsWith('254')) {
    cleaned = '254' + cleaned;
  }

  return cleaned;
}
