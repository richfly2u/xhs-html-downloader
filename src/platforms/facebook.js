import { resolveGenericShare } from './generic-html.js';

export const id = 'facebook';
export const label = 'Facebook';
export const shareHosts = [
  'facebook.com',
  'www.facebook.com',
  'm.facebook.com',
  'fb.watch',
  'fb.com',
  'www.fb.com'
];
export const mediaHosts = [
  '*.fbcdn.net',
  '*.fbsbx.com',
  '*.xx.fbcdn.net',
  '*.facebook.com'
];
export const referer = 'https://www.facebook.com/';

export function resolveShare(input, options = {}) {
  return resolveGenericShare(input, { id, label, shareHosts, mediaHosts, referer }, options);
}
