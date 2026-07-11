import { resolveGenericShare } from './generic-html.js';

export const id = 'douyin';
export const label = 'Douyin';
export const shareHosts = [
  'douyin.com',
  'www.douyin.com',
  'm.douyin.com',
  'v.douyin.com',
  'iesdouyin.com',
  '*.iesdouyin.com'
];
export const mediaHosts = [
  '*.douyinvod.com',
  '*.douyinpic.com',
  '*.douyinstatic.com',
  '*.bytecdn.cn',
  '*.byteimg.com',
  '*.bytedance.com',
  '*.bytednsdoc.com'
];
export const referer = 'https://www.douyin.com/';

export function resolveShare(input, options = {}) {
  return resolveGenericShare(input, { id, label, shareHosts, mediaHosts, referer }, options);
}
