// ═══════════════════════════════════════════════════════════════════════════
// PRAJAPATI FINDR SERVER - PRODUCTION (v2)
// ═══════════════════════════════════════════════════════════════════════════
//
// Purpose: Vehicle owner lookup via Findr API
// Used by: GPS Admin Panel + Client Portal (for ZIP enrichment)
//
// Endpoints:
//   GET  /                    - Server info
//   GET  /health              - Health check
//   GET  /api/vehicle/:plate  - Single vehicle lookup
//   POST /api/vehicles        - Bulk lookup (body: {plates: [...]})
//   POST /api/read-plate      - OCR from base64 image (Claude Vision)
//
// Deploy options:
//   1. Local: node server.js (port 3000)
//   2. Railway: git push to Railway-connected GitHub repo
//   3. Vercel: vercel deploy (with vercel.json config)
//   4. Render: connect GitHub, auto-deploy
//
// Environment Variables (set in deployment platform):
//   FINDR_URL          - Findr API endpoint
//   FINDR_TOKEN        - Auth token for Findr
//   FINDR_CONSENT      - Consent text (default: 'Y')
//   ANTHROPIC_KEY      - For Claude Vision OCR
//   PORT               - Default 3000
//   ALLOWED_ORIGINS    - CORS comma-separated origins
//
// Install:
//   npm install express cors axios
//   node server.js
//
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── CONFIG ───
const FINDR_URL = process.env.FINDR_URL || 'https://bifrost.unifers.ai/api/v1/aggregator/vehicle-rc';
const FINDR_TOKEN = process.env.FINDR_TOKEN || 'YOUR_FINDR_TOKEN_HERE';
const FINDR_CONSENT = process.env.FINDR_CONSENT || 'Y';
const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY || '';

// CORS - allow GPS app domains
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 
  'https://prajapati-gps-field-repo.vercel.app,https://prajapati-advertising-zdgw.vercel.app,http://localhost:3000,http://localhost:5500').split(',');

app.use(cors({
  origin: function(origin, callback) {
    // Allow no origin (mobile apps, curl) and whitelisted origins
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
      return callback(null, true);
    }
    // Also allow localhost variants for dev
    if (origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)/)) {
      return callback(null, true);
    }
    callback(null, true); // Permissive for testing - tighten in production
  },
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));

// ─── IN-MEMORY CACHE ───
const cache = new Map();
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

function cacheKey(plate) { return String(plate).toUpperCase().replace(/\s+/g, ''); }

function cacheGet(plate) {
  const key = cacheKey(plate);
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(plate, data) {
  cache.set(cacheKey(plate), { data, ts: Date.now() });
}

// ─── HELPERS ───
function clean(plate) {
  return String(plate || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
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

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

// ─── ROOT ───
app.get('/', (req, res) => {
  res.json({
    server: 'Prajapati Findr Server v2 — PRODUCTION',
    status: 'running',
    cached: cache.size,
    endpoints: {
      single: 'GET /api/vehicle/:plate',
      bulk: 'POST /api/vehicles {plates: [...]}',
      readPlate: 'POST /api/read-plate {image: base64}',
      health: 'GET /health'
    },
    cors_enabled: true
  });
});

// ─── HEALTH ───
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'Prajapati Findr Server v2',
    cached: cache.size,
    uptime: Math.round(process.uptime()) + 's',
    findr_configured: !!FINDR_TOKEN && FINDR_TOKEN !== 'YOUR_FINDR_TOKEN_HERE',
    ocr_configured: !!ANTHROPIC_KEY,
    timestamp: new Date().toISOString()
  });
});

// ─── SINGLE LOOKUP ───
app.get('/api/vehicle/:plate', async (req, res) => {
  const plate = clean(req.params.plate);
  
  if (!plate || plate.length < 4) {
    return res.status(400).json({ success: false, error: 'Invalid plate' });
  }
  
  // Check cache
  const cached = cacheGet(plate);
  if (cached) {
    return res.json({ success: true, source: 'cache', data: cached });
  }
  
  // Call Findr
  try {
    const r = await axios.post(FINDR_URL, {
      Vehicle_Number: plate,
      Concent_Text: 'I authorize the use of this data for verification purposes.',
      Concent: FINDR_CONSENT
    }, {
      headers: {
        'Authorization': FINDR_TOKEN,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });
    
    const result = r.data?.data?.result || {};
    const owner = result.owner_details || {};
    const vehicle = result.vehicle_details || {};
    const office = result.office_details || {};
    
    const rawName = owner.name || null;
    const data = {
      plate,
      ownerName: !isMasked(rawName) ? formatName(rawName) : rawName,
      mobile: owner.mobile || null,
      maker: vehicle.maker || vehicle.make || null,
      model: vehicle.model || null,
      regDate: vehicle.registration_date || null,
      fuelType: vehicle.fuel_type || null,
      rto: office.rto || null,
      isMasked: isMasked(rawName),
      creditsUsed: r.data?.data?.creditUsed || 0
    };
    
    cacheSet(plate, data);
    console.log(`[FINDR] ${plate} → ${data.ownerName || 'Unknown'} | ${data.mobile || '—'}`);
    
    return res.json({ success: true, source: 'findr', data });
    
  } catch (err) {
    console.log(`[ERROR] ${plate} → ${err.response?.status || ''} ${err.message}`);
    return res.json({
      success: false,
      error: err.message,
      status: err.response?.status,
      plate
    });
  }
});

// ─── BULK LOOKUP ───
app.post('/api/vehicles', async (req, res) => {
  const { plates } = req.body;
  
  if (!Array.isArray(plates) || plates.length === 0) {
    return res.status(400).json({ error: 'plates[] required' });
  }
  
  if (plates.length > 100) {
    return res.status(400).json({ error: 'Max 100 plates per request' });
  }
  
  const results = {};
  let cacheHits = 0;
  let apiCalls = 0;
  let failed = 0;
  
  for (const p of plates) {
    const plate = clean(p);
    if (!plate || plate.length < 4) {
      results[p] = { success: false, error: 'Invalid plate' };
      continue;
    }
    
    // Cache first
    const cached = cacheGet(plate);
    if (cached) {
      results[plate] = { success: true, source: 'cache', data: cached };
      cacheHits++;
      continue;
    }
    
    // Findr call
    try {
      const r = await axios.post(FINDR_URL, {
        Vehicle_Number: plate,
        Concent_Text: 'I authorize the use of this data for verification purposes.',
        Concent: FINDR_CONSENT
      }, {
        headers: {
          'Authorization': FINDR_TOKEN,
          'Content-Type': 'application/json'
        },
        timeout: 12000
      });
      
      const result = r.data?.data?.result || {};
      const owner = result.owner_details || {};
      const vehicle = result.vehicle_details || {};
      const office = result.office_details || {};
      
      const rawName = owner.name || null;
      const data = {
        plate,
        ownerName: !isMasked(rawName) ? formatName(rawName) : rawName,
        mobile: owner.mobile || null,
        maker: vehicle.maker || vehicle.make || null,
        regDate: vehicle.registration_date || null,
        rto: office.rto || null,
        isMasked: isMasked(rawName)
      };
      
      cacheSet(plate, data);
      results[plate] = { success: true, source: 'findr', data };
      apiCalls++;
      
    } catch (err) {
      results[plate] = {
        success: false,
        error: err.message,
        status: err.response?.status
      };
      failed++;
    }
    
    // Rate limiting - 300ms between calls
    await new Promise(r => setTimeout(r, 300));
  }
  
  const found = Object.values(results).filter(r => r.success).length;
  console.log(`[BULK] ${found}/${plates.length} | Cache: ${cacheHits}, API: ${apiCalls}, Failed: ${failed}`);
  
  res.json({
    results,
    found,
    total: plates.length,
    stats: { cacheHits, apiCalls, failed }
  });
});

// ─── OCR (Plate from image) ───
app.post('/api/read-plate', async (req, res) => {
  if (!ANTHROPIC_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_KEY not configured' });
  }
  
  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'image (base64) required' });
  }
  
  try {
    const cleanBase64 = image.replace(/^data:image\/[^;]+;base64,/, '');
    
    const r = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [{
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: cleanBase64
          }
        }, {
          type: 'text',
          text: 'Read ONLY the number plate from this auto rickshaw / vehicle image. Respond with JUST the plate text (no spaces, no special characters). If no plate visible or unclear, respond with "UNREADABLE".'
        }]
      }]
    }, {
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      timeout: 30000
    });
    
    const text = r.data?.content?.[0]?.text || '';
    const plate = text.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    if (plate === 'UNREADABLE' || plate.length < 4) {
      return res.json({ success: false, plate: null, raw: text });
    }
    
    return res.json({ success: true, plate, raw: text });
    
  } catch (err) {
    console.error('[OCR]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─── START ───
app.listen(PORT, () => {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║  Prajapati Findr Server v2 — PRODUCTION READY ✅  ║');
  console.log(`║  Port: ${PORT}                                       ║`);
  console.log('╚════════════════════════════════════════════════════╝\n');
  console.log('Endpoints:');
  console.log(`  Single  : GET  http://localhost:${PORT}/api/vehicle/MH4T0554`);
  console.log(`  Bulk    : POST http://localhost:${PORT}/api/vehicles`);
  console.log(`  OCR     : POST http://localhost:${PORT}/api/read-plate`);
  console.log(`  Health  : GET  http://localhost:${PORT}/health`);
  console.log('');
  console.log('Config:');
  console.log(`  Findr  : ${FINDR_TOKEN && FINDR_TOKEN !== 'YOUR_FINDR_TOKEN_HERE' ? '✅' : '❌ (set FINDR_TOKEN)'}`);
  console.log(`  OCR    : ${ANTHROPIC_KEY ? '✅' : '❌ (optional, set ANTHROPIC_KEY)'}`);
  console.log(`  CORS   : ${ALLOWED_ORIGINS.join(', ')}\n`);
});
