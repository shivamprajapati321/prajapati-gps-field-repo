// ═══════════════════════════════════════════════════════════════════════════
// /api/vehicle.js — FINAL FINDR (full owner + mobile + RTO + maker + address)
// Ported from working Rickshaw Survey GAS code (Code.gs)
// Endpoint: get-vehicle-details-v5 (SYNCHRONOUS, returns full owner_details)
// ═══════════════════════════════════════════════════════════════════════════

const FINDR_URL   = 'https://bifrost.unifers.ai/enrich/get-vehicle-details-v5';
const FINDR_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6MjIyNSwiZmlyc3ROYW1lIjoiQW5vbnltb3VzIiwibGFzdE5hbWUiOm51bGwsImVtYWlsIjpudWxsLCJwaG9uZSI6Ijk5MjIxMzgxMzgiLCJ1c2VyVHlwZSI6MSwiYXBwRGV2aWNlVHlwZSI6ImFwaSIsImNvdW50cnlJZCI6MTA0LCJjcmVhdGVkQXQiOiIyMDI1LTEwLTExVDA4OjAyOjQ1Ljc4OFoiLCJpYXQiOjE3NzM4MjQzNjAsImV4cCI6MjA4OTE4NDM2MH0.0-cB_noifVaki77sdPgGs1i9ZwzGW9EK3lyyDoChpI0';
const CONSENT     = 'We confirm and undertake that valid end-user consent has been obtained for fetching VEHICLE DETAILS using VEHICLE NUMBER, and that such consent remains active and unrevoked at the time of this request.';

const SUPABASE_URL = 'https://fpbktcgtspqsqpaytslv.supabase.co';
const SUPABASE_KEY = 'sb_publishable_JhObe56x_zETygpy6y8-DQ_qpQXIz_j';

function formatName(s) {
  if (!s) return '';
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'Method not allowed' });
  
  // Extract plate from query or URL path
  let plate = (req.query.plate || '').toString().toUpperCase().trim();
  if (!plate && req.url) {
    const parts = req.url.split('?')[0].split('/').filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && last !== 'vehicle') plate = decodeURIComponent(last).toUpperCase().trim();
  }
  plate = plate.replace(/[^A-Z0-9]/g, '');
  
  if (!plate || plate.length < 4) {
    return res.status(400).json({ success: false, error: 'Invalid plate number' });
  }
  
  try {
    // ─── Step 1: Check Supabase cache first (save Findr API credits) ───
    try {
      const cacheResp = await fetch(
        `${SUPABASE_URL}/rest/v1/prajapati_vehicle_lookup?select=*&plate=eq.${encodeURIComponent(plate)}`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
      );
      if (cacheResp.ok) {
        const cached = await cacheResp.json();
        if (cached && cached.length > 0 && (cached[0].owner_name || cached[0].mobile)) {
          const c = cached[0];
          return res.status(200).json({
            success: true,
            source: 'cache',
            plate: plate,
            data: {
              ownerName: c.manual_override_name || c.owner_name || '',
              mobile:    c.manual_override_mobile || c.mobile || '',
              maker:     c.maker || '',
              rto:       c.rto || '',
              city:      c.rto_city || '',
              state:     c.rto_state || '',
              regDate:   c.registration_date || null,
              isMasked:  c.is_masked || false
            }
          });
        }
      }
    } catch(cacheErr) { /* cache failure non-fatal */ }
    
    // ─── Step 2: Call Findr API (synchronous v5 endpoint) ───
    const findrResp = await fetch(FINDR_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': FINDR_TOKEN  // RAW token, NO Bearer prefix
      },
      body: JSON.stringify({
        Vehicle_Number: plate,
        Concent_Text: CONSENT,
        Concent: 'Y'
      })
    });
    
    const findrText = await findrResp.text();
    let findrData;
    try { findrData = JSON.parse(findrText); } catch(e) {
      return res.status(200).json({
        success: false,
        plate: plate,
        error: 'Findr returned non-JSON',
        raw: findrText.substring(0, 300)
      });
    }
    
    if (!findrResp.ok) {
      return res.status(200).json({
        success: false,
        plate: plate,
        status: findrResp.status,
        error: findrData.message || `HTTP ${findrResp.status}`,
        raw: findrData
      });
    }
    
    if (findrData.error === true) {
      return res.status(200).json({
        success: false,
        plate: plate,
        error: findrData.message || 'Not found in Findr',
        raw: findrData
      });
    }
    
    // ─── Step 3: Parse response (exact same as Rickshaw Survey code) ───
    const result = findrData.data && findrData.data.result ? findrData.data.result : null;
    const own = result ? result.owner_details : null;
    const vhc = result ? result.vehicle_details : null;
    const off = result ? result.office_details : null;
    const addr = result ? result.address_details : null;
    
    const veh = {
      ownerName:    own && own.name   ? formatName(own.name) : '',
      ownerMobile:  own && own.mobile ? own.mobile : '',
      maker:        vhc && vhc.maker  ? vhc.maker.trim() : '',
      vehicleClass: vhc && vhc.class  ? vhc.class : '',
      regDate:      vhc && vhc.registration_date ? vhc.registration_date : null,
      rto:          off && off.rto    ? off.rto : '',
      pinCode:      (off && off.pincode) ? String(off.pincode) :
                    (off && off.pin)     ? String(off.pin) :
                    (addr && addr.pincode)? String(addr.pincode) :
                    (own && own.pincode) ? String(own.pincode) : '',
      city:         (off && off.city)    ? off.city :
                    (addr && addr.city)  ? addr.city : '',
      state:        (off && off.state)   ? off.state :
                    (addr && addr.state) ? addr.state : ''
    };
    
    // ─── Step 4: Save to Supabase cache (for next time) ───
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/prajapati_vehicle_lookup?on_conflict=plate`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=minimal'
        },
        body: JSON.stringify([{
          plate: plate,
          plate_raw: plate,
          owner_name: veh.ownerName || null,
          mobile: veh.ownerMobile || null,
          maker: veh.maker || null,
          vehicle_type: veh.vehicleClass || null,
          rto: veh.rto || null,
          rto_city: veh.city || null,
          rto_state: veh.state || null,
          registration_date: veh.regDate || null,
          source: 'findr',
          verified: true,
          raw_response: findrData
        }])
      });
    } catch(saveErr) { /* cache save non-fatal */ }
    
    // ─── Step 5: Return data to client ───
    return res.status(200).json({
      success: true,
      source: 'findr',
      plate: plate,
      data: {
        ownerName:    veh.ownerName,
        mobile:       veh.ownerMobile,
        maker:        veh.maker,
        vehicleClass: veh.vehicleClass,
        regDate:      veh.regDate,
        rto:          veh.rto,
        pinCode:      veh.pinCode,
        city:         veh.city,
        state:        veh.state
      }
    });
    
  } catch (err) {
    return res.status(500).json({
      success: false,
      plate: plate,
      error: err.message
    });
  }
}
