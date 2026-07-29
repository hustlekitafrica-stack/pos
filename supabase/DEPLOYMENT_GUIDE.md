# Supabase Edge Functions Deployment Guide

The CLI deployment failed due to account permissions. Use the Supabase Dashboard to deploy manually.

## Steps

1. Go to https://supabase.com/dashboard/project/rusopielhzmdyskrrkaw/functions
2. Click "New Function"
3. For each function below, create it with the exact name and paste the code

---

## Function 1: mpesa-stk-push

**Name:** `mpesa-stk-push`

**Environment Variables (set in Function Settings → Secrets):**
- `MPESA_CONSUMER_KEY` — your M-Pesa consumer key
- `MPESA_CONSUMER_SECRET` — your M-Pesa consumer secret
- `MPESA_PASSKEY` — your M-Pesa passkey
- `MPESA_SHORTCODE` — your paybill/till number
- `MPESA_CALLBACK_URL` — `https://rusopielhzmdyskrrkaw.supabase.co/functions/v1/mpesa-callback` (or your callback endpoint)
- `MPESA_ENV` — `sandbox` or `production`

**Code:** Copy from `supabase/functions/mpesa-stk-push/index.ts`

---

## Function 2: mpesa-stk-query

**Name:** `mpesa-stk-query`

**Environment Variables (same as above):**
- `MPESA_CONSUMER_KEY`
- `MPESA_CONSUMER_SECRET`
- `MPESA_PASSKEY`
- `MPESA_SHORTCODE`
- `MPESA_ENV`

**Code:** Copy from `supabase/functions/mpesa-stk-query/index.ts`

---

## Function 3: scan-receipt

**Name:** `scan-receipt`

**Environment Variables:**
- `ANTHROPIC_API_KEY` — your Anthropic API key for Claude Vision
- `SUPABASE_URL` — `https://rusopielhzmdyskrrkaw.supabase.co`
- `SUPABASE_SERVICE_ROLE_KEY` — Your project's service role key (from Project Settings → API)

**Code:** Copy from `supabase/functions/scan-receipt/index.ts`

---

## Function 4: low-stock-alert

**Name:** `low-stock-alert`

**Environment Variables:**
- `ALERT_EMAIL` — your email for low-stock alerts
- `RESEND_API_KEY` — your Resend API key (or another email service)
- `FROM_EMAIL` — sender email (e.g., `alerts@yourdomain.com`)

**Code:** Copy from `supabase/functions/low-stock-alert/index.ts`

---

## After Deployment

Test each function from the dashboard's "Logs" tab or via curl:

```bash
# Test mpesa-stk-push
curl -X POST https://rusopielhzmdyskrrkaw.supabase.co/functions/v1/mpesa-stk-push \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"phone":"254712345678","amount":10000,"orderId":"test-123"}'
```

Replace `YOUR_ANON_KEY` with your project's anon key from Project Settings → API.
