import { resolvePublicShare } from '../resolver.js';

export const id = 'xiaohongshu';
export const label = 'Xiaohongshu';
export const shareHosts = [
  'xhslink.com',
  'www.xhslink.com',
  'xiaohongshu.com',
  'www.xiaohongshu.com',
  'm.xiaohongshu.com',
  'xhscdn.com',
  '*.xhscdn.com'
];

export async function resolveShare(input, options = {}) {
  const result = await resolvePublicShare(input, options);
  return {
    ...result,
    platform: id,
    platformLabel: label
  };
}
