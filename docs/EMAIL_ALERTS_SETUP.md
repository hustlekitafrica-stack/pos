# Low-Stock Email Alerts Setup Guide

This guide walks through configuring email alerts for low-stock items via the Supabase Edge Function.

## Prerequisites

- A Resend account (or any email service with API)
- An email address to receive alerts
- Supabase project with Edge Functions deployed

## Step 1: Get Resend API Key

1. Go to [https://resend.com/](https://resend.com/)
2. Sign up or log in
3. Go to API Keys
4. Create a new API key
5. Copy the key

## Step 2: Configure Supabase Edge Function Secrets

Go to your Supabase project dashboard → Edge Functions → low-stock-alert → Secrets and add:

| Secret Name | Value |
|------------|-------|
| `ALERT_EMAIL` | Your email address (e.g., `owner@bar.com`) |
| `RESEND_API_KEY` | Your Resend API key |
| `FROM_EMAIL` | Sender email (e.g., `alerts@yourdomain.com`) |

**Note**: For Resend, you may need to verify your domain in the Resend dashboard before sending from it.

## Step 3: Test the Alert

From the POS app:
1. Go to **Reports** tab
2. Go to **Low Stock** sub-tab
3. Tap **Send Alert** button
4. Check your email for the alert

The alert includes:
- Product name
- Category
- Current stock level
- Threshold
- Unit

## Step 4: Automatic Alerts

Low-stock alerts are automatically triggered:
- On shift close (if enabled)
- On end-of-day close

The system tracks which items have already been alerted to avoid duplicate emails for the same low-stock state.

## Using a Different Email Service

If you prefer a service other than Resend (e.g., SendGrid, Mailgun), modify `supabase/functions/low-stock-alert/index.ts` to use their API instead.

Example for SendGrid:

```typescript
const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${SENDGRID_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    personalizations: [{ to: [{ email: ALERT_EMAIL }] }],
    from: { email: FROM_EMAIL },
    subject: 'Low Stock Alert',
    content: [{ type: 'text/html', value: html }],
  }),
});
```

## Troubleshooting

- **No email received**: Check Resend dashboard for delivery logs
- **API key error**: Verify the secret is set correctly in Supabase
- **Email blocked**: Check spam folder and ensure sender domain is verified
- **Duplicate alerts**: The system marks items as alerted; check `lowStockAlertSent` field in products table
