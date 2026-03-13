/**
 * api/command.js — Vercel serverless route
 *
 * Proxies POST /command to your bot's HTTP server.
 * The BOT_SECRET is stored only in Vercel env vars — never exposed to the browser.
 *
 * Required Vercel environment variables:
 *   BOT_HOST   = 38.190.133.136
 *   BOT_PORT   = 8081
 *   BOT_SECRET = (same value as API_SECRET in your data.json secrets)
 */

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
  
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }
  
    const host   = process.env.BOT_HOST;
    const port   = process.env.BOT_PORT;
    const secret = process.env.BOT_SECRET;
  
    if (!host || !port || !secret) {
      console.error('[api/command] Missing env vars');
      return res.status(503).json({ error: 'Server not configured' });
    }
  
    const body = req.body;
    if (!body || !body.action) {
      return res.status(400).json({ error: "Missing 'action' in request body" });
    }
  
    try {
      const botRes = await fetch(`http://${host}:${port}/command`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Secret never reaches the browser — injected here on the server side
          'Authorization': `Bearer ${secret}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
  
      if (!botRes.ok) {
        const text = await botRes.text().catch(() => '');
        return res.status(502).json({ error: `Bot responded with ${botRes.status}`, detail: text });
      }
  
      const data = await botRes.json();
      return res.status(200).json(data);
    } catch (err) {
      const isTimeout = err.name === 'TimeoutError' || err.name === 'AbortError';
      console.error('[api/command] Fetch error:', err.message);
      return res.status(isTimeout ? 504 : 502).json({
        error: isTimeout ? 'Bot did not respond in time' : 'Could not reach bot',
      });
    }
  }