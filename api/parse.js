import { probeMedia, resolvePublicShare } from '../src/resolver.js';
import { formatBytes, safeFilename } from '../src/utils.js';

const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const maxHtmlBytes = Number(process.env.MAX_HTML_BYTES || 4 * 1024 * 1024);

function setCommonHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString('utf8'));
    } catch {
      return {};
    }
  }
  return {};
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
    const body = getBody(req);
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

    // If HTML parsing didn't find video, try yt-dlp as fallback
    if (!data.videoUrl && data.images.length <= 2) {
      try {
        const ytdlp = await import('../src/ytdlp.js');
        const ytResult = await ytdlp.tryExtract(input);
        if (ytResult?.videoUrl) {
          data.videoUrl = ytResult.videoUrl;
          data.type = 'video';
          data.video = {
            kind: 'video',
            directUrl: ytResult.videoUrl,
            previewUrl: ytResult.videoUrl,
            downloadUrl: ytResult.videoUrl,
            filename: `${safeFilename(data.title || data.noteId || 'xiaohongshu')}.mp4`
          };
          if (ytResult.title) data.title = ytResult.title;
        }
      } catch {
        // yt-dlp fallback failed, keep HTML parsing result
      }
    }

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
