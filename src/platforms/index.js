import * as xiaohongshu from './xiaohongshu.js';
import * as douyin from './douyin.js';
import * as tiktok from './tiktok.js';
import * as youtube from './youtube.js';
import * as facebook from './facebook.js';

const platforms = [xiaohongshu, douyin, tiktok, youtube, facebook];

/**
 * Detect platform by hostname.
 * @param {string} hostname
 * @returns {object|null} Platform module or null if not matched.
 */
export function detectPlatform(hostname) {
  if (!hostname) return null;
  const host = hostname.toLowerCase();
  for (const platform of platforms) {
    if (platform.hosts?.has(host)) return platform;
    if (platform.isMediaHost?.(host)) return platform;
  }
  return null;
}

/**
 * Get platform module by name.
 * @param {string} name
 * @returns {object|null}
 */
export function getPlatform(name) {
  return platforms.find((p) => p.name === name) || null;
}

/**
 * Check if hostname is a share host of any registered platform.
 * @param {string} hostname
 * @returns {boolean}
 */
export function isShareHost(hostname) {
  if (!hostname) return false;
  const host = hostname.toLowerCase();
  return platforms.some((p) => p.hosts?.has(host));
}

/**
 * Check if hostname is a media host of any registered platform.
 * @param {string} hostname
 * @returns {boolean}
 */
export function isMediaHost(hostname) {
  if (!hostname) return false;
  return platforms.some((p) => {
    // Use the platform's own isMediaHost if it exists (for subdomain checks etc.)
    if (typeof p.isMediaHost === 'function') return p.isMediaHost(hostname);
    // Fallback: simple Set lookup
    return p.mediaHosts?.has(hostname.toLowerCase());
  });
}

/**
 * Resolve a share URL using the appropriate platform module.
 * @param {string} inputText
 * @param {object} options
 * @returns {Promise<object>}
 */
export async function resolveForPlatform(inputText, options) {
  if (!inputText) throw new Error('找不到可解析的網址');
  const { extractFirstUrl } = await import('../utils.js');
  const extracted = extractFirstUrl(inputText);
  if (!extracted) throw new Error('找不到可解析的網址');

  const parsed = new URL(extracted);
  const platform = detectPlatform(parsed.hostname);
  if (!platform) throw new Error('不支援的平台或網域');

  // If direct media URL, handle it generically
  if (platform.isMediaHost?.(parsed.hostname)) {
    const isVideo = /\.mp4(?:$|\?)/i.test(parsed.pathname + parsed.search) || /video|stream/i.test(parsed.pathname);
    return {
      platform: platform.name,
      sourceUrl: parsed.toString(),
      noteId: null,
      title: null,
      description: null,
      author: null,
      cover: null,
      type: isVideo ? 'video' : 'images',
      videoUrl: isVideo ? parsed.toString() : null,
      alternatives: [],
      images: isVideo ? [] : [parsed.toString()],
      parser: 'direct-media-url'
    };
  }

  return platform.resolveShare(inputText, options);
}

/**
 * Handle direct media URL result by creating a standard result object.
 * @param {URL} parsed
 * @param {string} rawUrl
 * @returns {object}
 */
export function directMediaResult(parsed, rawUrl) {
  const isVideo = /\.mp4(?:$|\?)/i.test(parsed.pathname + parsed.search) || /video|stream/i.test(parsed.pathname);
  return {
    platform: null,
    sourceUrl: parsed.toString(),
    noteId: null,
    title: null,
    description: null,
    author: null,
    cover: null,
    type: isVideo ? 'video' : 'images',
    videoUrl: isVideo ? parsed.toString() : null,
    alternatives: [],
    images: isVideo ? [] : [parsed.toString()],
    parser: 'direct-media-url'
  };
}

export { extractFirstUrl } from '../utils.js';
