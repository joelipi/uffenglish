export const ALLOWED_ORIGINS = [
  'https://uffenglish.pages.dev',
  'https://go.ultrafastfluency.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'https://ultrafastfluency.com',
  // Staging — s.ultrafastfluency.com serves a non-production branch deployment
  // (see docs/deploy-environments.md), so the AI proxy must accept its origin.
  'https://s.ultrafastfluency.com',
  'https://t.ultrafastfluency.com',
  // Origins previously added to the deployed worker outside the repo (device
  // testing + the beacon app): extra Vite ports, a tailnet funnel host, a CGNAT
  // IP and a Pages preview app. Kept so a repo deploy does not silently drop
  // them. This worker attaches the server-side DEEPSEEK_API_KEY, so each of
  // these origins can spend the key — review and remove them here and in the
  // deployed worker together once they are no longer needed.
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176',
  'http://100.119.79.124',
  'https://100.119.79.124',
  'https://localhost-0.taild13d5c.ts.net',
  'https://beacon-au8.pages.dev',
];

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: { ...headers, Allow: 'POST, OPTIONS' },
      });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const DEEPSEEK_API_KEY = env.DEEPSEEK_API_KEY;
    if (!DEEPSEEK_API_KEY) {
      return new Response(JSON.stringify({ error: 'Server configuration error' }), {
        status: 500,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    const requestBody = {
      model: body.model || 'deepseek-v4-flash',
      messages: body.messages,
      temperature: body.temperature ?? 0.7,
      max_tokens: body.max_tokens ?? 1024,
      thinking: body.thinking ?? { type: 'disabled' },
    };

    try {
      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(requestBody),
      });

      const responseData = await response.json();
      responseData._debug = { sentToDeepSeek: requestBody };

      return new Response(JSON.stringify(responseData), {
        status: response.status,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 502,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
  },
};
