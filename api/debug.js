// ═══════════════════════════════════════════════════════════════════════════
// /api/debug.js — RC-MOBILE ENDPOINT TESTER v4
// Tests confirmed endpoint /enrich/vehicle/rc-mobile in 4 ways:
//   1. Sync, no Bearer prefix
//   2. Sync, with Bearer prefix
//   3. Async with Callback_Url, no Bearer
//   4. Async with Callback_Url, with Bearer
// Usage: /api/debug?plate=MH14HM8257
// ═══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const plate = (req.query.plate || 'MH14HM8257').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  
  // Token (hardcoded)
  const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MjIyNSwiZmlyc3ROYW1lIjoiQW5vbnltb3VzIiwibGFzdE5hbWUiOm51bGwsImVtYWlsIjpudWxsLCJwaG9uZSI6Ijk5MjIxMzgxMzgiLCJ1c2VyVHlwZSI6MSwiYXBwRGV2aWNlVHlwZSI6ImFwaSIsImNvdW50cnlJZCI6MTA0LCJjcmVhdGVkQXQiOiIyMDI1LTEwLTExVDA4OjAyOjQ1Ljc4OFoiLCJpYXQiOjE3NzM4MjQzNjAsImV4cCI6MjA4OTE4NDM2MH0.0-cB_noifVaki77sdPgGs1i9ZwzGW9EK3lyyDoChpI0";
  
  const URL = 'https://bifrost.unifers.ai/enrich/vehicle/rc-mobile';
  const CONSENT_TEXT = 'We confirm and undertake that valid end-user consent has been obtained for fetching MOBILE NUMBER using VEHICLE NUMBER, and that such consent remains active and unrevoked at the time of this request.';
  
  const tests = [
    {
      name: '1. Sync (no Callback_Url) — raw token',
      authHeader: TOKEN,
      body: { Vehicle_Number: plate, Concent: 'Y', Concent_Text: CONSENT_TEXT }
    },
    {
      name: '2. Sync (no Callback_Url) — Bearer prefix',
      authHeader: 'Bearer ' + TOKEN,
      body: { Vehicle_Number: plate, Concent: 'Y', Concent_Text: CONSENT_TEXT }
    },
    {
      name: '3. Async (with Callback_Url) — raw token',
      authHeader: TOKEN,
      body: { 
        Vehicle_Number: plate, 
        Callback_Url: 'https://prajapati-gps-field-repo.vercel.app/api/findr-callback',
        Concent: 'Y', 
        Concent_Text: CONSENT_TEXT 
      }
    },
    {
      name: '4. Async (with Callback_Url) — Bearer prefix',
      authHeader: 'Bearer ' + TOKEN,
      body: { 
        Vehicle_Number: plate, 
        Callback_Url: 'https://prajapati-gps-field-repo.vercel.app/api/findr-callback',
        Concent: 'Y', 
        Concent_Text: CONSENT_TEXT 
      }
    }
  ];
  
  const results = [];
  
  for (const t of tests) {
    try {
      const startTime = Date.now();
      const resp = await fetch(URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': t.authHeader
        },
        body: JSON.stringify(t.body)
      });
      const text = await resp.text();
      const duration = Date.now() - startTime;
      
      let parsed = null;
      try { parsed = JSON.parse(text); } catch(e) {}
      
      const isExpressErr = text.includes('Cannot POST') || text.includes('<!DOCTYPE');
      const isAuthErr = resp.status === 401 || text.includes('Invalid access token');
      const isSuccess = resp.ok && parsed && !parsed.error;
      
      let verdict;
      if (isSuccess) {
        // Check if mobile is in response or requestId only (async)
        const hasMobile = parsed?.data?.result?.Mobile_Number || parsed?.data?.result?.mobile;
        const hasRequestId = parsed?.requestId || parsed?.data?.requestId;
        verdict = hasMobile ? '✅ SUCCESS — Sync (mobile in response)' :
                  hasRequestId ? '✅ SUCCESS — Async (requestId returned, callback pending)' :
                  '✅ SUCCESS (check body)';
      } else if (isExpressErr) {
        verdict = '❌ Path not found';
      } else if (isAuthErr) {
        verdict = '🔑 Token invalid (401)';
      } else if (parsed?.error) {
        verdict = '⚠️ API error: ' + (parsed.message || 'unknown');
      } else {
        verdict = `⚠️ Other (status ${resp.status})`;
      }
      
      results.push({
        test: t.name,
        status: resp.status,
        duration_ms: duration,
        verdict: verdict,
        request_body: t.body,
        response_body: text.substring(0, 600),
        parsed: parsed
      });
      
    } catch (err) {
      results.push({ test: t.name, error: err.message });
    }
  }
  
  // Diagnosis
  const winners = results.filter(r => r.verdict && r.verdict.includes('✅'));
  let diagnosis;
  let mode = null;
  
  if (winners.length > 0) {
    const first = winners[0];
    mode = first.verdict.includes('Sync') ? 'SYNC' : 
           first.verdict.includes('Async') ? 'ASYNC' : 'UNKNOWN';
    diagnosis = `🎉 SUCCESS! Endpoint works in ${mode} mode. Winning test: "${first.test}"`;
  } else if (results.every(r => r.verdict && r.verdict.includes('🔑'))) {
    diagnosis = '🔑 TOKEN REVOKED — All 4 tests return 401. Get fresh token from Unifers dashboard.';
  } else {
    diagnosis = '⚠️ Mixed results — check individual test outcomes below.';
  }
  
  return res.status(200).json({
    timestamp: new Date().toISOString(),
    plate_tested: plate,
    endpoint: URL,
    diagnosis: diagnosis,
    mode_detected: mode,
    all_results: results
  });
}
