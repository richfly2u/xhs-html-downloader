/**
 * YouTube 媒體下載代理 - 透過 VPS 下載（同 IP，CDN 不擋）
 * POST /api/dl-proxy
 * Body: { url: "https://..." }
 */
const VPS_DL = 'http://108.61.163.87:8799/api/dl';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: '只接受 POST' });
  }

  try {
    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body?.toString() || '{}');
    const targetUrl = (body.url || '').trim();
    if (!targetUrl) {
      return res.status(400).json({ error: '缺少 url 參數' });
    }

    // Proxy through VPS (same IP as YouTube CDN allows)
    const vpsResp = await fetch(VPS_DL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl, title: body.title || 'youtube', format: body.format || '' }),
      signal: AbortSignal.timeout(60000),
    });

    if (!vpsResp.ok) {
      const err = await vpsResp.text().catch(() => '');
      return res.status(vpsResp.status).json({ error: err || 'VPS 下載失敗' });
    }

    const contentType = vpsResp.headers.get('content-type') || 'video/mp4';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', 'attachment; filename="youtube.mp4"');
    res.setHeader('Cache-Control', 'public, max-age=86400');

    for await (const chunk of vpsResp.body) {
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    console.error('[DL PROXY ERROR]', err.message);
    if (err.name === 'TimeoutError' || err.message?.includes('timed out')) {
      return res.status(504).json({ error: '下載超時，請稍後再試' });
    }
    res.status(502).json({ error: '下載失敗：' + err.message });
  }
}
