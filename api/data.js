/**
 * api/data.js — Vercel serverless route
 */

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization');
  
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  
    // Auth check — rejects anyone without the dashboard token
    const token = process.env.DASHBOARD_TOKEN;
    const auth = req.headers['authorization'];
    if (!token || auth !== `Bearer ${token}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  
    const host = process.env.BOT_HOST;
    const port = process.env.BOT_PORT;
  
    if (!host || !port) {
      console.error('[api/data] BOT_HOST or BOT_PORT env var missing');
      return res.status(503).json({ error: 'Server not configured' });
    }
  
    try {
      const botRes = await fetch(`http://${host}:${port}/data`, {
        signal: AbortSignal.timeout(8000),
      });
  
      if (!botRes.ok) {
        return res.status(502).json({ error: `Bot responded with ${botRes.status}` });
      }
  
      const data = await botRes.json();
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json(data);
    } catch (err) {
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
      console.error('[api/data] Fetch error:', err.message);
      return res.status(isTimeout ? 504 : 502).json({
        error: isTimeout ? 'Bot did not respond in time' : 'Could not reach bot',
      });
    }
  }