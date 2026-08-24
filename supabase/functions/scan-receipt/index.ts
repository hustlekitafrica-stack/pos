// @ts-nocheck
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY') || '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS pre-flight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { image, prompt } = await req.json();

    if (!image || !prompt) {
      return new Response(JSON.stringify({ error: 'Missing image or prompt' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Strip data-URL prefix if present
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    // Upload receipt image to Supabase Storage
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'image/jpeg' });

    const filename = `receipt-${Date.now()}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('receipts')
      .upload(filename, blob, { contentType: 'image/jpeg', upsert: true });

    if (uploadError) {
      console.warn('Storage upload error (non-fatal):', uploadError);
    }

    const { data: { publicUrl } } = supabase.storage
      .from('receipts')
      .getPublicUrl(filename);

    // Analyse with OpenAI gpt-4o vision
    const aiResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1024,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${base64Data}` },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    if (!aiResponse.ok) {
      const errBody = await aiResponse.json().catch(() => ({}));
      console.error('OpenAI API error:', aiResponse.status, JSON.stringify(errBody));
      return new Response(
        JSON.stringify({ error: `AI service error (${aiResponse.status})` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const aiData = await aiResponse.json();
    const textContent = aiData.choices?.[0]?.message?.content;

    if (!textContent) {
      return new Response(JSON.stringify({ error: 'No response from AI' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // response_format: json_object guarantees valid JSON — parse directly
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(textContent);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr, 'raw content:', textContent);
      return new Response(JSON.stringify({ error: 'Could not parse AI response' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    parsed.imageUrl = publicUrl;

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('scan-receipt unhandled error:', e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
