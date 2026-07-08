// src/platforms/douyin.js
import * as cheerio from 'cheerio';
import {
  assertHttpUrl,
  assertPublicResolution,
  extractFirstUrl,
  normalizeEscapedUrl,
  unique
} from '../utils.js';

export const name = 'douyin';

export const hosts = new Set([
  'douyin.com',
  'www.douyin.com',
  'v.douyin.com',
  'm.douyin.com',
  'iesdouyin.com',
  'www.iesdouyin.com'
]);

export const mediaHosts = new Set([
  'douyincdn.com',
  'douyinvod.com',
  'douyinpic.com',
  'douyinstatic.com',
  'pstatp.com',
  'toutiaoimg.com',
  'toutiaoimg.cn',
  'byteimg.com',
  'bytecdn.cn',
  'bytecdn.com',
  'zjcdn.com',
  'ixigua.com'
]);

export function isMediaHost(hostname = '') {
  const lower = hostname.toLowerCase();
  for (const host of mediaHosts) {
    if (lower === host || lower.endsWith('.' + host)) return true;
  }
  return false;
}

function isDouyinPageHost(hostname = '') {
  const lower = hostname.toLowerCase();
  return hosts.has(lower) || lower.endsWith('.douyin.com') || lower.endsWith('.iesdouyin.com');
}

export function isDirectMediaUrl(input) {
  try {
    const parsed = input instanceof URL ? input : new URL(input);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (isMediaHost(host)) return true;
    if (!isDouyinPageHost(host)) return false;
    return /\/aweme\/v1\/(?:play|playwm|play_url)\//i.test(path) ||
      /\/video\/tos\//i.test(path) ||
      /\/obj\//i.test(path);
  } catch {
    return false;
  }
}

export function isVideoDirectUrl(input) {
  try {
    const parsed = input instanceof URL ? input : new URL(input);
    const full = parsed.pathname + parsed.search;
    return isDirectMediaUrl(parsed) &&
      !/\.(?:jpe?g|png|webp|gif)(?:$|\?)/i.test(full) &&
      (/\.mp4(?:$|\?)/i.test(full) || /video|play|stream|tos/i.test(full));
  } catch {
    return false;
  }
}

export function detect(input) {
  try {
    const parsed = new URL(input);
    const host = parsed.hostname.toLowerCase();
    return hosts.has(host) || host.endsWith('.douyin.com') || host.endsWith('.iesdouyin.com');
  } catch {
    return false;
  }
}

const DESKTOP_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh;q=0.9',
  referer: 'https://www.douyin.com/'
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
      throw new Error('Douyin page is too large to parse safely');
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

export function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'v.douyin.com' || parsed.hostname.endsWith('.v.douyin.com')) {
      return parsed.pathname.replace(/^\//, '').replace(/\/$/, '') || null;
    }
    const patterns = [
      /\/video\/(\d+)/,
      /\/note\/(\d+)/,
      /\/share\/video\/(\d+)/,
      /\/share\/note\/(\d+)/
    ];
    for (const pattern of patterns) {
      const match = parsed.pathname.match(pattern);
      if (match) return match[1];
    }
    return parsed.searchParams.get('vid') ||
      parsed.searchParams.get('video_id') ||
      parsed.searchParams.get('item_id') ||
      parsed.searchParams.get('aweme_id') ||
      null;
  } catch {
    return null;
  }
}

function deepCollectStrings(value, output, depth = 0) {
  if (depth > 24 || value == null) return;
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) deepCollectStrings(item, output, depth + 1);
    return;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value)) deepCollectStrings(item, output, depth + 1);
  }
}

function parseJsonLoosely(text = '') {
  const trimmed = String(text).trim().replace(/;\s*$/, '');
  if (!trimmed) return null;

  const candidates = [trimmed];
  const equalIndex = trimmed.indexOf('=');
  if (equalIndex > 0) candidates.push(trimmed.slice(equalIndex + 1).trim());
  try {
    const decoded = decodeURIComponent(trimmed);
    if (decoded !== trimmed) candidates.push(decoded);
  } catch {
    // Not percent encoded.
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Some scripts are JavaScript assignments instead of strict JSON.
    }
  }
  return null;
}

function extractAssignedObject(source, marker) {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;
  const start = source.indexOf('{', markerIndex + marker.length);
  if (start < 0) return null;

  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function normalizeJsonAssignment(raw) {
  return raw
    .replace(/:\s*undefined(?=\s*[,}])/g, ':null')
    .replace(/([[,])\s*undefined(?=\s*[,\]])/g, '$1null');
}

function parsePageData(html, $) {
  const states = [];
  const markers = [
    'window.__INITIAL_STATE__',
    'window._SSR_HYDRATED_DATA',
    'window.__SSR_HYDRATED_DATA',
    'window._ROUTER_DATA',
    'window.__ROUTER_DATA__',
    'self.__pace_f.push'
  ];

  for (const marker of markers) {
    const raw = extractAssignedObject(html, marker);
    if (!raw) continue;
    const parsed = parseJsonLoosely(normalizeJsonAssignment(raw));
    if (parsed) states.push(parsed);
  }

  $('script').each((_, element) => {
    const id = ($(element).attr('id') || '').toLowerCase();
    const text = $(element).html() || '';
    if (!text) return;
    if (['render_data', '__next_data__', 'rehydrate-data'].includes(id)) {
      const parsed = parseJsonLoosely(text);
      if (parsed) states.push(parsed);
    }
  });

  return states;
}

function sanitizeCandidate(raw) {
  if (!raw) return null;
  let candidate = normalizeEscapedUrl(raw)
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\u003A/gi, ':')
    .replace(/\\u0025/gi, '%');

  try {
    const decoded = decodeURIComponent(candidate);
    if (/^https?:\/\//i.test(decoded)) candidate = normalizeEscapedUrl(decoded);
  } catch {
    // Leave non-percent-encoded URLs as-is.
  }

  candidate = candidate
    .replace(/&amp;/gi, '&')
    .split(/(?=["'< >\s])/)[0]
    .replace(/[),.;]+$/g, '');

  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractUrlLikeStrings(text) {
  const variants = [normalizeEscapedUrl(text)];
  try {
    const decoded = decodeURIComponent(text);
    if (decoded !== text) variants.push(normalizeEscapedUrl(decoded));
  } catch {
    // Not percent encoded.
  }
  const matches = [];
  for (const variant of variants) {
    matches.push(...(variant.match(/https?:\/\/[^\s"'<>\\]+/gi) || []));
  }
  return matches.map(sanitizeCandidate).filter(Boolean);
}

function isVideoUrl(url) {
  try {
    const parsed = new URL(url);
    if (/\.(?:jpe?g|png|webp|gif)(?:$|\?)/i.test(parsed.pathname + parsed.search)) return false;
    if (isVideoDirectUrl(parsed)) return true;
    return isMediaHost(parsed.hostname) &&
      (/\.mp4(?:$|\?)/i.test(parsed.pathname + parsed.search) || /video|play|stream|tos/i.test(parsed.pathname));
  } catch {
    return false;
  }
}

function isImageUrl(url) {
  try {
    const parsed = new URL(url);
    if (!isMediaHost(parsed.hostname)) return false;
    const full = parsed.pathname + parsed.search;
    return !isVideoUrl(url) &&
      (/\.(?:jpe?g|png|webp|gif)(?:$|\?)/i.test(full) || /image|cover|avatar|tos|obj/i.test(full));
  } catch {
    return false;
  }
}

function rankVideo(url) {
  let score = 0;
  try {
    const parsed = new URL(url);
    const full = (parsed.hostname + parsed.pathname + parsed.search).toLowerCase();
    if (isVideoDirectUrl(parsed)) score += 120;
    if (isMediaHost(parsed.hostname)) score += 100;
    if (/douyinvod|douyincdn|zjcdn|ixigua/.test(full)) score += 35;
    if (/\/aweme\/v1\/play\//.test(full)) score += 35;
    if (/\.mp4(?:$|\?)/i.test(full)) score += 25;
    if (/watermark=0|no_watermark|play_addr/.test(full)) score += 15;
    if (/playwm|watermark=1/.test(full)) score -= 25;
    if (/cover|image|avatar|poster/.test(full)) score -= 80;
    if (parsed.protocol === 'https:') score += 5;
  } catch {
    return -999;
  }
  return score;
}

function rankImage(url) {
  let score = 0;
  try {
    const parsed = new URL(url);
    const full = (parsed.hostname + parsed.pathname + parsed.search).toLowerCase();
    if (isMediaHost(parsed.hostname)) score += 100;
    if (/douyinpic|toutiaoimg|byteimg|pstatp/.test(full)) score += 30;
    if (/cover|poster/.test(full)) score += 12;
    if (/avatar|icon|logo/.test(full)) score -= 80;
  } catch {
    return -999;
  }
  return score;
}

function pickMediaUrls(strings) {
  const expanded = [];
  for (const item of strings) {
    expanded.push(...extractUrlLikeStrings(item));
    const direct = sanitizeCandidate(item);
    if (direct) expanded.push(direct);
  }

  const urls = unique(expanded);
  const videos = urls
    .filter(isVideoUrl)
    .sort((a, b) => rankVideo(b) - rankVideo(a) || b.length - a.length);
  const images = urls
    .filter(isImageUrl)
    .sort((a, b) => rankImage(b) - rankImage(a) || b.length - a.length);

  return { videos, images };
}

function getFirstMeta($, keys) {
  for (const key of keys) {
    const value = $(`meta[property="${key}"],meta[name="${key}"]`).attr('content');
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function findStringByKey(value, keys, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 16) return null;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findStringByKey(child, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  for (const key of keys) {
    const found = value[key];
    if (typeof found === 'string' && found.trim()) return found.trim();
  }
  for (const child of Object.values(value)) {
    const found = findStringByKey(child, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

export function parsePublicPageHtml(html, finalUrl = '') {
  const $ = cheerio.load(html);
  const states = parsePageData(html, $);
  const strings = [];

  for (const state of states) deepCollectStrings(state, strings);

  const metaKeys = [
    'og:video',
    'og:video:url',
    'og:video:secure_url',
    'twitter:player:stream',
    'og:image',
    'twitter:image'
  ];
  for (const key of metaKeys) {
    const content = $(`meta[property="${key}"],meta[name="${key}"]`).attr('content');
    if (content) strings.push(content);
  }

  $('script').each((_, element) => {
    const text = $(element).html() || '';
    if (!text) return;
    strings.push(text);
    const parsed = parseJsonLoosely(text);
    if (parsed) deepCollectStrings(parsed, strings);
  });

  strings.push(html);

  const { videos, images } = pickMediaUrls(strings);
  const firstState = states[0] || null;
  const noteId = extractVideoId(finalUrl);
  const title =
    findStringByKey(firstState, ['desc', 'title', 'share_title']) ||
    getFirstMeta($, ['og:title', 'twitter:title']) ||
    $('title').first().text().trim() ||
    null;
  const description =
    findStringByKey(firstState, ['description', 'share_desc']) ||
    getFirstMeta($, ['og:description', 'description', 'twitter:description']) ||
    null;
  const author = findStringByKey(firstState, ['nickname', 'nickName', 'authorName']) || null;
  const cover =
    sanitizeCandidate(getFirstMeta($, ['og:image', 'twitter:image'])) ||
    images[0] ||
    null;

  return {
    sourceUrl: finalUrl || null,
    noteId,
    title,
    description,
    author,
    cover,
    type: videos[0] ? 'video' : (images.length ? 'images' : null),
    videoUrl: videos[0] || null,
    alternatives: videos.slice(1, 8),
    images: images.slice(0, 30),
    parser: states.length ? 'initial-state' : 'page-media-scan'
  };
}

async function expandAndFetchPage(rawUrl, options) {
  const input = assertHttpUrl(rawUrl);
  if (!isDouyinPageHost(input.hostname)) {
    throw new Error('Only Douyin share URLs or Douyin media URLs are supported');
  }
  await assertPublicResolution(input.hostname);

  const response = await fetch(input, {
    redirect: 'follow',
    headers: DESKTOP_HEADERS,
    signal: AbortSignal.timeout(options.timeoutMs)
  });
  const finalUrl = assertHttpUrl(response.url);
  if (!response.ok) throw new Error(`Douyin page returned HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  if (!/text\/html|application\/json|text\/plain/i.test(contentType)) {
    throw new Error(`Unsupported Douyin response type: ${contentType || 'unknown'}`);
  }
  const html = await readTextWithLimit(response, options.maxHtmlBytes);
  return { html, finalUrl: finalUrl.toString() };
}

export async function resolveShare(inputText, options) {
  const extracted = extractFirstUrl(inputText);
  if (!extracted) throw new Error('Please provide a Douyin share URL');
  const input = assertHttpUrl(extracted);

  if (isDirectMediaUrl(input)) {
    const isVideo = isVideoDirectUrl(input);
    return {
      sourceUrl: input.toString(),
      noteId: extractVideoId(extracted),
      title: null,
      description: null,
      author: null,
      cover: null,
      type: isVideo ? 'video' : 'images',
      videoUrl: isVideo ? input.toString() : null,
      alternatives: [],
      images: isVideo ? [] : [input.toString()],
      parser: 'direct-media-url',
      platform: 'douyin'
    };
  }

  const { html, finalUrl } = await expandAndFetchPage(input.toString(), options);
  const result = parsePublicPageHtml(html, finalUrl);
  result.platform = 'douyin';

  if (!result.videoUrl && !result.images.length) {
    const error = new Error('No downloadable media was found in the public Douyin page');
    error.code = 'MEDIA_NOT_FOUND';
    throw error;
  }

  return result;
}
