// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const MPESA_CONSUMER_KEY = Deno.env.get('MPESA_CONSUMER_KEY') || '';
const MPESA_CONSUMER_SECRET = Deno.env.get('MPESA_CONSUMER_SECRET') || '';
const MPESA_PASSKEY = Deno.env.get('MPESA_PASSKEY') || '';
const MPESA_SHORTCODE = Deno.env.get('MPESA_SHORTCODE') || '';
const MPESA_CALLBACK_URL = Deno.env.get('MPESA_CALLBACK_URL') || '';
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

function generatePassword(shortcode: string, passkey: string, timestamp: string): string {
  const str = `${shortcode}${passkey}${timestamp}`;
  return btoa(str);
}

serve(async (req) => {
  try {
    const { phone, amount, orderId } = await req.json();

    if (!phone || !amount) {
      return new Response(JSON.stringify({ success: false, errorMessage: 'Missing phone or amount' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Format phone: ensure 254XXXXXXXXX
    let formattedPhone = phone.replace(/\s+/g, '');
    if (formattedPhone.startsWith('0')) formattedPhone = '254' + formattedPhone.slice(1);
    if (formattedPhone.startsWith('+')) formattedPhone = formattedPhone.slice(1);

    // Amount in whole KES (convert from cents)
    const amountKES = Math.ceil(amount / 100);

    const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '').slice(0, 14);
    const password = generatePassword(MPESA_SHORTCODE, MPESA_PASSKEY, timestamp);
    const accessToken = await getAccessToken();

    const payload = {
      BusinessShortCode: MPESA_SHORTCODE,
      Password: password,
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: amountKES,
      PartyA: formattedPhone,
      PartyB: MPESA_SHORTCODE,
      PhoneNumber: formattedPhone,
      CallBackURL: MPESA_CALLBACK_URL,
      AccountReference: orderId || 'POS',
      TransactionDesc: `Payment for order ${orderId || 'N/A'}`,
    };

    const stkRes = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const stkData = await stkRes.json();

    if (stkData.ResponseCode === '0') {
      return new Response(JSON.stringify({
        success: true,
        checkoutRequestId: stkData.CheckoutRequestID,
        merchantRequestId: stkData.MerchantRequestID,
      }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({
      success: false,
      errorMessage: stkData.errorMessage || stkData.ResponseDescription || 'STK push failed',
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, errorMessage: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
