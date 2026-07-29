// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const MPESA_CONSUMER_KEY = Deno.env.get('MPESA_CONSUMER_KEY') || '';
const MPESA_CONSUMER_SECRET = Deno.env.get('MPESA_CONSUMER_SECRET') || '';
const MPESA_PASSKEY = Deno.env.get('MPESA_PASSKEY') || '';
const MPESA_SHORTCODE = Deno.env.get('MPESA_SHORTCODE') || '';
const MPESA_ENV = Deno.env.get('MPESA_ENV') || 'sandbox';

const BASE_URL = MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

async function getAccessToken(): Promise<string> {
  const credentials = btoa(`${MPESA_CONSUMER_KEY}:${MPESA_CONSUMER_SECRET}`);
  const res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  const data = await res.json();
  return data.access_token;
}

serve(async (req) => {
  try {
    const { checkoutRequestId } = await req.json();

    if (!checkoutRequestId) {
      return new Response(JSON.stringify({ error: 'Missing checkoutRequestId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
    const password = btoa(`${MPESA_SHORTCODE}${MPESA_PASSKEY}${timestamp}`);
    const accessToken = await getAccessToken();

    const queryRes = await fetch(`${BASE_URL}/mpesa/stkpushquery/v1/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        BusinessShortCode: MPESA_SHORTCODE,
        Password: password,
        Timestamp: timestamp,
        CheckoutRequestID: checkoutRequestId,
      }),
    });

    const data = await queryRes.json();

    // ResultCode 0 = success
    const result = {
      resultCode: parseInt(data.ResultCode || '-1', 10),
      resultDesc: data.ResultDesc || 'Unknown',
      mpesaReceiptNumber: null as string | null,
    };

    // Extract receipt from callback metadata if available
    if (data.CallbackMetadata?.Item) {
      const receiptItem = data.CallbackMetadata.Item.find(
        (i: any) => i.Name === 'MpesaReceiptNumber'
      );
      if (receiptItem) result.mpesaReceiptNumber = receiptItem.Value;
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ resultCode: -1, resultDesc: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
