// ═══════════════════════════════════════════════════════════════════════════
// /api/debug.js — Multi-endpoint Findr finder (HARDCODED TOKEN)
// Tries 6 endpoint variations to find which one works
// Usage: /api/debug?plate=MH14HM8257
// ═══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const plate = (req.query.plate || 'MH14HM8257').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  
  // Token hardcoded
  const FINDR_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MjIyNSwiZmlyc3ROYW1lIjoiQW5vbnltb3VzIiwibGFzdE5hbWUiOm51bGwsImVtYWlsIjpudWxsLCJwaG9uZSI6Ijk5MjIxMzgxMzgiLCJ1c2VyVHlwZSI6MSwiYXBwRGV2aWNlVHlwZSI6ImFwaSIsImNvdW50cnlJZCI6MTA0LCJjcmVhdGVkQXQiOiIyMDI1LTEwLTExVDA4OjAyOjQ1Ljc4OFoiLCJpYXQiOjE3NzM4MjQzNjAsImV4cCI6MjA4OTE4NDM2MH0.0-cB_noifVaki77sdPgGs1i9ZwzGW9EK3lyyDoChpI0";
  
  // 6 endpoint variants to try
  const endpoints = [
    { name: 'v5',                     url: 'https://bifrost.unifers.ai/enrich/get-vehicle-details-v5', auth: FINDR_TOKEN },
    { name: 'v6',                     url: 'https://bifrost.unifers.ai/enrich/get-vehicle-details-v6', auth: FINDR_TOKEN },
    { name: 'v4 (original)',          url: 'https://bifrost.unifers.ai/enrich/get-vehicle-details-v4', auth: FINDR_TOKEN },
    { name: 'v3',                     url: 'https://bifrost.unifers.ai/enrich/get-vehicle-details-v3', auth: FINDR_TOKEN },
    { name: 'no-version',             url: 'https://bifrost.unifers.ai/enrich/get-vehicle-details',    auth: FINDR_TOKEN },
    { name: 'v4 with Bearer prefix',  url: 'https://bifrost.unifers.ai/enrich/get-vehicle-details-v4', auth: 'Bearer ' + FINDR_TOKEN }
  ];
  
  const body = JSON.stringify({
    Vehicle_Number: plate,
    Concent_Text: 'I authorize the use of this data for verification purposes.',
    Concent: 'Y'
  });
  
  const results = [];
  let winnerFound = false;
  
  for (const ep of endpoints) {
    if (winnerFound) {
      results.push({ name: ep.name, skipped: 'winner already found' });
      continue;
    }
    
    try {
      const startTime = Date.now();
      const resp = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': ep.auth
        },
        body: body
      });
      const text = await resp.text();
      const duration = Date.now() - startTime;
      
      const result = {
        name: ep.name,
        url: ep.url,
        status: resp.status,
        ok: resp.ok,
        duration_ms: duration,
        body_preview: text.substring(0, 400)
      };
      
      // Detect winner - 200 OK and not Express 404
      if (resp.ok && !text.includes('Cannot POST') && !text.includes('Cannot GET') && !text.includes('<!DOCTYPE')) {
        result.winner = true;
        winnerFound = true;
      }
      
      results.push(result);
      
    } catch (err) {
      results.push({ name: ep.name, error: err.message });
    }
  }
  
  const winner = results.find(r => r.winner);
  
  return res.status(200).json({
    timestamp: new Date().toISOString(),
    plate_tested: plate,
    winner: winner ? winner.name : null,
    winner_url: winner ? winner.url : null,
    winner_response: winner ? winner.body_preview : null,
    all_results: results,
    next_step: winner 
      ? '✅ SUCCESS! Update vehicle.js with the winner URL'
      : '⚠️ No endpoint worked. Check the all_results - see which gives best response, or contact Unifers.ai support to get current API docs.'
  });
}
