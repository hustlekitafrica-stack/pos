// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const ALERT_EMAIL = Deno.env.get('ALERT_EMAIL') || '';
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') || 'alerts@pos.local';

interface LowStockItem {
  name: string;
  category: string;
  currentStock: number;
  threshold: number;
  unit: string;
}

serve(async (req) => {
  try {
    const { items } = await req.json() as { items: LowStockItem[] };

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ sent: false, reason: 'No items' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const itemRows = items.map((i) =>
      `<tr><td>${i.name}</td><td>${i.category}</td><td style="color:${i.currentStock === 0 ? 'red' : 'orange'};font-weight:bold">${i.currentStock}</td><td>${i.threshold}</td><td>${i.unit}</td></tr>`
    ).join('');

    const html = `
<!DOCTYPE html>
<html>
<head><style>
  body { font-family: Arial, sans-serif; padding: 20px; }
  h2 { color: #dc2626; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
  th { background: #1a1a2e; color: white; }
</style></head>
<body>
  <h2>Low Stock Alert - ${new Date().toLocaleDateString()}</h2>
  <p>${items.length} product(s) are at or below their stock threshold:</p>
  <table>
    <tr><th>Product</th><th>Category</th><th>Current Stock</th><th>Threshold</th><th>Unit</th></tr>
    ${itemRows}
  </table>
  <p style="color:#666;margin-top:20px;font-size:12px">Sent by Bar POS System</p>
</body></html>`;

    if (!RESEND_API_KEY || !ALERT_EMAIL) {
      // Log only — no email configured
      console.log('Low stock alert (email not configured):', JSON.stringify(items));
      return new Response(JSON.stringify({ sent: false, reason: 'Email not configured', items }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Send via Resend (or any email API)
    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: ALERT_EMAIL,
        subject: `Low Stock Alert - ${items.length} item(s) need restocking`,
        html,
      }),
    });

    const emailData = await emailRes.json();
    return new Response(JSON.stringify({ sent: true, emailId: emailData.id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ sent: false, error: String(e) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
