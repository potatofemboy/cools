/**
 * api/data.js — Vercel serverless route
 *
 * Proxies GET /data from your bot's HTTP server.
 * The browser never touches the bot's raw IP — Vercel handles it server-side.
 *
 * Required Vercel environment variables (set in Project → Settings → Environment Variables):
 *   BOT_HOST   = 38.190.133.136   (your LemonHost server IP)
 *   BOT_PORT   = 8081             (the allocated port you set as API_PORT)
 */

export default async function handler(req, res) {
    // CORS — allow your Vercel frontend (and local dev)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
  
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    const host = process.env.BOT_HOST;
    const port = process.env.BOT_PORT;
  
    if (!host || !port) {
      console.error('[api/data] BOT_HOST or BOT_PORT env var missing');
      return res.status(503).json({ error: 'Server not configured' });
    }
  
    try {
      const botRes = await fetch(`http://${host}:${port}/data`, {
        // Short timeout — bot should respond instantly
        signal: AbortSignal.timeout(8000),
      });
  
      if (!botRes.ok) {
        return res.status(502).json({ error: `Bot responded with ${botRes.status}` });
      }
  
      const data = await botRes.json();
  
      // Cache for 10 seconds on Vercel edge — keeps things snappy without hammering the bot
      res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=30');
      return res.status(200).json(data);
    } catch (err) {
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
      console.error('[api/data] Fetch error:', err.message);
      return res.status(isTimeout ? 504 : 502).json({
        error: isTimeout ? 'Bot did not respond in time' : 'Could not reach bot',
      });
    }
  }