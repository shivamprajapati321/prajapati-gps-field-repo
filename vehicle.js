// /api/vehicle.js
// Vercel Serverless Function: Single Vehicle Lookup via Findr
//
// Usage:
//   GET /api/vehicle?plate=MH14GC3763
//   GET /api/vehicle/MH14GC3763 (with rewrite)
//
// Env vars needed in Vercel:
//   FINDR_URL    - Findr API endpoint
//   FINDR_TOKEN  - JWT token

const https = require('https');

// In-memory cache (resets on cold start, but Vercel keeps warm)
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

function cleanPlate(p) {
  return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isMasked(name) {
  if (!name) return false;
  return /[*X]{2,}/i.test(name);
}

function formatName(name) {
  if (!name) return null;
  return name.split(/\s+/).map(w => 
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  ).join(' ');
}

// Call Findr API
function callFindr(plate) {
  const FINDR_URL = process.env.FINDR_URL || 'https://bifrost.unifers.ai/enrich/get-vehicle-details-v4';
  const FINDR_TOKEN = process.env.FINDR_TOKEN || '';
  const FINDR_CONSENT = process.env.FINDR_CONSENT || 'Y';
  
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      Vehicle_Number: plate,
      Concent_Text: 'I authorize the use of this data for verification purposes.',
      Concent: FINDR_CONSENT
    });
    
    const url = new URL(FINDR_URL);
    const options = {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': FINDR_TOKEN,
        'Content-Length': body.length
      },
      timeout: 15000
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
    
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  // Get plate from query OR path
  let plate = req.query.plate || '';
  
  // If using /api/vehicle/PLATE pattern (via rewrite)
  if (!plate && req.url) {
    const match = req.url.match(/\/api\/vehicle\/([^?\/]+)/);
    if (match) plate = match[1];
  }
  
  plate = cleanPlate(plate);
  
  if (!plate || plate.length < 4) {
    return res.status(400).json({
      success: false,
      error: 'Invalid plate. Use: /api/vehicle?plate=MH14GC3763'
    });
  }
  
  // Check cache
  const cached = cache.get(plate);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
    return res.json({ success: true, source: 'cache', data: cached.data });
  }
  
  // Check token configured
  if (!process.env.FINDR_TOKEN) {
    return res.status(500).json({
      success: false,
      error: 'FINDR_TOKEN not configured in Vercel environment variables',
      hint: 'Add FINDR_TOKEN in Vercel project settings'
    });
  }
  
  // Call Findr
  try {
    const result = await callFindr(plate);
    
    if (result.status !== 200) {
      return res.json({
        success: false,
        error: 'Findr API returned status ' + result.status,
        httpStatus: result.status,
        response: result.data || result.raw,
        plate: plate
      });
    }
    
    // Try multiple response paths
    const r = result.data;
    const dataObj = r?.data?.result || r?.result || r?.data || r || {};
    const owner = dataObj.owner_details || dataObj.ownerDetails || dataObj.owner || {};
    const vehicle = dataObj.vehicle_details || dataObj.vehicleDetails || dataObj.vehicle || {};
    const office = dataObj.office_details || dataObj.officeDetails || dataObj.rto_details || {};
    
    const rawName = owner.name || owner.owner_name || owner.full_name || dataObj.owner_name || null;
    const mobile = owner.mobile || owner.phone || owner.contact || owner.mobile_no || dataObj.mobile || null;
    
    const data = {
      plate: plate,
      ownerName: rawName ? (!isMasked(rawName) ? formatName(rawName) : rawName) : null,
      mobile: mobile,
      maker: vehicle.maker || vehicle.make || vehicle.manufacturer || null,
      model: vehicle.model || vehicle.vehicle_model || null,
      regDate: vehicle.registration_date || vehicle.reg_date || null,
      fuelType: vehicle.fuel_type || vehicle.fuelType || null,
      rto: office.rto || office.office_name || dataObj.rto || null,
      isMasked: isMasked(rawName),
      creditsUsed: r?.data?.creditUsed || r?.creditUsed || 0
    };
    
    // Cache it
    cache.set(plate, { data, ts: Date.now() });
    
    return res.json({ success: true, source: 'findr', data });
    
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message,
      plate: plate
    });
  }
};
