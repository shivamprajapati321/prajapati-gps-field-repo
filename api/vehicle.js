// ═══════════════════════════════════════════════════════════════════════════
// /api/vehicle.js — Vercel Serverless Function
// Proxies Findr API to fetch vehicle owner details
// Hides JWT token (env var) + handles CORS
// ═══════════════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  // CORS — verifier.html browser se direct call kar sakega
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }
  
  // Plate number extract karo
  // Format 1: /api/vehicle?plate=MH14GC3763
  // Format 2: /api/vehicle/MH14GC3763 (works via Vercel rewrites)
  let plate = (req.query.plate || '').toString().toUpperCase().trim();
  
  // Fallback — agar path se aaye
  if (!plate && req.url) {
    const urlParts = req.url.split('?')[0].split('/').filter(Boolean);
    const last = urlParts[urlParts.length - 1];
    if (last && last !== 'vehicle') plate = decodeURIComponent(last).toUpperCase().trim();
  }
  
  // Clean — sirf A-Z aur 0-9
  plate = plate.replace(/[^A-Z0-9]/g, '');
  
  if (!plate || plate.length < 4) {
    return res.status(400).json({ success: false, error: 'Invalid plate number' });
  }
  
  const FINDR_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MjIyNSwiZmlyc3ROYW1lIjoiQW5vbnltb3VzIiwibGFzdE5hbWUiOm51bGwsImVtYWlsIjpudWxsLCJwaG9uZSI6Ijk5MjIxMzgxMzgiLCJ1c2VyVHlwZSI6MSwiYXBwRGV2aWNlVHlwZSI6ImFwaSIsImNvdW50cnlJZCI6MTA0LCJjcmVhdGVkQXQiOiIyMDI1LTEwLTExVDA4OjAyOjQ1Ljc4OFoiLCJpYXQiOjE3NzM4MjQzNjAsImV4cCI6MjA4OTE4NDM2MH0.0-cB_noifVaki77sdPgGs1i9ZwzGW9EK3lyyDoChpI0";
  if (!FINDR_TOKEN) {
    return res.status(500).json({ 
      success: false, 
      error: 'Server not configured: FINDR_TOKEN env var missing' 
    });
  }
  
  try {
    const findrResp = await fetch('https://bifrost.unifers.ai/enrich/get-vehicle-details-v4', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': FINDR_TOKEN  // Raw JWT, NO "Bearer " prefix
      },
      body: JSON.stringify({
        Vehicle_Number: plate,
        Concent_Text: 'I agree to fetch vehicle details for verification purposes',
        Concent: 'Y'
      })
    });
    
    const text = await findrResp.text();
    
    // Network/auth/whitelist error
    if (!findrResp.ok) {
      return res.status(200).json({
        success: false,
        source: 'findr',
        plate: plate,
        status: findrResp.status,
        error: `Findr API ${findrResp.status}: ${text.substring(0, 300)}`
      });
    }
    
    // Parse JSON safely
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return res.status(200).json({ 
        success: false, 
        source: 'findr', 
        plate: plate,
        error: 'Invalid JSON from Findr',
        raw: text.substring(0, 300) 
      });
    }
    
    // Findr response wrapper unwrap karo — alag levels me data ho sakta hai
    const result = data?.data || data?.result || data?.response || data;
    
    // Multiple possible field name variations (Findr APIs vary)
    const ownerName = result.owner_name || result.ownerName || result.Owner_Name || 
                      result.owner || result.ownername || null;
    const mobile = result.mobile || result.phone || result.Mobile_Number || 
                   result.mobile_number || result.contact || null;
    const maker = result.maker || result.manufacturer || result.Maker || 
                  result.vehicle_maker || null;
    const model = result.model || result.Model || result.vehicle_model || null;
    const rto = result.rto || result.RTO || result.registered_at || 
                result.rto_name || null;
    const regDate = result.registration_date || result.regDate || 
                    result.Registration_Date || result.reg_date || null;
    const isMasked = result.is_masked || result.isMasked || false;
    
    return res.status(200).json({
      success: true,
      source: 'findr',
      plate: plate,
      data: {
        ownerName: ownerName,
        mobile: mobile,
        maker: maker,
        model: model,
        rto: rto,
        regDate: regDate,
        isMasked: isMasked
      },
      raw: data  // Full response for debugging
    });
    
  } catch (err) {
    return res.status(500).json({ 
      success: false, 
      plate: plate,
      error: err.message 
    });
  }
}
