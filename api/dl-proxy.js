/**
 * YouTube 媒體下載代理 - POST 版
 * 解決 GET query string 編碼問題
 * POST /api/dl-proxy
 * Body: { url: "https://..." }
 */
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
    new URL(targetUrl); // validate

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `遠端伺服器錯誤 (${response.status})` });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const filename = contentType?.startsWith('video/') ? 'youtube.mp4' : 'download';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    for await (const chunk of response.body) {
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    if (err.message?.includes('Invalid URL')) {
      return res.status(400).json({ error: '無效的 URL 格式' });
    }
    console.error('[DL PROXY ERROR]', err.message);
    res.status(502).json({ error: '下載失敗：' + err.message });
  }
}
