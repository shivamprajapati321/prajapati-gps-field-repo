// ═══════════════════════════════════════════════════════════════════════════
// /api/debug.js — FINDR v5 SYNCHRONOUS TEST
// Tests /enrich/get-vehicle-details-v5 with VEHICLE DETAILS consent
// Mirror of working Rickshaw Survey GAS code
// Usage: /api/debug?plate=MH14HM8257
// ═══════════════════════════════════════════════════════════════════════════

const FINDR_URL = 'https://bifrost.unifers.ai/enrich/get-vehicle-details-v5';
const FINDR_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MjIyNSwiZmlyc3ROYW1lIjoiQW5vbnltb3VzIiwibGFzdE5hbWUiOm51bGwsImVtYWlsIjpudWxsLCJwaG9uZSI6Ijk5MjIxMzgxMzgiLCJ1c2VyVHlwZSI6MSwiYXBwRGV2aWNlVHlwZSI6ImFwaSIsImNvdW50cnlJZCI6MTA0LCJjcmVhdGVkQXQiOiIyMDI1LTEwLTExVDA4OjAyOjQ1Ljc4OFoiLCJpYXQiOjE3NzM4MjQzNjAsImV4cCI6MjA4OTE4NDM2MH0.0-cB_noifVaki77sdPgGs1i9ZwzGW9EK3lyyDoChpI0";

const CONSENT_TEXT = 'We confirm and undertake that valid end-user consent has been obtained for fetching VEHICLE DETAILS using VEHICLE NUMBER, and that such consent remains active and unrevoked at the time of this request.';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  const plate = (req.query.plate || 'MH14HM8257').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
  
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
        Concent_Text: CONSENT_TEXT,
        Concent: 'Y'
      })
    });
    
    const text = await findrResp.text();
    const duration = Date.now() - startTime;
    
    let parsed = null;
    try { parsed = JSON.parse(text); } catch(e) {}
    
    // Try to extract structured details if successful
    let extracted = null;
    if (parsed && parsed.data && parsed.data.result) {
      const r = parsed.data.result;
      extracted = {
        owner_name: r.owner_details?.name || null,
        mobile: r.owner_details?.mobile || null,
        maker: r.vehicle_details?.maker || null,
        vehicleClass: r.vehicle_details?.class || null,
        rto: r.office_details?.rto || null,
        city: r.office_details?.city || r.address_details?.city || null,
        state: r.office_details?.state || r.address_details?.state || null,
        pincode: r.office_details?.pincode || r.address_details?.pincode || null,
        regDate: r.vehicle_details?.registration_date || null
      };
    }
    
    return res.status(200).json({
      timestamp: new Date().toISOString(),
      plate_tested: plate,
      endpoint: FINDR_URL,
      auth_method: 'Raw JWT (no Bearer prefix)',
      consent_type: 'VEHICLE DETAILS',
      status: findrResp.status,
      ok: findrResp.ok,
      duration_ms: duration,
      api_error: parsed?.error || false,
      api_message: parsed?.message || null,
      verdict: parsed && !parsed.error && extracted?.owner_name 
        ? '🎉 SUCCESS — FULL DETAILS FETCHED!'
        : parsed?.error 
        ? `⚠️ API error: ${parsed.message}`
        : '❌ Unknown response',
      extracted_data: extracted,
      raw_response: parsed || text.substring(0, 600)
    });
    
  } catch (err) {
    return res.status(500).json({
      timestamp: new Date().toISOString(),
      plate_tested: plate,
      error: err.message
    });
  }
}
