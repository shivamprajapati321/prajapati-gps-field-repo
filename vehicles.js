// /api/vehicles.js
// Vercel Serverless Function: Bulk Vehicle Lookup
//
// Usage:
//   POST /api/vehicles
//   Body: { "plates": ["MH14GC3763", "MH12TU6920"] }
//
// Env vars same as /api/vehicle.js

const https = require('https');

const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000;

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
      timeout: 12000
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, data: null, raw: data });
        }
      });
    });
    
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });
    
    req.write(body);
    req.end();
  });
}

function parseResponse(plate, result) {
  const r = result.data;
  const dataObj = r?.data?.result || r?.result || r?.data || r || {};
  const owner = dataObj.owner_details || dataObj.ownerDetails || dataObj.owner || {};
  const vehicle = dataObj.vehicle_details || dataObj.vehicleDetails || dataObj.vehicle || {};
  const office = dataObj.office_details || dataObj.officeDetails || dataObj.rto_details || {};
  
  const rawName = owner.name || owner.owner_name || owner.full_name || dataObj.owner_name || null;
  const mobile = owner.mobile || owner.phone || owner.contact || owner.mobile_no || dataObj.mobile || null;
  
  return {
    plate: plate,
    ownerName: rawName ? (!isMasked(rawName) ? formatName(rawName) : rawName) : null,
    mobile: mobile,
    maker: vehicle.maker || vehicle.make || vehicle.manufacturer || null,
    regDate: vehicle.registration_date || vehicle.reg_date || null,
    rto: office.rto || office.office_name || dataObj.rto || null,
    isMasked: isMasked(rawName)
  };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST with body: {plates: [...]}' });
  }
  
  const { plates } = req.body || {};
  
  if (!Array.isArray(plates) || plates.length === 0) {
    return res.status(400).json({ error: 'plates[] required in body' });
  }
  
  if (plates.length > 50) {
    return res.status(400).json({ error: 'Max 50 plates per request' });
  }
  
  if (!process.env.FINDR_TOKEN) {
    return res.status(500).json({ error: 'FINDR_TOKEN not configured' });
  }
  
  const results = {};
  let cacheHits = 0;
  let apiCalls = 0;
  let failed = 0;
  
  for (const p of plates) {
    const plate = cleanPlate(p);
    if (!plate || plate.length < 4) {
      results[p] = { success: false, error: 'Invalid plate' };
      continue;
    }
    
    // Cache check
    const cached = cache.get(plate);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
      results[plate] = { success: true, source: 'cache', data: cached.data };
      cacheHits++;
      continue;
    }
    
    try {
      const result = await callFindr(plate);
      
      if (result.status !== 200) {
        results[plate] = {
          success: false,
          error: 'Status ' + result.status,
          httpStatus: result.status
        };
        failed++;
        continue;
      }
      
      const data = parseResponse(plate, result);
      cache.set(plate, { data, ts: Date.now() });
      results[plate] = { success: true, source: 'findr', data };
      apiCalls++;
      
    } catch (err) {
      results[plate] = { success: false, error: err.message };
      failed++;
    }
    
    // Rate limit: 300ms between calls
    await new Promise(r => setTimeout(r, 300));
  }
  
  const found = Object.values(results).filter(r => r.success).length;
  
  return res.json({
    results,
    found,
    total: plates.length,
    stats: { cacheHits, apiCalls, failed }
  });
};
