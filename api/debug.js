// ═══════════════════════════════════════════════════════════════════════════
// /api/debug.js — Diagnostic endpoint
// Tests Findr API directly, shows exact response (helpful for IP whitelist issue)
// Usage: /api/debug?plate=MH14HM8257
// ═══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const plate = (req.query.plate || 'MH14HM8257').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  
const FINDR_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MjIyNSwiZmlyc3ROYW1lIjoiQW5vbnltb3VzIiwibGFzdE5hbWUiOm51bGwsImVtYWlsIjpudWxsLCJwaG9uZSI6Ijk5MjIxMzgxMzgiLCJ1c2VyVHlwZSI6MSwiYXBwRGV2aWNlVHlwZSI6ImFwaSIsImNvdW50cnlJZCI6MTA0LCJjcmVhdGVkQXQiOiIyMDI1LTEwLTExVDA4OjAyOjQ1Ljc4OFoiLCJpYXQiOjE3NzM4MjQzNjAsImV4cCI6MjA4OTE4NDM2MH0.0-cB_noifVaki77sdPgGs1i9ZwzGW9EK3lyyDoChpI0";  
  const diagnostics = {
    timestamp: new Date().toISOString(),
    plate_tested: plate,
    env_check: {
      findr_token_configured: !!FINDR_TOKEN,
      findr_token_length: FINDR_TOKEN ? FINDR_TOKEN.length : 0,
      findr_token_preview: FINDR_TOKEN ? FINDR_TOKEN.substring(0, 20) + '...' : 'MISSING'
    },
    vercel_region: process.env.VERCEL_REGION || 'unknown',
    findr_test: null
  };
  
  if (!FINDR_TOKEN) {
    diagnostics.findr_test = { error: 'FINDR_TOKEN env var not set in Vercel dashboard' };
    return res.status(200).json(diagnostics);
  }
  
  try {
    const startTime = Date.now();
    const findrResp = await fetch('https://bifrost.unifers.ai/enrich/get-vehicle-details-v4', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': FINDR_TOKEN
      },
      body: JSON.stringify({
        Vehicle_Number: plate,
        Concent_Text: 'Debug test',
        Concent: 'Y'
      })
    });
    
    const text = await findrResp.text();
    const duration = Date.now() - startTime;
    
    diagnostics.findr_test = {
      status: findrResp.status,
      ok: findrResp.ok,
      duration_ms: duration,
      headers: Object.fromEntries(findrResp.headers.entries()),
      response_body: text.substring(0, 1000),
      response_size: text.length
    };
    
    // Common error detection
    if (text.includes('not in allowlist') || text.includes('whitelist')) {
      diagnostics.diagnosis = '⚠️ IP WHITELIST ISSUE — Vercel IP needs to be added to Findr allowlist. Contact Unifers.ai support.';
    } else if (findrResp.ok) {
      diagnostics.diagnosis = '✅ Findr API working from this Vercel deployment';
    }
    
  } catch (err) {
    diagnostics.findr_test = { error: err.message };
  }
  
  return res.status(200).json(diagnostics);
}
