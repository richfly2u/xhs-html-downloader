import { assertHttpUrl, assertPublicResolution } from './utils.js';
import { isMediaHost } from './platforms/index.js';

const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36',
  accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  'accept-language': 'zh-CN,zh-TW;q=0.9,en;q=0.7',
  referer: 'https://www.xiaohongshu.com/'
};

async function readBufferWithLimit(response, maxBytes) {
  if (!response.body) throw new Error('縮圖服務沒有回傳內容');
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel('thumbnail too large');
      const error = new Error('縮圖檔案過大');
      error.code = 'THUMBNAIL_TOO_LARGE';
      throw error;
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks, total);
}

export async function fetchThumbnail(rawUrl, {
  timeoutMs = 15_000,
  maxBytes = 3.5 * 1024 * 1024,
  fetchImpl = fetch
} = {}) {
  const url = assertHttpUrl(rawUrl);
  if (!isMediaHost(url.hostname)) {
    throw new Error('只允許載入小紅書 CDN 圖片');
  }
  await assertPublicResolution(url.hostname);

  const response = await fetchImpl(url, {
    redirect: 'follow',
    headers: DEFAULT_HEADERS,
    signal: AbortSignal.timeout(timeoutMs)
  });

  const finalUrl = assertHttpUrl(response.url || url.toString());
  if (!isMediaHost(finalUrl.hostname)) {
    await response.body?.cancel();
    throw new Error('縮圖重新導向到非小紅書 CDN，已拒絕');
  }
  if (!response.ok || !response.body) {
    throw new Error(`縮圖來源回應錯誤：HTTP ${response.status}`);
  }

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!/^image\/(?:jpeg|jpg|png|webp|avif|gif)$/i.test(contentType)) {
    await response.body.cancel();
    throw new Error(`縮圖格式不支援：${contentType || '未知'}`);
  }

  const contentLength = Number(response.headers.get('content-length')) || null;
  if (contentLength && contentLength > maxBytes) {
    await response.body.cancel();
    const error = new Error('縮圖檔案過大');
    error.code = 'THUMBNAIL_TOO_LARGE';
    throw error;
  }

  const buffer = await readBufferWithLimit(response, maxBytes);
  return {
    buffer,
    contentType,
    etag: response.headers.get('etag') || null,
    lastModified: response.headers.get('last-modified') || null
  };
}
