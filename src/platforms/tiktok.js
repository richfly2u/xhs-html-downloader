// src/platforms/tiktok.js
import { assertHttpUrl, assertPublicResolution, extractFirstUrl } from '../utils.js';

export const name = 'tiktok';

export const hosts = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'vm.tiktok.com',
  'm.tiktok.com'
]);

export const mediaHosts = new Set([
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'bytecdn.com',
  'tikcdn.net',
  'tiktok.com'
]);

export function isMediaHost(hostname) {
  const lower = hostname.toLowerCase();
  return lower.endsWith('.tiktokcdn.com') ||
         lower.endsWith('.tiktokcdn-us.com') ||
         lower.endsWith('.bytecdn.com') ||
         lower.endsWith('.tikcdn.net') ||
         mediaHosts.has(lower);
}

export function detect(input) {
  try {
    const parsed = new URL(input);
    return hosts.has(parsed.hostname.toLowerCase()) ||
           parsed.hostname.toLowerCase().endsWith('.tiktok.com');
  } catch { return false; }
}

const DESKTOP_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

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

export function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'vm.tiktok.com' || parsed.hostname.endsWith('.vm.tiktok.com')) {
      return parsed.pathname.replace(/^\//, '').replace(/\/$/, '');
    }
    const match = parsed.pathname.match(/\/video\/(\d+)/);
    return match?.[1] || null;
  } catch { return null; }
}

function extractStrings(obj, depth = 0) {
  const result = [];
  if (depth > 16 || obj == null) return result;
  if (typeof obj === 'string') { result.push(obj); return result; }
  if (Array.isArray(obj)) { for (const item of obj) result.push(...extractStrings(item, depth + 1)); return result; }
  if (typeof obj === 'object') { for (const val of Object.values(obj)) result.push(...extractStrings(val, depth + 1)); }
  return result;
}

function parseSignedData(html) {
  const patterns = [
    /window\.__SIGNED_DATA\s*=\s*({.+?});/s,
    /<script[^>]*id="__NEXT_DATA__"[^>]*>({.+?})<\/script>/s,
    /window\.__INITIAL_STATE__\s*=\s*({.+?});/s,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try { return JSON.parse(match[1]); } catch { continue; }
    }
  }
  return null;
}

function findVideoUrl(data) {
  const strings = extractStrings(data);
  const candidates = strings.filter((s) => {
    try {
      const u = new URL(s);
      return isMediaHost(u.hostname) && /\.mp4/i.test(s);
    } catch { return false; }
  });
  return candidates.sort((a, b) => b.length - a.length)[0] || null;
}

function findImages(data) {
  const strings = extractStrings(data);
  const candidates = strings.filter((s) => {
    try {
      const u = new URL(s);
      return isMediaHost(u.hostname) && !/\.mp4/i.test(s) && /image|cover|avatar/i.test(s);
    } catch { return false; }
  });
  return [...new Set(candidates)].slice(0, 30);
}

function extractOgMeta(html) {
  const ogVideo = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]+)"/i)?.[1] || null;
  const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)?.[1] || null;
  const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1] || null;
  const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)?.[1] || null;
  return { ogVideo, ogImage, ogTitle, ogDesc };
}

async function expandAndFetchPage(rawUrl, options) {
  const input = assertHttpUrl(rawUrl);
  await assertPublicResolution(input.hostname);

  const response = await fetch(input, {
    redirect: 'follow',
    headers: DESKTOP_HEADERS,
    signal: AbortSignal.timeout(options.timeoutMs)
  });
  const finalUrl = assertHttpUrl(response.url);
  if (!response.ok) throw new Error(`TikTok 頁面回應錯誤：HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  if (!/text\/html|application\/json/i.test(contentType)) {
    throw new Error(`無法解析的頁面格式：${contentType || '未知'}`);
  }
  const html = await readTextWithLimit(response, options.maxHtmlBytes);
  return { html, finalUrl: finalUrl.toString() };
}

export async function resolveShare(inputText, options) {
  const extracted = extractFirstUrl(inputText);
  if (!extracted) throw new Error('找不到可解析的網址');
  const input = assertHttpUrl(extracted);

  if (isMediaHost(input.hostname)) {
    const isVideo = /\.mp4(?:$|\?)/i.test(input.pathname + input.search);
    return {
      sourceUrl: input.toString(), noteId: extractVideoId(extracted),
      title: null, description: null, author: null, cover: null,
      type: isVideo ? 'video' : 'images',
      videoUrl: isVideo ? input.toString() : null, alternatives: [], images: isVideo ? [] : [input.toString()],
      parser: 'direct-media-url', platform: 'tiktok'
    };
  }

  const { html, finalUrl } = await expandAndFetchPage(input.toString(), options);
  const videoId = extractVideoId(finalUrl);
  const og = extractOgMeta(html);
  const state = parseSignedData(html);

  let videoUrl = og.ogVideo || null;
  let images = [];
  let title = og.ogTitle || null;
  let description = og.ogDesc || null;
  let author = null;

  if (state) {
    const stateVideoUrl = findVideoUrl(state);
    if (stateVideoUrl) videoUrl = stateVideoUrl;
    images = findImages(state);
  }

  if (!videoUrl && !images.length) {
    const error = new Error('TikTok 公開頁面中沒有找到可下載媒體');
    error.code = 'MEDIA_NOT_FOUND';
    throw error;
  }

  return {
    sourceUrl: finalUrl, noteId: videoId, title, description, author,
    cover: og.ogImage || images[0] || null,
    type: videoUrl ? 'video' : (images.length ? 'images' : null),
    videoUrl, alternatives: [],
    images: images.slice(0, 30),
    parser: state ? 'initial-state' : 'page-media-scan',
    platform: 'tiktok'
  };
}
