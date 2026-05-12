// /api/debug.js
// Debug endpoint - shows raw Findr API response
// Usage: /api/debug?plate=MH14GC3763

const https = require('https');

function cleanPlate(p) {
  return String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  let plate = req.query.plate || '';
  if (!plate && req.url) {
    const match = req.url.match(/\/api\/debug\/([^?\/]+)/);
    if (match) plate = match[1];
  }
  plate = cleanPlate(plate);
  
  if (!plate || plate.length < 4) {
    return res.status(400).json({
      error: 'Use: /api/debug?plate=MH14GC3763'
    });
  }
  
  const FINDR_URL = process.env.FINDR_URL || 'https://bifrost.unifers.ai/enrich/get-vehicle-details-v4';
  const FINDR_TOKEN = process.env.FINDR_TOKEN || '';
  
  if (!FINDR_TOKEN) {
    return res.status(500).json({
      error: 'FINDR_TOKEN not configured',
      hint: 'Add FINDR_TOKEN env var in Vercel'
    });
  }
  
  const body = JSON.stringify({
    Vehicle_Number: plate,
    Concent_Text: 'I authorize the use of this data for verification purposes.',
    Concent: 'Y'
  });
  
  const url = new URL(FINDR_URL);
  
  const result = await new Promise((resolve) => {
    const req2 = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': FINDR_TOKEN,
        'Content-Length': body.length
      },
      timeout: 15000
    }, (response) => {
      let data = '';
      response.on('data', (chunk) => data += chunk);
      response.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch (e) { parsed = data; }
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: parsed
        });
      });
    });
    
    req2.on('error', (e) => resolve({ error: e.message }));
    req2.on('timeout', () => {
      req2.destroy();
      resolve({ error: 'Request timeout' });
    });
    req2.write(body);
    req2.end();
  });
  
  res.json({
    debug: 'Findr API Direct Test',
    plate: plate,
    requestSentTo: FINDR_URL,
    tokenPrefix: FINDR_TOKEN.substring(0, 30) + '...',
    tokenLength: FINDR_TOKEN.length,
    response: result,
    parseAttempts: result.body ? {
      'r.data.result.owner_details.name': result.body?.data?.result?.owner_details?.name,
      'r.result.owner_details.name': result.body?.result?.owner_details?.name,
      'r.owner_details.name': result.body?.owner_details?.name,
      'r.data.owner_details.name': result.body?.data?.owner_details?.name
    } : 'no body to parse'
  });
};
