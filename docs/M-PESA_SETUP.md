# M-Pesa Integration Setup Guide

This guide walks through configuring M-Pesa STK Push for the POS system.

## Prerequisites

- M-Pesa Developer Account (Daraja)
- Business Shortcode (Paybill or Till Number)
- Consumer Key & Consumer Secret from Daraja
- Passkey from Daraja

## Step 1: Get Daraja Credentials

1. Go to [https://developer.safaricom.co.ke/](https://developer.safaricom.co.ke/)
2. Log in or register
3. Create a new app
4. Note down:
   - **Consumer Key**
   - **Consumer Secret**
   - **Passkey** (from your shortcode settings)
   - **Shortcode** (your Paybill/Till number)

## Step 2: Configure Supabase Edge Function Secrets

Go to your Supabase project dashboard → Edge Functions → mpesa-stk-push → Secrets and add:

| Secret Name | Value |
|------------|-------|
| `MPESA_CONSUMER_KEY` | Your Consumer Key |
| `MPESA_CONSUMER_SECRET` | Your Consumer Secret |
| `MPESA_PASSKEY` | Your Passkey |
| `MPESA_SHORTCODE` | Your Shortcode (e.g., 174379) |
| `MPESA_CALLBACK_URL` | `https://rusopielhzmdyskrrkaw.supabase.co/functions/v1/mpesa-callback` |
| `MPESA_ENV` | `sandbox` (for testing) or `production` |

Do the same for the `mpesa-stk-query` function.

## Step 3: Create Callback Endpoint (Optional)

For production, you need a callback endpoint to receive M-Pesa payment confirmations. Create a new Edge Function `mpesa-callback`:

```typescript
// supabase/functions/mpesa-callback/index.ts
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

serve(async (req) => {
  const body = await req.json();
  // Process the callback: update order status, record payment
  // TODO: Implement based on M-Pesa callback format
  return new Response(JSON.stringify({ ResultCode: 0 }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

## Step 4: Test STK Push

From the app:
1. Create an order
2. Tap "Pay" → "M-Pesa"
3. Enter a test phone number (use a number you control)
4. Confirm the STK push on your phone
5. The app should poll and confirm payment

## Sandbox vs Production

- **Sandbox**: Use test credentials and test numbers. No real money moves.
- **Production**: Use live credentials. Real payments are processed.

Switch by changing `MPESA_ENV` secret.

## Troubleshooting

- **STK push fails**: Check credentials match Daraja dashboard
- **No STK prompt**: Ensure phone number format is `2547XXXXXXXXX`
- **Timeout**: M-Pesa can take up to 30 seconds to respond
- **Callback not received**: Ensure `MPESA_CALLBACK_URL` is publicly accessible
