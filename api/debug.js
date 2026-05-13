// ═══════════════════════════════════════════════════════════════════════════
// /api/debug.js — NEW URL PATTERN FINDER v3
// Tests /enrich/vehicle/<action> endpoints (Findr migrated from v4)
// All with Bearer prefix (which we know is now required)
// Usage: /api/debug?plate=MH14HM8257
// ═══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const plate = (req.query.plate || 'MH14HM8257').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  
  // Token hardcoded
  const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MjIyNSwiZmlyc3ROYW1lIjoiQW5vbnltb3VzIiwibGFzdE5hbWUiOm51bGwsImVtYWlsIjpudWxsLCJwaG9uZSI6Ijk5MjIxMzgxMzgiLCJ1c2VyVHlwZSI6MSwiYXBwRGV2aWNlVHlwZSI6ImFwaSIsImNvdW50cnlJZCI6MTA0LCJjcmVhdGVkQXQiOiIyMDI1LTEwLTExVDA4OjAyOjQ1Ljc4OFoiLCJpYXQiOjE3NzM4MjQzNjAsImV4cCI6MjA4OTE4NDM2MH0.0-cB_noifVaki77sdPgGs1i9ZwzGW9EK3lyyDoChpI0";
  
  const BEARER = 'Bearer ' + TOKEN;
  const BASE = 'https://bifrost.unifers.ai';
  
  // Standard request body (synchronous, no callback)
  const stdBody = {
    Vehicle_Number: plate,
    Concent_Text: 'We confirm and undertake that valid end-user consent has been obtained for fetching VEHICLE DETAILS using VEHICLE NUMBER, and that such consent remains active and unrevoked at the time of this request.',
    Concent: 'Y'
  };
  
  // All NEW pattern endpoints to test
  const tests = [
    { name: 'vehicle/details',         path: '/enrich/vehicle/details',         body: stdBody },
    { name: 'vehicle/info',            path: '/enrich/vehicle/info',            body: stdBody },
    { name: 'vehicle/rc',              path: '/enrich/vehicle/rc',              body: stdBody },
    { name: 'vehicle/rc-details',      path: '/enrich/vehicle/rc-details',      body: stdBody },
    { name: 'vehicle/get-details',     path: '/enrich/vehicle/get-details',     body: stdBody },
    { name: 'vehicle/full-details',    path: '/enrich/vehicle/full-details',    body: stdBody },
    { name: 'vehicle/rc-mobile (known)',path: '/enrich/vehicle/rc-mobile',      body: {...stdBody, Callback_Url: 'https://example.com/cb'} }
  ];
  
  const results = [];
  let winner = null;
  
  for (const t of tests) {
    try {
      const startTime = Date.now();
      const resp = await fetch(BASE + t.path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': BEARER
        },
        body: JSON.stringify(t.body)
      });
      const text = await resp.text();
      const duration = Date.now() - startTime;
      
      const isExpressError = text.includes('Cannot POST') || text.includes('<!DOCTYPE');
      const isAuthError = resp.status === 401 || text.includes('Invalid access token') || text.includes('Unauthorized');
      const isSuccess = resp.ok && !isExpressError && !isAuthError;
      
      const result = {
        name: t.name,
        path: t.path,
        status: resp.status,
        duration_ms: duration,
        verdict: isSuccess ? '✅ WORKS' : 
                 isExpressError ? '❌ Path not found (Express 404)' :
                 isAuthError ? '🔑 Auth failed (token invalid)' :
                 `⚠️ Other (${resp.status})`,
        body_preview: text.substring(0, 350)
      };
      
      if (isSuccess && !winner) winner = result;
      results.push(result);
      
    } catch (err) {
      results.push({ name: t.name, error: err.message });
    }
  }
  
  // Diagnosis
  let diagnosis;
  const anyAuthError = results.some(r => r.verdict && r.verdict.includes('🔑'));
  const anySuccess = !!winner;
  
  if (anySuccess) {
    diagnosis = '🎉 SUCCESS! Found working endpoint: ' + winner.path;
  } else if (anyAuthError) {
    diagnosis = '🔑 TOKEN PROBLEM — All endpoints return 401. Token has been rotated/revoked. Login to Findr dashboard, generate fresh token, update vehicle.js & debug.js.';
  } else {
    diagnosis = '❌ All endpoint paths return 404. Findr has changed API structure completely. Check Postman docs for current vehicle details endpoint, or contact Unifers support.';
  }
  
  return res.status(200).json({
    timestamp: new Date().toISOString(),
    plate_tested: plate,
    auth_method: 'Bearer prefix + raw JWT',
    diagnosis: diagnosis,
    winner: winner,
    all_results: results
  });
}
