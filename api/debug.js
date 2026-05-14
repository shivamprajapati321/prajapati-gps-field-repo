// ═══════════════════════════════════════════════════════════════════════════
// /api/debug.js — COMPREHENSIVE FINAL FINDER
// Tests ALL possible vehicle details endpoints with VEHICLE DETAILS consent
// Usage: /api/debug?plate=MH14HM8257
// ═══════════════════════════════════════════════════════════════════════════

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MjIyNSwiZmlyc3ROYW1lIjoiQW5vbnltb3VzIiwibGFzdE5hbWUiOm51bGwsImVtYWlsIjpudWxsLCJwaG9uZSI6Ijk5MjIxMzgxMzgiLCJ1c2VyVHlwZSI6MSwiYXBwRGV2aWNlVHlwZSI6ImFwaSIsImNvdW50cnlJZCI6MTA0LCJjcmVhdGVkQXQiOiIyMDI1LTEwLTExVDA4OjAyOjQ1Ljc4OFoiLCJpYXQiOjE3NzM4MjQzNjAsImV4cCI6MjA4OTE4NDM2MH0.0-cB_noifVaki77sdPgGs1i9ZwzGW9EK3lyyDoChpI0";

const CONSENT_VEHICLE = 'We confirm and undertake that valid end-user consent has been obtained for fetching VEHICLE DETAILS using VEHICLE NUMBER, and that such consent remains active and unrevoked at the time of this request.';

const BASE = 'https://bifrost.unifers.ai';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const plate = (req.query.plate || 'MH14HM8257').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  
  // Try ALL possible paths
  const paths = [
    '/enrich/get-vehicle-details-v5',     // From working Rickshaw code
    '/enrich/get-vehicle-details-v6',
    '/enrich/get-vehicle-details-v7',
    '/enrich/get-vehicle-details',
    '/enrich/vehicle/get-vehicle-details',
    '/enrich/vehicle/details',
    '/enrich/vehicle/full-details',
    '/enrich/vehicle/info',
    '/enrich/vehicle/rc-details',
    '/enrich/vehicle/owner-details',
    '/enrich/vehicle/rc',
    '/v1/enrich/vehicle/details',
    '/api/enrich/vehicle/details'
  ];
  
  const body = JSON.stringify({
    Vehicle_Number: plate,
    Concent_Text: CONSENT_VEHICLE,
    Concent: 'Y'
  });
  
  const results = [];
  let winner = null;
  
  for (const path of paths) {
    if (winner) {
      results.push({ path: path, skipped: 'winner found' });
      continue;
    }
    
    try {
      const startTime = Date.now();
      const resp = await fetch(BASE + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': TOKEN
        },
        body: body
      });
      const text = await resp.text();
      const duration = Date.now() - startTime;
      
      let parsed = null;
      try { parsed = JSON.parse(text); } catch(e) {}
      
      const isExpress404 = text.includes('Cannot POST') || text.includes('<!DOCTYPE');
      const isAuthErr = resp.status === 401;
      const isApiErr = parsed && parsed.error === true;
      const isFullSuccess = parsed && !parsed.error && parsed.data && parsed.data.result;
      
      let verdict;
      if (isFullSuccess) {
        verdict = '🎉 FULL DETAILS FOUND!';
        winner = { path, body_preview: text.substring(0, 800), parsed };
      } else if (isExpress404) {
        verdict = '❌ 404 path not found';
      } else if (isAuthErr) {
        verdict = '🔑 401 unauthorized';
      } else if (isApiErr) {
        verdict = `⚠️ API error: ${parsed.message || 'unknown'}`;
      } else if (resp.ok) {
        verdict = `✅ 200 OK (but unusual response structure)`;
        // Even unusual successes could be wins
        if (!winner) winner = { path, body_preview: text.substring(0, 800), parsed };
      } else {
        verdict = `⚠️ Status ${resp.status}`;
      }
      
      results.push({
        path: path,
        status: resp.status,
        duration_ms: duration,
        verdict: verdict,
        body_preview: text.substring(0, 300)
      });
      
    } catch (err) {
      results.push({ path: path, error: err.message });
    }
  }
  
  let diagnosis;
  if (winner) {
    diagnosis = `🎉 FOUND WORKING PATH: ${winner.path}`;
  } else {
    diagnosis = '❌ NO PATHS WORKED. Either token revoked OR API completely changed. Best next step: check Rickshaw Survey GAS web app with FRESH plate (not from cache) to see if it still works.';
  }
  
  return res.status(200).json({
    timestamp: new Date().toISOString(),
    plate_tested: plate,
    diagnosis: diagnosis,
    winner: winner,
    all_results: results
  });
}
