import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, chmod } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertHttpUrl, assertPublicResolution, extractFirstUrl } from '../utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 優先使用 node_modules 內建二進位，若無則用 /tmp（Vercel Lambda 可寫目錄）
const BIN_DIRS = [
  path.resolve(__dirname, '../../bin'),               // vercel-build 預先下載
  path.resolve(__dirname, '../../node_modules/youtube-dl-exec/bin'), // npm 套件
  '/tmp'                                               // Vercel 冷啟動備援
];
const BIN_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';

function findBinary() {
  for (const dir of BIN_DIRS) {
    const p = path.join(dir, BIN_NAME);
    if (existsSync(p)) return p;
  }
  return null;
}

async function downloadBinary() {
  const targetDir = process.env.VERCEL ? '/tmp' : BIN_DIRS[0];
  const targetPath = path.join(targetDir, BIN_NAME);
  await mkdir(targetDir, { recursive: true });
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${BIN_NAME}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`下載 yt-dlp 失敗：HTTP ${resp.status}`);
  await pipeline(resp.body, createWriteStream(targetPath));
  await chmod(targetPath, 0o755);
  return targetPath;
}

// 確保二進位可用，回傳完整路徑（或 bare name 讓 execFile 搜 PATH）
async function ensureBinary() {
  const found = findBinary();
  if (found) return found;
  // Vercel：下載到 /tmp
  if (process.env.VERCEL) return downloadBinary();
  // 本機讓 execFile 搜 PATH（pip install 的 yt-dlp）
  return BIN_NAME;
}

export const name = 'youtube';

export const hosts = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'music.youtube.com'
]);

export const mediaHosts = new Set([
  'googlevideo.com',
  'ytimg.com',
  'youtube.com'
]);

export function isMediaHost(hostname) {
  const lower = hostname.toLowerCase();
  return lower.endsWith('.googlevideo.com') ||
         lower.endsWith('.ytimg.com') ||
         lower === 'ytimg.com';
}

export function detect(input) {
  try {
    const parsed = new URL(input);
    return hosts.has(parsed.hostname.toLowerCase()) ||
           parsed.hostname.toLowerCase().endsWith('.youtube.com');
  } catch { return false; }
}

export function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') return parsed.pathname.slice(1).split('/')[0] || null;
    // Handle /shorts/VIDEO_ID pattern
    const shortsMatch = parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) return shortsMatch[1];
    const v = parsed.searchParams.get('v');
    return v || null;
  } catch { return null; }
}

async function readTextWithLimit(response, maxBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let output = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel('response too large');
      throw new Error('頁面內容過大，已停止解析');
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

export function parseWatchPage(html, finalUrl) {
  const videoId = extractVideoId(finalUrl);

  const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*<\/script>/s);
  let playerData = null;
  if (playerMatch) {
    try { playerData = JSON.parse(playerMatch[1]); } catch {}
  }

  const title = html.match(/<meta\s+name="title"\s+content="([^"]+)"/i)?.[1] ||
                html.match(/<title>([^<]+)<\/title>/)?.[1]?.replace(' - YouTube', '') || null;
  const author = html.match(/<link\s+itemprop="name"\s+content="([^"]+)"/i)?.[1] || null;
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1] || null;

  let videoUrl = null;
  let cover = null;
  if (playerData) {
    const formats = playerData?.streamingData?.formats || [];
    const adaptive = playerData?.streamingData?.adaptiveFormats || [];
    const allFormats = [...formats, ...adaptive]
      .filter((f) => f?.url)
      .sort((a, b) => (b.width || 0) - (a.width || 0));
    videoUrl = allFormats[0]?.url || null;
    cover = playerData?.videoDetails?.thumbnail?.thumbnails?.slice(-1)[0]?.url ||
            `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` || null;
  } else {
    cover = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  }

  if (!videoId && !videoUrl) {
    const error = new Error('YouTube 頁面中沒有找到可下載媒體');
    error.code = 'MEDIA_NOT_FOUND';
    throw error;
  }

  return {
    sourceUrl: finalUrl, noteId: videoId, title, description, author, cover,
    type: videoId ? 'video' : null,
    videoUrl, alternatives: [],
    images: [],
    parser: playerData ? 'initial-state' : 'page-media-scan',
    platform: 'youtube'
  };
}

async function expandAndFetchPage(rawUrl, options) {
  const input = assertHttpUrl(rawUrl);
  await assertPublicResolution(input.hostname);

  const response = await fetch(input, {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,*/*',
      'accept-language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(options.timeoutMs)
  });
  if (!response.ok) throw new Error(`YouTube 頁面回應錯誤：HTTP ${response.status}`);
  const html = await readTextWithLimit(response, options.maxHtmlBytes);
  return { html, finalUrl: response.url };
}

export async function resolveShare(inputText, options) {
  const extracted = extractFirstUrl(inputText);
  if (!extracted) throw new Error('找不到可解析的網址');
  const input = assertHttpUrl(extracted);
  const videoId = extractVideoId(input.toString());
  if (!videoId) throw new Error('找不到 YouTube 影片 ID');

  // Step 1: 先從頁面 HTML 提取
  let result;
  try {
    const { html, finalUrl } = await expandAndFetchPage(input.toString(), options);
    result = parseWatchPage(html, finalUrl);
  } catch (pageErr) {
    console.error('[youtube] 頁面解析失敗:', pageErr?.message);
    result = {
      sourceUrl: input.toString(), noteId: videoId,
      title: null, description: null, author: null, cover: null,
      type: 'video', videoUrl: null, alternatives: [], images: [],
      parser: 'page-media-scan', platform: 'youtube'
    };
  }

  // Step 2: 若頁面解析沒拿到影片網址，用 yt-dlp 提取
  if (!result.videoUrl) {
    let binPath;
    try {
      binPath = await ensureBinary();
      const info = await new Promise((resolve, reject) => {
        execFile(binPath, [
          input.toString(),
          '-j', '--no-playlist',
          '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
        ], {
          timeout: 30_000,
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true
        }, (err, stdout) => {
          if (err) { reject(new Error(`yt-dlp 失敗：${err.message}`)); return; }
          try { resolve(JSON.parse(stdout)); }
          catch { reject(new Error('yt-dlp 輸出無效')); }
        });
      });

      const allFormats = info.formats || [];
      const best = allFormats
        .filter((f) => f.url || f.manifest_url || f.fragment_base_url)
        .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
      result.videoUrl = best?.url || best?.manifest_url || best?.fragment_base_url || result.videoUrl;
      result.title = result.title || info.title || null;
      result.description = result.description || (info.description || '').slice(0, 5000) || null;
      result.author = result.author || info.uploader || null;
      result.cover = result.cover || info.thumbnail || null;
    } catch (ytErr) {
      console.error('[youtube] yt-dlp 提取失敗:', ytErr?.message);
      console.error('[youtube] VERCEL:', process.env.VERCEL);
      console.error('[youtube] cwd:', process.cwd());
      for (const d of BIN_DIRS) {
        const p = path.join(d, BIN_NAME);
        console.error('[youtube] 路徑:', p, '存在=', existsSync(p));
      }
    }
  }

  return result;
}
