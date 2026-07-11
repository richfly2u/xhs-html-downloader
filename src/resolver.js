import { assertHttpUrl, assertPublicResolution, extractFirstUrl } from './utils.js';
import { resolveForPlatform, isMediaHost } from './platforms/index.js';

export { extractFirstUrl };

export async function resolvePublicShare(inputText, options) {
  return resolveForPlatform(inputText, options);
}

export async function probeMedia(url, timeoutMs = 10000) {
  const parsed = assertHttpUrl(url);
  if (!isMediaHost(parsed.hostname)) throw new Error('媒體網址不在允許的 CDN 網域');
  await assertPublicResolution(parsed.hostname);
  const response = await fetch(parsed, {
    method: 'GET', redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36',
      accept: '*/*', referer: 'https://www.xiaohongshu.com/',
      range: 'bytes=0-0'
    },
    signal: AbortSignal.timeout(timeoutMs)
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
