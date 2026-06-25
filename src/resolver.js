import * as cheerio from 'cheerio';
import {
  assertHttpUrl,
  assertPublicResolution,
  extractFirstUrl,
  isMediaHost,
  isShareHost,
  normalizeEscapedUrl,
  unique
} from './utils.js';

const DESKTOP_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-CN,zh-TW;q=0.9,en;q=0.7',
  referer: 'https://www.xiaohongshu.com/'
};

function timeoutSignal(ms) {
  return AbortSignal.timeout(ms);
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

function parseJsonLoosely(text) {
  const trimmed = text.trim().replace(/;\s*$/, '');
  const candidates = [trimmed];
  const equalIndex = trimmed.indexOf('=');
  if (equalIndex > 0) candidates.push(trimmed.slice(equalIndex + 1).trim());

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Some scripts are JavaScript rather than strict JSON.
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

function parseInitialState(html) {
  const raw = extractAssignedObject(html, 'window.__INITIAL_STATE__');
  if (!raw) return null;
  const normalized = raw
    .replace(/:\s*undefined(?=\s*[,}])/g, ':null')
    .replace(/([[,])\s*undefined(?=\s*[,\]])/g, '$1null');
  try {
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

function findObjectByKey(value, key, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 12) return null;
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = findObjectByKey(child, key, depth + 1);
    if (found) return found;
  }
  return null;
}

function extractNoteId(url = '') {
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/\/(?:explore|discovery\/item)\/([a-zA-Z0-9]+)/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

function findNoteCard(initialState, noteId) {
  if (!initialState) return null;
  const noteRoot = initialState.note || initialState.notes || initialState;
  const detailMap =
    noteRoot.noteDetailMap ||
    noteRoot.note_detail_map ||
    findObjectByKey(noteRoot, 'noteDetailMap') ||
    findObjectByKey(noteRoot, 'note_detail_map');

  if (detailMap && typeof detailMap === 'object') {
    const entry = (noteId && detailMap[noteId]) || Object.values(detailMap)[0];
    if (entry && typeof entry === 'object') return entry.note || entry.noteCard || entry.note_card || entry;
  }

  return findObjectByKey(noteRoot, 'noteCard') || findObjectByKey(noteRoot, 'note_card');
}

function sanitizeCandidate(raw) {
  if (!raw) return null;
  let candidate = normalizeEscapedUrl(raw)
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\u003D/gi, '=')
    .replace(/\\u003F/gi, '?');

  candidate = candidate.split(/(?=["'< >\s])/)[0];
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function extractUrlLikeStrings(text) {
  const normalized = normalizeEscapedUrl(text);
  const matches = normalized.match(/https?:\/\/[^\s"'<>\\]+/gi) || [];
  return matches.map(sanitizeCandidate).filter(Boolean);
}

function rankVideo(url) {
  let score = 0;
  try {
    const parsed = new URL(url);
    if (isMediaHost(parsed.hostname)) score += 100;
    if (parsed.hostname.startsWith('sns-video')) score += 30;
    if (/\.mp4(?:$|\?)/i.test(parsed.pathname + parsed.search)) score += 50;
    if (/stream|video/i.test(parsed.pathname)) score += 10;
    if (/cover|image|thumbnail/i.test(parsed.pathname)) score -= 40;
    if (/^https:/i.test(url)) score += 5;
  } catch {
    return -999;
  }
  return score;
}

function rankImage(url) {
  let score = 0;
  try {
    const parsed = new URL(url);
    if (isMediaHost(parsed.hostname)) score += 100;
    if (/sns-webpic|sns-img|image/i.test(parsed.hostname + parsed.pathname)) score += 20;
    if (/cover|thumbnail/i.test(parsed.pathname)) score -= 10;
    if (/avatar|icon|logo/i.test(parsed.pathname)) score -= 80;
  } catch {
    return -999;
  }
  return score;
}

function pickMediaUrls(allStrings) {
  const expanded = [];
  for (const item of allStrings) {
    expanded.push(...extractUrlLikeStrings(item));
    const direct = sanitizeCandidate(item);
    if (direct) expanded.push(direct);
  }

  const videos = unique(expanded.filter((url) => {
    try {
      const parsed = new URL(url);
      return isMediaHost(parsed.hostname) && (/\.mp4(?:$|\?)/i.test(url) || /video|stream/i.test(parsed.pathname));
    } catch {
      return false;
    }
  })).sort((a, b) => rankVideo(b) - rankVideo(a));

  const images = unique(expanded.filter((url) => {
    try {
      const parsed = new URL(url);
      if (!isMediaHost(parsed.hostname)) return false;
      return !/video|\.mp4(?:$|\?)/i.test(parsed.pathname + parsed.search);
    } catch {
      return false;
    }
  })).sort((a, b) => rankImage(b) - rankImage(a));

  return { videos, images };
}

function getString(value, keys) {
  for (const key of keys) {
    const found = value?.[key];
    if (typeof found === 'string' && found.trim()) return found.trim();
  }
  return null;
}

function getAuthor(noteCard) {
  const user = noteCard?.user || noteCard?.author || noteCard?.userInfo || noteCard?.user_info;
  return getString(user, ['nickname', 'nickName', 'name', 'userName', 'user_name']);
}

export function parsePublicPageHtml(html, finalUrl = '') {
  const $ = cheerio.load(html);
  const noteId = extractNoteId(finalUrl);
  const initialState = parseInitialState(html);
  const noteCard = findNoteCard(initialState, noteId);
  const strings = [];

  if (noteCard) deepCollectStrings(noteCard, strings);
  if (initialState) deepCollectStrings(initialState, strings);

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

  // Last-resort scan for escaped media URLs that are not in valid JSON.
  strings.push(html);

  const { videos, images } = pickMediaUrls(strings);

  // Also explicitly extract video URL from noteCard if type is 'video'
  let explicitVideoUrl = null;
  if (noteCard) {
    const noteType = getString(noteCard, ['type', 'noteType', 'note_type', 'noteCardType']);
    if (noteType === 'video') {
      const videoBlock = noteCard.video || noteCard.media || noteCard.videoInfo || noteCard.video_info;
      if (videoBlock) {
        const stream = videoBlock.stream || videoBlock.media?.stream || videoBlock;
        const h264Master = stream.h264?.[0]?.master_url
          || stream.h264?.[0]?.url
          || stream.h264?.[0]?.backup_url;
        const mp4Url = getString(videoBlock, ['downloadUrl', 'download_url', 'url', 'directUrl', 'direct_url']);
        explicitVideoUrl = h264Master || mp4Url || null;
      }
    }
  }

  const title =
    getString(noteCard, ['title', 'displayTitle', 'display_title']) ||
    $('meta[property="og:title"]').attr('content') ||
    $('meta[name="twitter:title"]').attr('content') ||
    $('title').first().text().trim() ||
    null;
  const description =
    getString(noteCard, ['desc', 'description', 'content']) ||
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    $('meta[name="twitter:description"]').attr('content') ||
    null;
  const cover =
    sanitizeCandidate($('meta[property="og:image"]').attr('content')) ||
    sanitizeCandidate($('meta[name="twitter:image"]').attr('content')) ||
    images[0] ||
    null;

  const bestVideoUrl = explicitVideoUrl || videos[0] || null;

  return {
    sourceUrl: finalUrl || null,
    noteId,
    title,
    description,
    author: getAuthor(noteCard),
    cover,
    type: bestVideoUrl ? 'video' : (images.length ? 'images' : null),
    videoUrl: bestVideoUrl,
    alternatives: videos.slice(1, 8),
    images: images.slice(0, 30),
    parser: noteCard ? 'initial-state' : 'page-media-scan'
  };
}

async function expandAndFetchPage(rawUrl, options) {
  const input = assertHttpUrl(rawUrl);
  if (!isShareHost(input.hostname)) {
    throw new Error('只接受小紅書分享連結或小紅書 CDN 媒體連結');
  }
  await assertPublicResolution(input.hostname);

  const fetchHeaders = { ...DESKTOP_HEADERS };
  if (options.cookie) {
    fetchHeaders['Cookie'] = options.cookie;
  }

  const response = await fetch(input, {
    redirect: 'follow',
    headers: fetchHeaders,
    signal: timeoutSignal(options.timeoutMs)
  });
  const finalUrl = assertHttpUrl(response.url);
  if (!isShareHost(finalUrl.hostname)) {
    throw new Error('短連結跳轉到非小紅書網域，已拒絕解析');
  }
  if (!response.ok) {
    throw new Error(`小紅書頁面回應錯誤：HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!/text\/html|application\/json|text\/plain/i.test(contentType)) {
    throw new Error(`無法解析的頁面格式：${contentType || '未知'}`);
  }
  const html = await readTextWithLimit(response, options.maxHtmlBytes);
  return { html, finalUrl: finalUrl.toString() };
}

export async function resolvePublicShare(inputText, options) {
  const extracted = extractFirstUrl(inputText);
  if (!extracted) throw new Error('找不到可解析的網址');
  const input = assertHttpUrl(extracted);

  if (isMediaHost(input.hostname)) {
    const isVideo = /\.mp4(?:$|\?)/i.test(input.pathname + input.search) || /video|stream/i.test(input.pathname);
    return {
      sourceUrl: input.toString(),
      noteId: null,
      title: null,
      description: null,
      author: null,
      cover: null,
      type: isVideo ? 'video' : 'images',
      videoUrl: isVideo ? input.toString() : null,
      alternatives: [],
      images: isVideo ? [] : [input.toString()],
      parser: 'direct-media-url'
    };
  }

  const { html, finalUrl } = await expandAndFetchPage(input.toString(), options);
  const result = parsePublicPageHtml(html, finalUrl);
  if (!result.videoUrl && result.images.length === 0) {
    const error = new Error('公開頁面中沒有找到可下載媒體；可能需要登入、遇到驗證、頁面已改版，或作品不可公開存取');
    error.code = 'MEDIA_NOT_FOUND';
    throw error;
  }
  return result;
}

export async function probeMedia(url, timeoutMs = 10000) {
  const parsed = assertHttpUrl(url);
  if (!isMediaHost(parsed.hostname)) throw new Error('媒體網址不在允許的 CDN 網域');
  await assertPublicResolution(parsed.hostname);

  const response = await fetch(parsed, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      ...DESKTOP_HEADERS,
      range: 'bytes=0-0'
    },
    signal: timeoutSignal(timeoutMs)
  });
  if (!(response.ok || response.status === 206)) return { bytes: null, contentType: null };

  const contentRange = response.headers.get('content-range');
  const contentLength = response.headers.get('content-length');
  const rangeSize = contentRange?.match(/\/(\d+)$/)?.[1];
  await response.body?.cancel();
  return {
    bytes: Number(rangeSize || contentLength) || null,
    contentType: response.headers.get('content-type') || null
  };
}
