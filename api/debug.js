// ═══════════════════════════════════════════════════════════════════════════
// /api/debug.js — FINAL FINDR DEBUG (v5 endpoint - synchronous, full details)
// Tests with EXACT config from working Rickshaw Survey Code.gs
// Usage: /api/debug?plate=MH14HM8257
// ═══════════════════════════════════════════════════════════════════════════

const FINDR_URL   = 'https://bifrost.unifers.ai/enrich/get-vehicle-details-v5';
const FINDR_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MjIyNSwiZmlyc3ROYW1lIjoiQW5vbnltb3VzIiwibGFzdE5hbWUiOm51bGwsImVtYWlsIjpudWxsLCJwaG9uZSI6Ijk5MjIxMzgxMzgiLCJ1c2VyVHlwZSI6MSwiYXBwRGV2aWNlVHlwZSI6ImFwaSIsImNvdW50cnlJZCI6MTA0LCJjcmVhdGVkQXQiOiIyMDI1LTEwLTExVDA4OjAyOjQ1Ljc4OFoiLCJpYXQiOjE3NzM4MjQzNjAsImV4cCI6MjA4OTE4NDM2MH0.0-cB_noifVaki77sdPgGs1i9ZwzGW9EK3lyyDoChpI0';
const CONSENT     = 'We confirm and undertake that valid end-user consent has been obtained for fetching VEHICLE DETAILS using VEHICLE NUMBER, and that such consent remains active and unrevoked at the time of this request.';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const plate = (req.query.plate || 'MH14HM8257').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  
  const diagnostics = {
    timestamp: new Date().toISOString(),
    plate_tested: plate,
    endpoint: FINDR_URL,
    auth_format: 'Raw token (no Bearer prefix)',
    consent_text_keyword: 'VEHICLE DETAILS using VEHICLE NUMBER'
  };
  
  try {
    const startTime = Date.now();
    const findrResp = await fetch(FINDR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': FINDR_TOKEN
      },
      body: JSON.stringify({
        Vehicle_Number: plate,
        Concent_Text: CONSENT,
        Concent: 'Y'
      })
    });
    
    const text = await findrResp.text();
    const duration = Date.now() - startTime;
    
    let parsed;
    try { parsed = JSON.parse(text); } catch(e) {
      diagnostics.diagnosis = '❌ Findr returned non-JSON';
      diagnostics.raw_response = text.substring(0, 500);
      return res.status(200).json(diagnostics);
    }
    
    diagnostics.status = findrResp.status;
    diagnostics.ok = findrResp.ok;
    diagnostics.duration_ms = duration;
    diagnostics.response_body = parsed;
    
    if (findrResp.status === 401) {
      diagnostics.diagnosis = '🔑 Token revoked — Findr support contact karna padega';
      return res.status(200).json(diagnostics);
    }
    
    if (parsed.error === true) {
      diagnostics.diagnosis = '⚠️ Findr API error: ' + (parsed.message || 'Unknown');
      return res.status(200).json(diagnostics);
    }
    
    // Parse owner details (Rickshaw Survey style)
    const result = parsed.data && parsed.data.result ? parsed.data.result : null;
    const own = result ? result.owner_details : null;
    const vhc = result ? result.vehicle_details : null;
    const off = result ? result.office_details : null;
    
    diagnostics.extracted = {
      ownerName: own && own.name ? own.name : null,
      ownerMobile: own && own.mobile ? own.mobile : null,
      maker: vhc && vhc.maker ? vhc.maker : null,
      rto: off && off.rto ? off.rto : null,
      city: off && off.city ? off.city : null,
      state: off && off.state ? off.state : null
    };
    
    if (diagnostics.extracted.ownerName || diagnostics.extracted.ownerMobile) {
      diagnostics.diagnosis = '🎉 SUCCESS! Findr returned full vehicle details. Owner: ' + 
                              (diagnostics.extracted.ownerName || 'N/A') + 
                              ' | Mobile: ' + (diagnostics.extracted.ownerMobile || 'N/A');
    } else {
      diagnostics.diagnosis = '⚠️ Findr returned 200 but owner_details empty/masked';
    }
    
    return res.status(200).json(diagnostics);
    
  } catch (err) {
    diagnostics.diagnosis = '❌ Exception: ' + err.message;
    return res.status(200).json(diagnostics);
  }
}
