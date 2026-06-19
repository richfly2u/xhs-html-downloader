import { probeMedia, resolvePublicShare } from '../src/resolver.js';
import { formatBytes, parseRequestBody, safeFilename } from '../src/utils.js';

const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const maxHtmlBytes = Number(process.env.MAX_HTML_BYTES || 4 * 1024 * 1024);

function setCommonHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
  setCommonHeaders(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ success: false, error: '只接受 POST 請求' });
  }

  try {
    const body = parseRequestBody(req);
    const input = body.url || body.text;

    if (typeof input !== 'string' || input.trim().length === 0) {
      return res.status(400).json({ success: false, error: '請提供小紅書分享文字或連結' });
    }
    if (input.length > 4096) {
      return res.status(400).json({ success: false, error: '輸入內容過長' });
    }

    const data = await resolvePublicShare(input, {
      timeoutMs: requestTimeoutMs,
      maxHtmlBytes
    });

    let probe = { bytes: null, contentType: null };
    if (data.videoUrl) {
      try {
        probe = await probeMedia(data.videoUrl, Math.min(requestTimeoutMs, 10000));
      } catch {
        // 媒體大小探測失敗不影響解析結果。
      }
    }

    const baseName = safeFilename(data.title || data.noteId || 'xiaohongshu');
    const video = data.videoUrl
      ? {
          kind: 'video',
          directUrl: data.videoUrl,
          previewUrl: data.videoUrl,
          downloadUrl: data.videoUrl,
          filename: `${baseName}.mp4`,
          bytes: probe.bytes,
          size: formatBytes(probe.bytes),
          contentType: probe.contentType || 'video/mp4'
        }
      : data.type === 'video' && data.platform !== 'youtube'
        ? {
            kind: 'video',
            directUrl: data.sourceUrl,
            previewUrl: data.sourceUrl,
            downloadUrl: data.sourceUrl,
            filename: `${baseName}.mp4`,
            bytes: null,
            size: null,
            contentType: null
          }
        : null;

    const images = data.images.map((url, index) => ({
      kind: 'image',
      index: index + 1,
      directUrl: url,
      previewUrl: url,
      downloadUrl: url,
      filename: `${baseName}-${index + 1}.jpg`
    }));

    return res.status(200).json({
      success: true,
      data: {
        ...data,
        video,
        images,
        format: video ? 'MP4' : images.length ? '圖片' : null,
        bytes: probe.bytes,
        size: formatBytes(probe.bytes),
        contentType: probe.contentType,
        parsedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('parse failed:', error);
    const message = error instanceof Error ? error.message : '解析失敗';
    const status = error?.code === 'MEDIA_NOT_FOUND' ? 422 : 400;
    return res.status(status).json({ success: false, error: message });
  }
}
