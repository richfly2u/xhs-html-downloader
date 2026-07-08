import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ytdl from '@distube/ytdl-core';
import { Innertube } from 'youtubei.js';
import { assertHttpUrl, assertPublicResolution, extractFirstUrl, formatBytes } from '../utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function findYtDlp() {
  const paths = [
    path.resolve(__dirname, '../../node_modules/.bin/yt-dlp' + (process.platform === 'win32' ? '.exe' : '')),
    path.resolve(__dirname, '../../node_modules/youtube-dl-exec/bin/yt-dlp' + (process.platform === 'win32' ? '.exe' : '')),
    'yt-dlp'
  ];
  return paths.find((candidate) => candidate === 'yt-dlp' || existsSync(candidate)) || null;
}

const YTDLP_BIN = findYtDlp();
const YTDLP_AVAILABLE = Boolean(YTDLP_BIN);
const YTDLP_STRATEGIES = [
  [],
  ['--extractor-args', 'youtube:player_client=android'],
  ['--extractor-args', 'youtube:player_client=ios'],
  ['--extractor-args', 'youtube:player_client=web']
];

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

export function isMediaHost(hostname = '') {
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
  } catch {
    return false;
  }
}

export function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'youtu.be') return parsed.pathname.slice(1).split('/')[0] || null;
    const shortsMatch = parsed.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shortsMatch) return shortsMatch[1];
    const embedMatch = parsed.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embedMatch) return embedMatch[1];
    return parsed.searchParams.get('v') || null;
  } catch {
    return null;
  }
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
      throw new Error('YouTube page is too large to parse safely');
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractMeta(html, name) {
  const pattern = new RegExp(`<meta\\s+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i');
  return decodeHtml(html.match(pattern)?.[1] || '');
}

function hasAudioTrack(format = {}) {
  return Boolean(format.hasAudio ||
    format.audioChannels ||
    format.audioBitrate ||
    (format.acodec && format.acodec !== 'none'));
}

function hasVideoTrack(format = {}) {
  return Boolean(format.hasVideo ||
    format.width ||
    format.height ||
    (format.vcodec && format.vcodec !== 'none'));
}

function pickFormat(formats = []) {
  const usable = formats.filter((format) => format?.url);
  return usable.filter((format) => hasAudioTrack(format) && hasVideoTrack(format))
    .sort((a, b) => (b.height || 0) - (a.height || 0))[0] ||
    usable.filter(hasVideoTrack).sort((a, b) => (b.height || 0) - (a.height || 0))[0] ||
    usable.find(hasAudioTrack) ||
    usable[0] ||
    null;
}

function formatCodec(value) {
  if (!value || value === 'none') return null;
  return String(value).split('.')[0].toUpperCase();
}

function formatSize(value) {
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes > 0 ? formatBytes(bytes) : null;
}

function qualityLabel(height = 0, fallback = '') {
  const h = Number(height) || 0;
  if (!h && fallback) return String(fallback);
  if (h >= 2160) return `${Math.round(h / 1000)}K`;
  if (h >= 1440) return '1440p';
  if (h >= 1080) return '1080p';
  if (h >= 720) return '720p';
  if (h >= 480) return '480p';
  if (h >= 360) return '360p';
  if (h > 0) return `${h}p`;
  return 'audio';
}

function codecFromMime(mimeType = '') {
  return mimeType.match(/codecs="([^"]+)"/)?.[1] || null;
}

function normalizeFormat(format = {}) {
  const height = Number(format.height) || 0;
  const hasAudio = hasAudioTrack(format);
  const hasVideo = hasVideoTrack(format);
  return {
    label: qualityLabel(height, format.qualityLabel || format.quality),
    height,
    url: format.url,
    hasAudio,
    hasVideo,
    size: formatSize(format.contentLength || format.filesize || format.filesize_approx),
    codec: [
      formatCodec(format.vcodec || codecFromMime(format.mimeType)),
      formatCodec(format.acodec)
    ].filter(Boolean).join(' / ') || null,
    ext: format.container ||
      format.ext ||
      format.mimeType?.match(/video\/([^;]+)/)?.[1] ||
      format.mimeType?.match(/audio\/([^;]+)/)?.[1] ||
      null
  };
}

function collectFormats(formats = []) {
  const seen = new Set();
  const result = [];
  const sorted = formats.filter((format) => format?.url)
    .sort((a, b) => (b.height || 0) - (a.height || 0));

  for (const format of sorted) {
    const item = normalizeFormat(format);
    const key = item.hasVideo
      ? `${item.height}-${item.hasAudio ? 'av' : 'v'}`
      : `audio-${item.codec || item.ext || result.length}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

async function ytDlpWithFallback(url) {
  const errors = [];
  const common = [
    url,
    '-j',
    '--no-playlist',
    '--no-warnings',
    '-f',
    'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best'
  ];

  for (const extra of YTDLP_STRATEGIES) {
    try {
      return await new Promise((resolve, reject) => {
        execFile(YTDLP_BIN, [...common, ...extra], {
          timeout: 35_000,
          maxBuffer: 50 * 1024 * 1024
        }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error((stderr || error.message || '').trim().slice(0, 500)));
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error('yt-dlp returned invalid JSON'));
          }
        });
      });
    } catch (error) {
      errors.push(`${extra[1]?.split('=')[1] || 'default'}: ${error.message}`);
    }
  }

  throw new Error(errors.join('; '));
}

function applyYtDlpInfo(result, info = {}) {
  const formats = info.formats || [];
  const best = pickFormat(formats);
  const requested = info.requested_downloads?.find((item) => item.url) ||
    (Array.isArray(info.requested_formats) ? info.requested_formats.find((item) => item.url) : null);

  result.videoUrl = requested?.url || best?.url || info.url || result.videoUrl;
  result.formats = collectFormats(formats);
  result.title = result.title || info.title || null;
  result.description = result.description || (info.description || '').slice(0, 5000) || null;
  result.author = result.author || info.uploader || info.channel || null;
  result.cover = result.cover || info.thumbnail || null;
  result.parser = 'yt-dlp';
  return result;
}

function parsePlayerData(html) {
  const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*(?:<\/script>|var\s)/s);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export function parseWatchPage(html, finalUrl) {
  const videoId = extractVideoId(finalUrl);
  const playerData = parsePlayerData(html);
  const title = extractMeta(html, 'title') ||
    decodeHtml(html.match(/<title>([^<]+)<\/title>/i)?.[1] || '').replace(' - YouTube', '') ||
    null;
  const author = html.match(/<link\s+itemprop="name"\s+content="([^"]+)"/i)?.[1] || null;
  const description = extractMeta(html, 'description') || null;

  let videoUrl = null;
  let formats = [];
  if (playerData?.streamingData) {
    const pageFormats = [
      ...(playerData.streamingData.formats || []),
      ...(playerData.streamingData.adaptiveFormats || [])
    ];
    videoUrl = pickFormat(pageFormats)?.url || null;
    formats = collectFormats(pageFormats);
  }

  const cover = playerData?.videoDetails?.thumbnail?.thumbnails?.slice(-1)[0]?.url ||
    (videoId ? `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` : null);

  if (!videoId && !videoUrl) {
    const error = new Error('No downloadable YouTube media was found');
    error.code = 'MEDIA_NOT_FOUND';
    throw error;
  }

  return {
    sourceUrl: finalUrl,
    noteId: videoId,
    title,
    description,
    author,
    cover,
    type: videoId ? 'video' : null,
    videoUrl,
    alternatives: [],
    formats,
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
      'accept-language': 'en-US,en;q=0.9'
    },
    signal: AbortSignal.timeout(options.timeoutMs)
  });
  if (!response.ok) throw new Error(`YouTube page returned HTTP ${response.status}`);
  const html = await readTextWithLimit(response, options.maxHtmlBytes);
  return { html, finalUrl: response.url };
}

let innertube = null;
async function getInnerTube() {
  if (!innertube) innertube = await Innertube.create({ client_type: 'ANDROID', lang: 'en' });
  return innertube;
}

export async function resolveShare(inputText, options) {
  const extracted = extractFirstUrl(inputText);
  if (!extracted) throw new Error('Please provide a YouTube URL');
  const input = assertHttpUrl(extracted);
  const videoId = extractVideoId(input.toString());
  if (!videoId) throw new Error('Could not find a YouTube video ID');

  const result = {
    sourceUrl: input.toString(),
    noteId: videoId,
    title: null,
    description: null,
    author: null,
    cover: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    type: 'video',
    videoUrl: null,
    alternatives: [],
    formats: [],
    images: [],
    parser: 'page-media-scan',
    platform: 'youtube'
  };

  if (YTDLP_AVAILABLE) {
    try {
      const info = await ytDlpWithFallback(input.toString());
      applyYtDlpInfo(result, info);
      if (result.videoUrl) return result;
    } catch (error) {
      console.error('[youtube] yt-dlp failed:', error.message);
    }
  }

  try {
    const yt = await getInnerTube();
    const info = await yt.getInfo(videoId);
    const formats = [
      ...(info.streaming_data?.formats || []),
      ...(info.streaming_data?.adaptive_formats || [])
    ];
    const best = pickFormat(formats);
    result.videoUrl = best?.url || result.videoUrl;
    result.formats = result.formats.length ? result.formats : collectFormats(formats);
    result.title = info.basic_info?.title || result.title;
    result.author = info.basic_info?.author || result.author;
    result.description = (info.basic_info?.description || '').slice(0, 5000) || result.description;
    result.cover = info.basic_info?.thumbnail?.[0]?.url || result.cover;
    result.parser = 'innertube-api';
    if (result.videoUrl) return result;
  } catch (error) {
    console.error('[youtube] InnerTube failed:', error.message?.slice(0, 100));
  }

  try {
    const { html, finalUrl } = await expandAndFetchPage(input.toString(), options);
    const pageResult = parseWatchPage(html, finalUrl);
    Object.assign(result, {
      ...pageResult,
      title: result.title || pageResult.title,
      description: result.description || pageResult.description,
      author: result.author || pageResult.author,
      cover: result.cover || pageResult.cover,
      formats: result.formats.length ? result.formats : pageResult.formats
    });
    if (result.videoUrl) return result;
  } catch (error) {
    console.error('[youtube] page scan failed:', error.message);
  }

  if (!result.videoUrl) {
    try {
      let info;
      for (const client of ['web', 'ios', 'android']) {
        try {
          info = await ytdl.getInfo(input.toString(), { clients: [client] });
          if (info?.formats?.some((format) => format.url)) break;
        } catch {
          continue;
        }
      }
      if (info) {
        const formats = info.formats || [];
        const best = pickFormat(formats);
        result.videoUrl = best?.url || result.videoUrl;
        result.title = result.title || info.videoDetails?.title || null;
        result.description = result.description || info.videoDetails?.description?.slice(0, 5000) || null;
        result.author = result.author || info.videoDetails?.author?.name || null;
        result.cover = result.cover || info.videoDetails?.thumbnails?.slice(-1)[0]?.url || null;
        result.formats = result.formats.length ? result.formats : collectFormats(formats);
        result.parser = 'ytdl-core';
      }
    } catch (error) {
      console.error('[youtube] ytdl-core failed:', error.message?.slice(0, 100));
    }
  }

  return result;
}
