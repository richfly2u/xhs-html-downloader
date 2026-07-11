import * as cheerio from 'cheerio';
import {
  assertAllowedHost,
  assertHttpUrl,
  fetchTextWithPolicy,
  hostMatches,
  normalizeEscapedUrl,
  unique
} from '../utils.js';

const BASE_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'zh-TW,zh;q=0.9,en;q=0.7'
};

function sanitizeUrl(raw) {
  if (!raw) return null;
  const value = normalizeEscapedUrl(raw).replace(/^['"]|['"]$/g, '').split(/(?=["'< >\s])/)[0];
  try {
    const url = assertHttpUrl(value);
    return url.toString();
  } catch {
    return null;
  }
}

function extractUrls(text) {
  const normalized = normalizeEscapedUrl(text || '');
  return (normalized.match(/https?:\/\/[^\s"'<>\\]+/gi) || []).map(sanitizeUrl).filter(Boolean);
}

function mediaKind(url) {
  const value = url.toLowerCase();
  if (/\.(mp4|mov|m4v|webm)(?:$|\?)/i.test(value) || /video|playwm|videoplayback/.test(value)) return 'video';
  if (/\.(jpe?g|png|webp|avif)(?:$|\?)/i.test(value) || /image|photo|img|pic|p16|p19/.test(value)) return 'image';
  return null;
}

function pickMedia(urls, mediaHosts) {
  const allowed = unique(urls).filter((url) => {
    try {
      return hostMatches(new URL(url).hostname, mediaHosts);
    } catch {
      return false;
    }
  });
  const videos = allowed.filter((url) => mediaKind(url) === 'video');
  const images = allowed.filter((url) => mediaKind(url) === 'image');
  return { videos, images };
}

export function parseGenericPageHtml(html, finalUrl, config) {
  const $ = cheerio.load(html);
  const strings = [];

  const metaSelectors = [
    'meta[property="og:video"]',
    'meta[property="og:video:url"]',
    'meta[property="og:video:secure_url"]',
    'meta[name="twitter:player:stream"]',
    'meta[property="og:image"]',
    'meta[name="twitter:image"]'
  ];
  for (const selector of metaSelectors) {
    const content = $(selector).attr('content');
    if (content) strings.push(content);
  }

  $('script').each((_, element) => {
    const text = $(element).html();
    if (text) strings.push(text);
  });
  strings.push(html);

  const media = pickMedia(strings.flatMap(extractUrls), config.mediaHosts);
  const title =
    $('meta[property="og:title"]').attr('content') ||
    $('meta[name="twitter:title"]').attr('content') ||
    $('title').first().text().trim() ||
    null;
  const description =
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    $('meta[name="twitter:description"]').attr('content') ||
    null;
  const cover = sanitizeUrl($('meta[property="og:image"]').attr('content')) || media.images[0] || null;

  return {
    platform: config.id,
    platformLabel: config.label,
    sourceUrl: finalUrl || null,
    noteId: null,
    title,
    description,
    author: null,
    cover,
    type: media.videos[0] ? 'video' : (media.images.length ? 'images' : null),
    videoUrl: media.videos[0] || null,
    alternatives: media.videos.slice(1, 8),
    images: media.images.slice(0, 30),
    parser: 'page-media-scan'
  };
}

export async function resolveGenericShare(input, config, options = {}) {
  const url = assertAllowedHost(assertHttpUrl(input), config.shareHosts, config.label);
  const { text, finalUrl } = await fetchTextWithPolicy(url.toString(), {
    allowedHosts: config.shareHosts,
    headers: {
      ...BASE_HEADERS,
      referer: config.referer || url.origin
    },
    timeoutMs: options.timeoutMs,
    maxBytes: options.maxHtmlBytes,
    label: config.label,
    skipDnsCheck: options.skipDnsCheck
  });

  const result = parseGenericPageHtml(text, finalUrl, config);
  if (!result.videoUrl && result.images.length === 0) {
    const error = new Error(`${config.label} 頁面沒有找到可下載的公開媒體`);
    error.code = 'MEDIA_NOT_FOUND';
    throw error;
  }
  return result;
}
