/**
 * 小紅書媒體代理下載端點
 * 解決跨域 CDN 無法直接下載的問題
 * GET /api/download?url=https://...
 */
export default async function handler(req, res) {
  const { url } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: '缺少 url 參數' });
  }

  if (url.length > 2000) {
    return res.status(400).json({ error: 'URL 過長' });
  }

  try {
    const targetUrl = decodeURIComponent(url);
    new URL(targetUrl); // validate URL

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36',
        Referer: 'https://www.xiaohongshu.com/',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `遠端伺服器錯誤 (${response.status})` });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = response.headers.get('content-length');

    // Extract filename from URL or content-type
    let filename = 'download';
    if (contentType?.startsWith('video/')) filename = 'video.mp4';
    else if (contentType?.startsWith('image/')) {
      const ext = contentType.split('/').pop() || 'jpg';
      filename = `image.${ext}`;
    }
    if (targetUrl.match(/\/[^/]+\.[a-z0-9]+(?:\?|$)/i)) {
      const match = targetUrl.match(/\/([^/?]+)\.([a-z0-9]+)(?:\?|$)/i);
      if (match) filename = `xiaohongshu_${match[1].slice(0, 20)}.${match[2]}`;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    // Stream the response
    for await (const chunk of response.body) {
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    if (err.message?.includes('Invalid URL')) {
      return res.status(400).json({ error: '無效的 URL 格式' });
    }
    console.error('[DOWNLOAD PROXY ERROR]', err.message);
    res.status(502).json({ error: '代理下載失敗：' + err.message });
  }
}
