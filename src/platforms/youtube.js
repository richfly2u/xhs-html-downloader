import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ytdl from '@distube/ytdl-core';
import { Innertube } from 'youtubei.js';
import { assertHttpUrl, assertPublicResolution, extractFirstUrl } from '../utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 依優先順序找 yt-dlp 二進位
function findYtDlp() {
  const paths = [
    path.resolve(__dirname, '../../node_modules/.bin/yt-dlp' + (process.platform === 'win32' ? '.exe' : '')),
    path.resolve(__dirname, '../../node_modules/youtube-dl-exec/bin/yt-dlp' + (process.platform === 'win32' ? '.exe' : '')),
    'yt-dlp',  // PATH 中的系統安裝（nixpacks / pipx）
  ];
  for (const p of paths) {
    if (p === 'yt-dlp' || existsSync(p)) return p;
  }
  return null;
}
const YTDLP_BIN = findYtDlp();

// 代理輪換清單（null = 直接連線，優先使用）
const PROXY_LIST = [
  null,
  'socks5://178.62.78.86:1080',
  'socks5://51.75.147.219:16379',
  'socks5://168.119.170.99:1080',
  'socks5://141.94.106.94:1080',
];

/** 用 yt-dlp 提取 YouTube 資訊，自動嘗試多個代理 */
async function ytDlpWithFallback(url, options = {}) {
  const errors = [];
  for (const proxy of PROXY_LIST) {
    try {
      const args = [url, '-j', '--no-playlist',
        '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'];
      if (proxy) args.push('--proxy', proxy);
      return await new Promise((resolve, reject) => {
        execFile(YTDLP_BIN, args, {
          timeout: 30_000, maxBuffer: 50 * 1024 * 1024
        }, (err, stdout) => {
          if (err) { reject(new Error(proxy ? `代理(${proxy.slice(0,20)}...): ${err.message}` : err.message)); return; }
          try { resolve(JSON.parse(stdout)); } catch { reject(new Error('JSON parse error')); }
        });
      });
    } catch (e) {
      errors.push(e.message);
    }
  }
  throw new Error('yt-dlp 所有代理皆失敗: ' + errors.join('; '));
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
    const shortsMatch = parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) return shortsMatch[1];
    return parsed.searchParams.get('v') || null;
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

  // Check for sign-in / age-restriction (vd6s-inspired error classification)
  if (/sign_in|signin|Log in|accounts\.google/i.test(html.slice(0, 2000))) {
    const error = new Error('此影片需要登入或受年齡限制，無法存取');
    error.code = 'SIGN_IN_REQUIRED';
    throw error;
  }
  // Check for unavailable / removed
  if (/This video is|unavailable|removed|private/i.test(html.slice(0, 1000)) &&
      !/<title>/.test(html.slice(0, 200))) {
    const error = new Error('此影片已設為私人、已移除或無法存取');
    error.code = 'VIDEO_UNAVAILABLE';
    throw error;
  }

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
  /** @type {Array<{label:string,height:number,url:string,hasAudio:boolean,hasVideo:boolean}>} */
  let formatList = [];

  if (playerData) {
    const formats = playerData?.streamingData?.formats || [];
    const adaptive = playerData?.streamingData?.adaptiveFormats || [];
    const allFormats = [...formats, ...adaptive]
      .filter((f) => f?.url)
      .sort((a, b) => (b.width || 0) - (a.width || 0));
    videoUrl = allFormats[0]?.url || null;

    // Build quality list (vd6s-style format table)
    const seen = new Set();
    for (const f of allFormats) {
      const h = f.height || 0;
      const key = `${h}p`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = h >= 2160 ? `${Math.round(h / 1000)}K` :
                    h >= 1440 ? '1440p' :
                    h >= 1080 ? '1080p' :
                    h >= 720  ? '720p' :
                    h >= 480  ? '480p' :
                    h >= 360  ? '360p' : '240p';
      formatList.push({
        label,
        height: h,
        url: f.url,
        hasAudio: Boolean(f.audioChannels || f.audioBitrate),
        hasVideo: Boolean(f.width || f.height)
      });
    }

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
    formats: formatList,
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

let innertube = null;
async function getInnerTube() {
  if (!innertube) innertube = await Innertube.create({ client_type: 'ANDROID', lang: 'en' });
  return innertube;
}

function pickFormat(formats) {
  if (!formats?.length) return null;
  return formats.filter((f) => f.url && f.hasAudio && f.hasVideo)
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0]
    || formats.filter((f) => f.url && f.hasVideo)
      .sort((a, b) => (b.height || 0) - (a.height || 0))[0]
    || formats.find((f) => f.url);
}

function collectFormats(formats) {
  if (!formats?.length) return [];
  const seen = new Set(), result = [];
  for (const f of formats) {
    if (!f.url) continue;
    const h = f.height || 0;
    const key = `${h}p`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = h >= 2160 ? `${Math.round(h / 1000)}K` :
                  h >= 1440 ? '1440p' : h >= 1080 ? '1080p' :
                  h >= 720 ? '720p' : h >= 480 ? '480p' :
                  h >= 360 ? '360p' : '240p';
    result.push({ label, height: h, url: f.url, hasAudio: Boolean(f.hasAudio || f.audioChannels), hasVideo: Boolean(f.hasVideo || f.width) });
  }
  return result;
}

export async function resolveShare(inputText, options) {
  const extracted = extractFirstUrl(inputText);
  if (!extracted) throw new Error('找不到可解析的網址');
  const input = assertHttpUrl(extracted);
  const videoId = extractVideoId(input.toString());
  if (!videoId) throw new Error('找不到 YouTube 影片 ID');

  const fallbackResult = () => ({
    sourceUrl: input.toString(), noteId: videoId,
    title: null, description: null, author: null, cover: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    type: 'video', videoUrl: null, alternatives: [], formats: [], images: [],
    parser: 'page-media-scan', platform: 'youtube'
  });

  let result = fallbackResult();

  // Step 1: InnerTube API (Android 端點，使用不同網域不容易被 IP 阻擋)
  try {
    const yt = await getInnerTube();
    const info = await yt.getInfo(videoId);
    const fmts = [...(info.streaming_data?.formats || []), ...(info.streaming_data?.adaptive_formats || [])];
    const best = pickFormat(fmts);
    result.videoUrl = best?.url || null;
    result.formats = collectFormats(fmts);
    result.title = info.basic_info?.title || result.title;
    result.author = info.basic_info?.author || result.author;
    result.description = (info.basic_info?.description || '').slice(0, 5000) || result.description;
    result.cover = info.basic_info?.thumbnail?.[0]?.url || result.cover;
    result.parser = 'innertube-api';
    if (result.videoUrl) return result;
  } catch (itErr) {
    console.error('[youtube] InnerTube 失敗:', itErr?.message?.slice(0, 100));
  }

  // Step 2: 從頁面 HTML 提取
  try {
    const { html, finalUrl } = await expandAndFetchPage(input.toString(), options);
    if (/live|直播/i.test(html.slice(0, 3000)) && /is live now|is streaming|直播中|正在直播/i.test(html.slice(0, 3000))) {
      const error = new Error('直播中或剛結束的直播需等待幾天才可下載');
      error.code = 'LIVE_STREAM';
      throw error;
    }
    result = { ...result, ...parseWatchPage(html, finalUrl) };
  } catch (pageErr) {
    console.error('[youtube] 頁面解析失敗:', pageErr?.message);
  }

  // Step 3: yt-dlp 二進位（含代理輪換）
  if (!result.videoUrl && existsSync(YTDLP_BIN)) {
      try {
        const info = await ytDlpWithFallback(input.toString());
        const allFormats = info.formats || [];
        const best = allFormats.filter((f) => f.url)
          .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
        if (best?.url) {
          result.videoUrl = best.url;
          result.title = result.title || info.title || null;
          result.description = result.description || (info.description || '').slice(0, 5000) || null;
          result.author = result.author || info.uploader || null;
          result.cover = result.cover || info.thumbnail || null;
        }
        // Collect formats from yt-dlp
        if (info.formats?.length) {
          const seen = new Set();
          for (const f of info.formats) {
            if (!f.url) continue;
            const h = f.height || 0;
            const key = `${h}p`;
            if (seen.has(key)) continue;
            seen.add(key);
            const label = h >= 2160 ? `${Math.round(h / 1000)}K` :
                          h >= 1440 ? '1440p' :
                          h >= 1080 ? '1080p' :
                          h >= 720  ? '720p' :
                          h >= 480  ? '480p' :
                          h >= 360  ? '360p' : '240p';
            result.formats = result.formats || [];
            if (!result.formats.some((e) => e.label === label)) {
              result.formats.push({ label, height: h, url: f.url, hasAudio: Boolean(f.acodec && f.acodec !== 'none'), hasVideo: Boolean(f.vcodec && f.vcodec !== 'none') });
            }
          }
        }
      } catch (ytdlpErr) { console.error('[youtube] yt-dlp 失敗:', ytdlpErr?.message); }
    }

    // Step 4: @distube/ytdl-core（純 JS 備援）
    if (!result.videoUrl) {
      try {
        let info;
        for (const client of ['web', 'ios', 'android']) {
          try {
            info = await ytdl.getInfo(input.toString(), { clients: [client] });
            if (info?.formats?.some((f) => f.url)) break;
          } catch { continue; }
        }
        if (info) {
          const allFormats = info.formats || [];
          const best = allFormats.filter((f) => f.url && f.hasAudio && f.hasVideo)
            .sort((a, b) => (b.height || 0) - (a.height || 0))[0]
            || allFormats.filter((f) => f.url && f.hasVideo)
              .sort((a, b) => (b.height || 0) - (a.height || 0))[0]
            || allFormats.filter((f) => f.url && f.hasAudio)
              .sort((a, b) => (a.bitrate || 0) - (a.bitrate || 0))[0]
            || allFormats.find((f) => f.url);

          result.videoUrl = best?.url || result.videoUrl;
          result.title = result.title || info.videoDetails?.title || null;
          result.description = result.description || info.videoDetails?.description?.slice(0, 5000) || null;
          result.author = result.author || info.videoDetails?.author?.name || null;
          result.cover = result.cover || info.videoDetails?.thumbnails?.slice(-1)[0]?.url || null;
        }
        // Collect formats from ytdl-core
        if (info.formats?.length) {
          const seen = new Set();
          for (const f of info.formats) {
            if (!f.url) continue;
            const h = f.height || 0;
            const key = `${h}p`;
            if (seen.has(key)) continue;
            seen.add(key);
            const label = h >= 2160 ? `${Math.round(h / 1000)}K` :
                          h >= 1440 ? '1440p' :
                          h >= 1080 ? '1080p' :
                          h >= 720  ? '720p' :
                          h >= 480  ? '480p' :
                          h >= 360  ? '360p' : '240p';
            result.formats = result.formats || [];
            if (!result.formats.some((e) => e.label === label)) {
              result.formats.push({ label, height: h, url: f.url, hasAudio: Boolean(f.hasAudio), hasVideo: Boolean(f.hasVideo) });
            }
          }
        }
      } catch { /* ytdl-core 也失敗 */ }
    }

  return result;
}
