// ═══════════════════════════════════════════════════════════════════════════
// /api/debug.js — V5 ENDPOINT FINAL TESTER
// Tests /enrich/get-vehicle-details-v5 with 6 different combinations
// to find exact working config
// Usage: /api/debug?plate=MH14HM8257
// ═══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const plate = (req.query.plate || 'MH14HM8257').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  
  // Token (hardcoded)
  const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MjIyNSwiZmlyc3ROYW1lIjoiQW5vbnltb3VzIiwibGFzdE5hbWUiOm51bGwsImVtYWlsIjpudWxsLCJwaG9uZSI6Ijk5MjIxMzgxMzgiLCJ1c2VyVHlwZSI6MSwiYXBwRGV2aWNlVHlwZSI6ImFwaSIsImNvdW50cnlJZCI6MTA0LCJjcmVhdGVkQXQiOiIyMDI1LTEwLTExVDA4OjAyOjQ1Ljc4OFoiLCJpYXQiOjE3NzM4MjQzNjAsImV4cCI6MjA4OTE4NDM2MH0.0-cB_noifVaki77sdPgGs1i9ZwzGW9EK3lyyDoChpI0";
  
  const URL_V5 = 'https://bifrost.unifers.ai/enrich/get-vehicle-details-v5';
  const URL_RCMOBILE = 'https://bifrost.unifers.ai/enrich/vehicle/rc-mobile';
  
  const consentText = 'We confirm and undertake that valid end-user consent has been obtained for fetching VEHICLE DETAILS using VEHICLE NUMBER, and that such consent remains active and unrevoked at the time of this request.';
  
  const tests = [
    {
      name: 'A. v5 — raw token, basic body',
      url: URL_V5,
      authHeader: TOKEN,
      body: { Vehicle_Number: plate, Concent: 'Y', Concent_Text: consentText }
    },
    {
      name: 'B. v5 — Bearer prefix, basic body',
      url: URL_V5,
      authHeader: 'Bearer ' + TOKEN,
      body: { Vehicle_Number: plate, Concent: 'Y', Concent_Text: consentText }
    },
    {
      name: 'C. v5 — raw token, with extras',
      url: URL_V5,
      authHeader: TOKEN,
      body: { 
        Vehicle_Number: plate, 
        Concent: 'Y', 
        Concent_Text: consentText,
        consent: 'Y',
        consent_text: consentText
      }
    },
    {
      name: 'D. v5 — lowercase fields',
      url: URL_V5,
      authHeader: TOKEN,
      body: { 
        vehicle_number: plate, 
        consent: 'Y', 
        consent_text: consentText
      }
    },
    {
      name: 'E. v5 — Bearer + lowercase',
      url: URL_V5,
      authHeader: 'Bearer ' + TOKEN,
      body: { 
        vehicle_number: plate, 
        consent: 'Y', 
        consent_text: consentText
      }
    },
    {
      name: 'F. CONTROL: rc-mobile — raw token',
      url: URL_RCMOBILE,
      authHeader: TOKEN,
      body: { 
        Vehicle_Number: plate, 
        Callback_Url: 'https://prajapati-gps-field-repo.vercel.app/api/findr-callback',
        Concent: 'Y', 
        Concent_Text: consentText.replace('VEHICLE DETAILS', 'MOBILE NUMBER')
      }
    }
  ];
  
  const results = [];
  
  for (const t of tests) {
    try {
      const startTime = Date.now();
      const resp = await fetch(t.url, {
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
      const isAuthErr = resp.status === 401 || (parsed && parsed.message === 'Invalid access token');
      const isSuccess = resp.ok && parsed && !parsed.error;
      
      let verdict;
      if (isSuccess) {
        verdict = '🎉 SUCCESS — Got valid data!';
      } else if (isExpressErr) {
        verdict = '❌ Path not found (Express 404)';
      } else if (isAuthErr) {
        verdict = '🔑 401 Invalid access token';
      } else if (parsed?.error) {
        verdict = '⚠️ API error: ' + (parsed.message || 'unknown');
      } else {
        verdict = `⚠️ Status ${resp.status}`;
      }
      
      results.push({
        test: t.name,
        url: t.url,
        auth_format: t.authHeader.startsWith('Bearer') ? 'Bearer + JWT' : 'Raw JWT',
        status: resp.status,
        duration_ms: duration,
        verdict: verdict,
        request_body_sent: t.body,
        response_body: text.substring(0, 600),
        parsed_response: parsed
      });
      
    } catch (err) {
      results.push({ test: t.name, error: err.message });
    }
  }
  
  // Diagnosis
  const winners = results.filter(r => r.verdict && r.verdict.includes('🎉'));
  let diagnosis;
  
  if (winners.length > 0) {
    diagnosis = `🎉 SUCCESS! Working config: "${winners[0].test}". Use: URL=${winners[0].url}, Auth=${winners[0].auth_format}`;
  } else {
    const allAuthFail = results.filter(r => !r.error).every(r => r.verdict && r.verdict.includes('🔑'));
    if (allAuthFail) {
      diagnosis = '🔑 ALL TESTS RETURN 401 — Token is definitely DEAD across all endpoints. The "v5" tip was incorrect. Fresh token needed from Unifers dashboard.';
    } else {
      diagnosis = '⚠️ Mixed results — check individual tests below for clues.';
    }
  }
  
  return res.status(200).json({
    timestamp: new Date().toISOString(),
    plate_tested: plate,
    diagnosis: diagnosis,
    winners: winners.length > 0 ? winners.map(w => ({ test: w.test, url: w.url, auth: w.auth_format })) : null,
    all_results: results
  });
}
