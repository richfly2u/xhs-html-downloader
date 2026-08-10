// src/platforms/facebook.js
import { assertHttpUrl, assertPublicResolution, extractFirstUrl } from '../utils.js';

export const name = 'facebook';

export const hosts = new Set([
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'fb.watch',
  'www.fb.watch',
  'fb.com',
  'www.fb.com'
]);

export const mediaHosts = new Set([
  'fbcdn.net',
  'facebook.com'
]);

export function isMediaHost(hostname) {
  const lower = hostname.toLowerCase();
  return lower.endsWith('.fbcdn.net') || lower === 'fbcdn.net';
}

export function detect(input) {
  try {
    const parsed = new URL(input);
    return hosts.has(parsed.hostname.toLowerCase()) ||
           parsed.hostname.toLowerCase().endsWith('.facebook.com');
  } catch { return false; }
}

const DESKTOP_HEADERS = {
  // Facebook 對一般瀏覽器 UA 的伺服器端請求會回 400/登入牆；
  // facebookexternalhit/1.1 是 FB 官方爬蟲 UA，回傳完整頁面含 playable_url
  'user-agent': 'facebookexternalhit/1.1',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'zh-TW,zh;q=0.9,en;q=0.8',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'none',
  'upgrade-insecure-requests': '1',
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
    if (parsed.hostname === 'fb.watch' || parsed.hostname.endsWith('.fb.watch')) {
      return parsed.pathname.replace(/^\//, '').replace(/\/$/, '') || null;
    }
    return parsed.searchParams.get('v') || null;
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

function extractOgMeta(html) {
  const ogVideo = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]+)"/i)?.[1] ||
                  html.match(/<meta[^>]*property="og:video:url"[^>]*content="([^"]+)"/i)?.[1] || null;
  const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)?.[1] || null;
  const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1] || null;
  const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)?.[1] || null;
  return { ogVideo, ogImage, ogTitle, ogDesc };
}

// FB 頁面把影片網址內嵌在 JSON（reel/watch 都一樣）。
// 優先順序：browser_native_hd_url（720p）→ playable_url_quality_hd → playable_url → browser_native_sd_url
function extractEmbeddedVideo(html) {
  const keys = ['browser_native_hd_url', 'playable_url_quality_hd', 'playable_url', 'browser_native_sd_url'];
  for (const key of keys) {
    const m = html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    if (m && m[1]) return m[1].replace(/\\\//g, '/');
  }
  return null;
}

async function expandAndFetchPage(rawUrl, options) {
  const input = assertHttpUrl(rawUrl);
  await assertPublicResolution(input.hostname);

  const response = await fetch(input, {
    redirect: 'follow',
    headers: DESKTOP_HEADERS,
    signal: AbortSignal.timeout(options.timeoutMs)
  });
  if (!response.ok) throw new Error(`Facebook 頁面回應錯誤：HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (!/text\/html|application\/json/i.test(contentType)) {
    throw new Error(`無法解析的頁面格式：${contentType || '未知'}`);
  }
  const html = await readTextWithLimit(response, options.maxHtmlBytes);
  return { html, finalUrl: response.url };
}

export async function resolveShare(inputText, options) {
  const extracted = extractFirstUrl(inputText);
  if (!extracted) throw new Error('找不到可解析的網址');
  const input = assertHttpUrl(extracted);

  if (isMediaHost(input.hostname)) {
    const isVideo = /\.mp4(?:$|\?)/i.test(input.pathname + input.search) || /video|stream/i.test(input.pathname);
    return {
      sourceUrl: input.toString(), noteId: extractVideoId(extracted),
      title: null, description: null, author: null, cover: null,
      type: isVideo ? 'video' : 'images',
      videoUrl: isVideo ? input.toString() : null, alternatives: [], images: isVideo ? [] : [input.toString()],
      parser: 'direct-media-url', platform: 'facebook'
    };
  }

  const { html, finalUrl } = await expandAndFetchPage(input.toString(), options);
  const videoId = extractVideoId(finalUrl);
  const og = extractOgMeta(html);

  // FB 官方爬蟲 UA 回傳的頁面內嵌 playable_url 系列 JSON — 最可靠
  const embeddedVideo = extractEmbeddedVideo(html);

  let videoUrl = embeddedVideo || og.ogVideo || null;
  let images = og.ogImage ? [og.ogImage] : [];
  let title = og.ogTitle || null;
  let description = og.ogDesc || null;
  let author = null;

  if (!videoUrl && !images.length) {
    const error = new Error('Facebook 公開頁面中沒有找到可下載媒體');
    error.code = 'MEDIA_NOT_FOUND';
    throw error;
  }

  return {
    sourceUrl: finalUrl, noteId: videoId, title, description, author,
    cover: og.ogImage || null,
    type: videoUrl ? 'video' : (images.length ? 'images' : null),
    videoUrl, alternatives: [], images: images.slice(0, 30),
    parser: 'page-media-scan',
    platform: 'facebook'
  };
}
