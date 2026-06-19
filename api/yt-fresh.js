import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractVideoId } from '../src/platforms/youtube.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const YTDLP_BIN = process.platform === 'win32'
  ? path.resolve(__dirname, '../node_modules/youtube-dl-exec/bin/yt-dlp.exe')
  : path.resolve(__dirname, '../node_modules/youtube-dl-exec/bin/yt-dlp');

export const maxDuration = 30;

function setCommonHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
}

function getQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(req, res) {
  setCommonHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ success: false, error: '只接受 GET 請求' });
  }

  try {
    const rawUrl = String(getQueryValue(req.query?.url) || '');
    const quality = String(getQueryValue(req.query?.q) || 'best');
    if (!rawUrl) return res.status(400).json({ success: false, error: '缺少 YouTube 網址' });

    const videoId = extractVideoId(rawUrl);
    if (!videoId) return res.status(400).json({ success: false, error: '找不到 YouTube 影片 ID' });

    // 1. Try yt-dlp first
    if (existsSync(YTDLP_BIN)) {
      try {
        const formatArg = quality === 'best' ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
          : `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]/best`;
        const url = await new Promise((resolve, reject) => {
          execFile(YTDLP_BIN, [
            `https://www.youtube.com/watch?v=${videoId}`,
            '-g', '--no-playlist',
            '-f', formatArg
          ], { timeout: 25_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
            if (err) { reject(err); return; }
            resolve(stdout.trim().split('\n')[0]);
          });
        });
        if (url) {
          return res.json({ success: true, url, videoId, quality });
        }
      } catch { /* try next method */ }
    }

    // 2. Fallback: @distube/ytdl-core
    try {
      const { default: ytdl } = await import('@distube/ytdl-core');
      let info;
      for (const client of ['web', 'ios', 'android']) {
        try { info = await ytdl.getInfo(rawUrl, { clients: [client] }); if (info?.formats?.some(f => f.url)) break; }
        catch { continue; }
      }
      if (info) {
        const formats = info.formats.filter(f => f.url);
        const best = formats.filter(f => f.hasAudio && f.hasVideo)
          .sort((a, b) => (b.height || 0) - (a.height || 0))[0]
          || formats.filter(f => f.hasVideo).sort((a, b) => (b.height || 0) - (a.height || 0))[0]
          || formats[0];
        if (best?.url) return res.json({ success: true, url: best.url, videoId, quality });
      }
    } catch { /* failed */ }

    return res.status(404).json({ success: false, error: '無法取得即時下載連結，請稍後再試' });
  } catch (error) {
    const message = error instanceof Error ? error.message : '取得下載連結失敗';
    return res.status(500).json({ success: false, error: message });
  }
}
