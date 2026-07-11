import { extractFirstUrl, assertHttpUrl, hostMatches } from '../utils.js';
import * as xiaohongshu from './xiaohongshu.js';
import * as youtube from './youtube.js';
import * as douyin from './douyin.js';
import * as tiktok from './tiktok.js';
import * as facebook from './facebook.js';

export const platforms = [
  xiaohongshu,
  youtube,
  douyin,
  tiktok,
  facebook
];

export function detectPlatform(input = '') {
  const extracted = extractFirstUrl(input) || input;
  let url;
  try {
    url = assertHttpUrl(extracted);
  } catch {
    return null;
  }

  return platforms.find((platform) => hostMatches(url.hostname, platform.shareHosts)) || null;
}

export function getPlatform(id) {
  return platforms.find((platform) => platform.id === id) || null;
}

export async function resolveForPlatform(input, options = {}) {
  const extracted = extractFirstUrl(input);
  if (!extracted) {
    const error = new Error('請貼上支援平台的公開分享連結');
    error.code = 'NO_URL';
    throw error;
  }

  const platform = detectPlatform(extracted);
  if (!platform) {
    const error = new Error('不支援此平台；目前只支援小紅書、YouTube、抖音、TikTok 與 Facebook 的公開連結');
    error.code = 'UNSUPPORTED_PLATFORM';
    throw error;
  }

  return platform.resolveShare(extracted, options);
}
