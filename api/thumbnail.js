import { fetchThumbnail } from '../src/thumbnail.js';

function getQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800');

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ success: false, error: '只接受 GET 請求' });
  }

  try {
    const rawUrl = String(getQueryValue(req.query?.url) || '');
    if (!rawUrl) return res.status(400).json({ success: false, error: '缺少縮圖網址' });

    const thumbnail = await fetchThumbnail(rawUrl, {
      timeoutMs: Number(process.env.THUMBNAIL_TIMEOUT_MS || 15000),
      maxBytes: Number(process.env.MAX_THUMBNAIL_BYTES || Math.floor(3.5 * 1024 * 1024))
    });

    res.setHeader('Content-Type', thumbnail.contentType);
    res.setHeader('Content-Length', String(thumbnail.buffer.length));
    if (thumbnail.etag) res.setHeader('ETag', thumbnail.etag);
    if (thumbnail.lastModified) res.setHeader('Last-Modified', thumbnail.lastModified);
    return res.status(200).send(thumbnail.buffer);
  } catch (error) {
    const message = error?.name === 'TimeoutError'
      ? '縮圖載入逾時'
      : (error?.message || '縮圖載入失敗');
    const status = error?.code === 'THUMBNAIL_TOO_LARGE' ? 413 : 400;
    res.setHeader('Cache-Control', 'no-store');
    return res.status(status).json({ success: false, error: message });
  }
}
