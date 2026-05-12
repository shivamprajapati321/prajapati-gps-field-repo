// /api/health.js
// Health check endpoint for Findr server

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  
  res.json({
    status: 'ok',
    server: 'Prajapati GPS - Findr API (Vercel Serverless)',
    findr_configured: !!process.env.FINDR_TOKEN,
    findr_url: process.env.FINDR_URL || 'default',
    timestamp: new Date().toISOString(),
    endpoints: {
      single: '/api/vehicle?plate=MH14GC3763',
      bulk: 'POST /api/vehicles {plates: [...]}',
      debug: '/api/debug?plate=MH14GC3763',
      health: '/api/health'
    }
  });
};
