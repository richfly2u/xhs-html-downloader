import { resolveGenericShare } from './generic-html.js';

export const id = 'tiktok';
export const label = 'TikTok';
export const shareHosts = [
  'tiktok.com',
  'www.tiktok.com',
  'm.tiktok.com',
  'vm.tiktok.com',
  'vt.tiktok.com'
];
export const mediaHosts = [
  '*.tiktokcdn.com',
  '*.tiktokcdn-us.com',
  '*.tikcdn.net',
  '*.bytecdn.com',
  '*.byteoversea.com',
  '*.ibytedtos.com',
  '*.ibyteimg.com',
  '*.muscdn.com'
];
export const referer = 'https://www.tiktok.com/';

export function resolveShare(input, options = {}) {
  return resolveGenericShare(input, { id, label, shareHosts, mediaHosts, referer }, options);
}
