// ═══════════════════════════════════════════════════════════════════════════
// /api/health.js — Findr server connectivity check
// verifier.html ye endpoint hit karta hai pehle, taaki pata chale server up hai
// ═══════════════════════════════════════════════════════════════════════════

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  return res.status(200).json({ 
    ok: true, 
    service: 'prajapati-gps-findr-proxy',
    time: new Date().toISOString(),
    findr_configured: !!process.env.FINDR_TOKEN
  });
}
