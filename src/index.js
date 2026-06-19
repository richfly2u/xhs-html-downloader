import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { probeMedia, resolvePublicShare } from './resolver.js';
import { analyzeCopy } from './analyzer.js';
import { fetchThumbnail } from './thumbnail.js';
import { extractVideoId } from './platforms/youtube.js';
import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  assertHttpUrl,
  assertPublicResolution,
  codesEqual,
  formatBytes,
  getProvidedCode,
  safeFilename,
  secureDigest
} from './utils.js';
import { isMediaHost } from './platforms/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const app = express();
const port = Number(process.env.PORT || 8787);
const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const mediaTimeoutMs = Number(process.env.MEDIA_TIMEOUT_MS || 120000);
const maxHtmlBytes = Number(process.env.MAX_HTML_BYTES || 4 * 1024 * 1024);
const maxMediaBytes = Number(process.env.MAX_MEDIA_BYTES || 300 * 1024 * 1024);
const mediaProxyDefault = process.env.VERCEL ? 'false' : 'true';
const mediaProxyEnabled = String(process.env.ENABLE_MEDIA_PROXY ?? mediaProxyDefault).toLowerCase() === 'true';

// yt-dlp 二進位路徑（供 /api/media 代理 YouTube 串流用）
const __ytdlpBin = path.resolve(__dirname, '../node_modules/.bin/yt-dlp' + (process.platform === 'win32' ? '.exe' : ''));
const YTDLP_BIN = existsSync(__ytdlpBin) ? __ytdlpBin : 'yt-dlp';

if (process.env.VERCEL || process.env.RAILWAY_ENVIRONMENT || String(process.env.TRUST_PROXY || 'false').toLowerCase() === 'true') {
  app.set('trust proxy', 1);
}

app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://*.xhscdn.com'],
      mediaSrc: ["'self'", 'blob:', 'https://*.xhscdn.com'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
app.use(express.json({ limit: '32kb' }));

const parseLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: '請求太頻繁，請稍後再試' }
});
const mediaLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, error: '下載請求太頻繁，請稍後再試' }
});

function aiAccessProtected() {
  return Boolean(String(process.env.AI_ACCESS_CODE || '').trim());
}

function mediaProxyUrl(req, directUrl, { download = false, filename = 'media' } = {}) {
  if (!mediaProxyEnabled || !directUrl) return null;
  const query = new URLSearchParams({ url: directUrl });
  if (download) query.set('download', '1');
  if (filename) query.set('name', filename);
  return `${req.protocol}://${req.get('host')}/api/media?${query.toString()}`;
}

app.get('/health', (_req, res) => {
  const aiProvider = process.env.GROQ_API_KEY ? 'groq' : (process.env.OPENAI_API_KEY ? 'openai' : null);
  res.json({ ok: true, service: 'xhs-html-downloader', version: '0.4.6', mediaProxyEnabled, aiConfigured: Boolean(aiProvider), aiProvider, aiAccessProtected: aiAccessProtected() });
});

app.post('/api/parse', parseLimiter, async (req, res) => {
  try {
    const input = req.body?.url || req.body?.text;
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
        probe = await probeMedia(data.videoUrl, Math.min(requestTimeoutMs, 10_000));
      } catch {
        // Size probing is optional.
      }
    }

    const baseName = safeFilename(data.title || data.noteId || 'xiaohongshu');
    const video = data.videoUrl ? {
      kind: 'video',
      directUrl: data.videoUrl,
      previewUrl: mediaProxyUrl(req, data.videoUrl) || data.videoUrl,
      downloadUrl: mediaProxyUrl(req, data.videoUrl, { download: true, filename: `${baseName}.mp4` }) || data.videoUrl,
      bytes: probe.bytes,
      size: formatBytes(probe.bytes),
      contentType: probe.contentType || 'video/mp4'
    } : (data.type === 'video' && data.platform !== 'youtube' ? {
      kind: 'video',
      directUrl: data.sourceUrl,
      previewUrl: data.sourceUrl,
      downloadUrl: data.sourceUrl,
      bytes: null,
      size: null,
      contentType: null
    } : (data.type === 'video' && data.platform === 'youtube' ? {
      kind: 'video',
      directUrl: data.videoUrl || data.sourceUrl,
      previewUrl: data.cover || data.sourceUrl,
      downloadUrl: data.videoUrl || data.sourceUrl,
      bytes: null,
      size: null,
      contentType: null
    } : null));

    const images = data.images.map((url, index) => ({
      kind: 'image',
      index: index + 1,
      directUrl: url,
      previewUrl: mediaProxyUrl(req, url) || url,
      downloadUrl: mediaProxyUrl(req, url, { download: true, filename: `${baseName}-${index + 1}.jpg` }) || url
    }));

    return res.json({
      success: true,
      data: {
        ...data,
        video,
        images,
        format: video ? 'MP4' : (images.length ? '圖片' : null),
        bytes: probe.bytes,
        size: formatBytes(probe.bytes),
        contentType: probe.contentType,
        parsedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '解析失敗';
    const status = error?.code === 'MEDIA_NOT_FOUND' ? 422 : 400;
    return res.status(status).json({ success: false, error: message });
  }
});


app.get('/api/thumbnail', mediaLimiter, async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '');
    if (!rawUrl) return res.status(400).json({ success: false, error: '缺少縮圖網址' });
    const thumbnail = await fetchThumbnail(rawUrl, {
      timeoutMs: Number(process.env.THUMBNAIL_TIMEOUT_MS || 15000),
      maxBytes: Number(process.env.MAX_THUMBNAIL_BYTES || Math.floor(3.5 * 1024 * 1024))
    });
    res.setHeader('Content-Type', thumbnail.contentType);
    res.setHeader('Content-Length', String(thumbnail.buffer.length));
    res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
    if (thumbnail.etag) res.setHeader('ETag', thumbnail.etag);
    if (thumbnail.lastModified) res.setHeader('Last-Modified', thumbnail.lastModified);
    return res.status(200).send(thumbnail.buffer);
  } catch (error) {
    const message = error?.name === 'TimeoutError' ? '縮圖載入逾時' : (error?.message || '縮圖載入失敗');
    const status = error?.code === 'THUMBNAIL_TOO_LARGE' ? 413 : 400;
    return res.status(status).json({ success: false, error: message });
  }
});

app.post('/api/analyze', parseLimiter, async (req, res) => {
  try {
    const requiredCode = String(process.env.AI_ACCESS_CODE || '').trim();
    if (requiredCode) {
      const providedCode = getProvidedCode(req);
      if (!providedCode) return res.status(401).json({ success: false, error: 'AI 分析功能需要密碼', code: 'AI_ACCESS_REQUIRED' });
      if (!codesEqual(requiredCode, providedCode)) return res.status(403).json({ success: false, error: 'AI 分析密碼不正確', code: 'AI_ACCESS_INVALID' });
    }
    const data = await analyzeCopy(req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : '文案分析失敗';
    const status = error?.code === 'NO_ANALYSIS_SOURCE' ? 422 : 400;
    return res.status(status).json({ success: false, error: message });
  }
});

app.get('/api/media', mediaLimiter, async (req, res) => {
  if (!mediaProxyEnabled) {
    return res.status(404).json({ success: false, error: '媒體代理目前未啟用' });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), mediaTimeoutMs);
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const rawUrl = String(req.query.url || '');
    const url = assertHttpUrl(rawUrl);
    if (!isMediaHost(url.hostname)) {
      return res.status(400).json({ success: false, error: '只允許代理 CDN 媒體' });
    }
    await assertPublicResolution(url.hostname);

    const requestedName = safeFilename(String(req.query.name || 'media'), 'media');
    const disposition = String(req.query.download || '') === '1' ? 'attachment' : 'inline';
    const extension = requestedName.includes('.') ? requestedName.split('.').pop() : 'mp4';

    // googlevideo.com 串流綁定 IP，用 yt-dlp 下載而非直接 fetch
    if (url.hostname.endsWith('.googlevideo.com')) {
      const finalName = requestedName.includes('.') ? requestedName : `${requestedName}.mp4`;
      res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(finalName)}`);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      try {
        const ytProc = spawn(YTDLP_BIN, [rawUrl, '-o', '-', '-f', 'best'], {
          windowsHide: true
        });
        res.on('close', () => { try { ytProc.kill(); } catch {} });
        const timeoutTimer = setTimeout(() => ytProc.kill(), mediaTimeoutMs);
        ytProc.on('close', () => clearTimeout(timeoutTimer));
        ytProc.stdout.pipe(res);
        await new Promise((resolve, reject) => {
          ytProc.on('error', reject);
          ytProc.on('close', (code) => {
            if (code === 0 || code === null) resolve();
            else reject(new Error(`yt-dlp 退出碼 ${code}`));
          });
        });
      } catch (ytErr) {
        if (!res.headersSent) res.status(502).json({ success: false, error: `下載失敗：${ytErr.message}` });
      }
      return;
    }

    // 一般 CDN 代理（XHS 等）
    const headers = {
      'user-agent': req.get('user-agent') || 'Mozilla/5.0',
      accept: 'video/mp4,image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
      referer: 'https://www.xiaohongshu.com/'
    };
    if (req.headers.range) headers.range = req.headers.range;

    const upstream = await fetch(url, {
      redirect: 'follow',
      headers,
      signal: controller.signal
    });
    if (!(upstream.ok || upstream.status === 206) || !upstream.body) {
      return res.status(502).json({ success: false, error: `上游媒體回應錯誤：HTTP ${upstream.status}` });
    }

    if (upstream.url) {
      try {
        const effectiveHost = new URL(upstream.url).hostname;
        if (!isMediaHost(effectiveHost)) {
          await upstream.body.cancel();
          return res.status(400).json({ success: false, error: '重新導向到非 CDN 位址，已拒絕' });
        }
      } catch {
        await upstream.body.cancel();
        return res.status(400).json({ success: false, error: '重新導向到無效網址' });
      }
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!/^video\/mp4(?:;|$)|^image\/(?:jpeg|png|webp|avif)(?:;|$)/i.test(contentType)) {
      await upstream.body.cancel();
      return res.status(415).json({ success: false, error: `不支援的媒體格式：${contentType || '未知'}` });
    }

    const length = Number(upstream.headers.get('content-length')) || null;
    if (length && length > maxMediaBytes) {
      await upstream.body.cancel();
      return res.status(413).json({ success: false, error: '媒體超過伺服器允許的大小上限' });
    }

    res.status(upstream.status);
    for (const header of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }

    const ext = contentType.startsWith('video/') ? 'mp4' :
      contentType.includes('png') ? 'png' :
      contentType.includes('webp') ? 'webp' :
      contentType.includes('avif') ? 'avif' : 'jpg';
    const fn = requestedName.includes('.') ? requestedName : `${requestedName}.${ext}`;
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(fn)}`);
    res.setHeader('Cache-Control', 'public, max-age=3600');

    let totalBytes = 0;
    const byteLimitTransform = new Transform({
      transform(chunk, encoding, callback) {
        totalBytes += chunk.length;
        if (totalBytes > maxMediaBytes) {
          callback(new Error('媒體超過大小上限'));
          return;
        }
        callback(null, chunk);
      }
    });
    await pipeline(Readable.fromWeb(upstream.body), byteLimitTransform, res);
  } catch (error) {
    if (!res.headersSent) {
      const message = error?.name === 'AbortError' ? '下載逾時' : (error?.message || '下載失敗');
      res.status(400).json({ success: false, error: message });
    } else {
      res.destroy(error);
    }
  } finally {
    clearTimeout(timer);
  }
});

// 即時 YouTube 下載連結（解決 CDN URL 時效問題）
const YTDLP_BIN2 = process.platform === 'win32'
  ? path.resolve(__dirname, '../node_modules/youtube-dl-exec/bin/yt-dlp.exe')
  : path.resolve(__dirname, '../node_modules/youtube-dl-exec/bin/yt-dlp');

app.get('/api/yt-fresh', async (req, res) => {
  try {
    const rawUrl = String(req.query.url || '');
    const quality = String(req.query.q || 'best');
    if (!rawUrl) return res.status(400).json({ success: false, error: '缺少 YouTube 網址' });
    const videoId = extractVideoId(rawUrl);
    if (!videoId) return res.status(400).json({ success: false, error: '找不到 YouTube 影片 ID' });

    // yt-dlp
    if (existsSync(YTDLP_BIN2)) {
      try {
        const formatArg = quality === 'best' ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
          : `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]/best`;
        const url = await new Promise((resolve, reject) => {
          execFile(YTDLP_BIN2, [`https://www.youtube.com/watch?v=${videoId}`, '-g', '--no-playlist', '-f', formatArg],
            { timeout: 25_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
              if (err) { reject(err); return; }
              resolve(stdout.trim().split('\n')[0]);
            });
        });
        if (url) return res.json({ success: true, url, videoId, quality });
      } catch { /* next */ }
    }

    // @distube/ytdl-core 備援
    try {
      const { default: ytdl } = await import('@distube/ytdl-core');
      let info;
      for (const client of ['web', 'ios', 'android']) {
        try { info = await ytdl.getInfo(rawUrl, { clients: [client] }); if (info?.formats?.some(f => f.url)) break; }
        catch { continue; }
      }
      if (info) {
        const fmts = info.formats.filter(f => f.url);
        const best = fmts.filter(f => f.hasAudio && f.hasVideo).sort((a, b) => (b.height || 0) - (a.height || 0))[0]
          || fmts.filter(f => f.hasVideo).sort((a, b) => (b.height || 0) - (a.height || 0))[0]
          || fmts[0];
        if (best?.url) return res.json({ success: true, url: best.url, videoId, quality });
      }
    } catch { /* failed */ }

    return res.status(404).json({ success: false, error: '無法取得即時下載連結' });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : '取得連結失敗' });
  }
});

app.use(express.static(publicDir, {
  index: 'index.html',
  extensions: ['html'],
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(publicDir, 'index.html'));
  }
  return next();
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ success: false, error: '伺服器內部錯誤' });
});

export default app;
