# Multi-Platform Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the Xiaohongshu-only downloader into a multi-platform parser supporting Xiaohongshu, Douyin, TikTok, and YouTube.

**Architecture:** Each platform is a standalone module in `src/platforms/` exporting a uniform interface. A registry (`platforms/index.js`) aggregates hosts and routes URLs. The existing resolver becomes a thin dispatcher. Media proxy and thumbnail proxy query the registry for allowed CDNs instead of hardcoding.

**Tech Stack:** Node.js 20+, Cheerio, Express, Vite (none — plain JS modules)

---

## File Structure

### New files
- `src/platforms/index.js` — Registry: detect, getPlatform, isShareHost, isMediaHost
- `src/platforms/xiaohongshu.js` — XHS logic (extracted from resolver.js)
- `src/platforms/tiktok.js` — TikTok resolver
- `src/platforms/douyin.js` — Douyin resolver
- `src/platforms/youtube.js` — YouTube resolver
- `test/platforms/xiaohongshu.test.js` — XHS tests
- `test/platforms/tiktok.test.js` — TikTok tests
- `test/platforms/douyin.test.js` — Douyin tests
- `test/platforms/youtube.test.js` — YouTube tests
- `test/platforms/registry.test.js` — Registry tests

### Modified files
- `src/resolver.js` — Becomes a dispatcher that delegates to platform modules
- `src/utils.js` — Remove XHS-specific hosts, keep generic utilities
- `src/thumbnail.js` — Use `isMediaHost()` from registry
- `src/index.js` — Use registry for media proxy CDN validation
- `public/index.html` — Update hero text to mention all platforms
- `public/app.js` — Display `data.platform` in result card

### Removed
- `test/resolver.test.js` — replaced by `test/platforms/xiaohongshu.test.js`

---

## Phase 1: Create Platform Registry

### Task 1.1: Define platform interface and registry

**Files:**
- Create: `src/platforms/index.js`

- [ ] **Step 1: Write the registry**

```js
// src/platforms/index.js
// Central registry of all supported platforms.

import * as xiaohongshu from './xiaohongshu.js';
import * as douyin from './douyin.js';
import * as tiktok from './tiktok.js';
import * as youtube from './youtube.js';

const PLATFORMS = [xiaohongshu, douyin, tiktok, youtube];

/** Union of all share/redirect hostnames across platforms. */
function unionHosts(getter) {
  const set = new Set();
  for (const p of PLATFORMS) {
    for (const h of getter(p)) set.add(h);
  }
  return set;
}

const ALL_SHARE_HOSTS = unionHosts((p) => p.hosts);
const ALL_MEDIA_HOSTS = unionHosts((p) => p.mediaHosts);

/** Return the platform module whose `hosts` includes `hostname`, or null. */
export function detectPlatform(hostname) {
  const lower = hostname.toLowerCase();
  for (const p of PLATFORMS) {
    if (p.hosts.has(lower)) return p;
  }
  return null;
}

/** Return platform module by name. */
export function getPlatform(name) {
  return PLATFORMS.find((p) => p.name === name) || null;
}

export function isShareHost(hostname) {
  return ALL_SHARE_HOSTS.has(hostname.toLowerCase());
}

export function isMediaHost(hostname) {
  return ALL_MEDIA_HOSTS.has(hostname.toLowerCase());
}

/** Resolve input text against the matching platform. */
export async function resolveForPlatform(inputText, options) {
  const extracted = extractFirstUrl(inputText);
  if (!extracted) throw new Error('找不到可解析的網址');

  const parsed = new URL(extracted);
  const platform = detectPlatform(parsed.hostname);

  if (!platform) {
    // Try direct media URL check
    if (isMediaHost(parsed.hostname)) {
      return directMediaResult(parsed, extracted);
    }
    throw new Error('不支援此平台的網址');
  }

  return platform.resolveShare(extracted, options);
}

function directMediaResult(parsed, rawUrl) {
  const isVideo = /\.mp4(?:$|\?)/i.test(parsed.pathname + parsed.search) || /video|stream/i.test(parsed.pathname);
  const hostPlatform = [...PLATFORMS].find((p) => p.mediaHosts.has(parsed.hostname));
  return {
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
    parser: 'direct-media-url',
    platform: hostPlatform?.name || 'unknown'
  };
}

// re-export extractFirstUrl for use by platform modules
export { extractFirstUrl } from '../utils.js';
```

- [ ] **Step 2: Run a quick syntax check**

Run: `node --check src/platforms/index.js`
Expected: No errors (will fail on missing imports until modules exist — that's OK)

- [ ] **Step 3: Commit**

```bash
git add src/platforms/index.js
git commit -m "feat: add platform registry scaffold"
```

---

## Phase 2: Refactor Xiaohongshu into Platform Module

### Task 2.1: Extract XHS logic from resolver.js

**Files:**
- Create: `src/platforms/xiaohongshu.js`
- Modify: `src/resolver.js`
- Modify: `src/utils.js`

- [ ] **Step 1: Create `src/platforms/xiaohongshu.js`**

Copy the following from `src/resolver.js`:
- `DESKTOP_HEADERS`
- `parseInitialState`, `findObjectByKey`, `findNoteCard`
- `extractNoteId`, `extractAssignedObject`
- `deepCollectStrings`, `parseJsonLoosely`
- `sanitizeCandidate`, `extractUrlLikeStrings`
- `rankVideo`, `rankImage`, `pickMediaUrls`
- `getString`, `getAuthor`
- `parsePublicPageHtml`
- `expandAndFetchPage`, `resolvePublicShare`

Export as the platform interface:

```js
// src/platforms/xiaohongshu.js
import * as cheerio from 'cheerio';
import { assertHttpUrl, assertPublicResolution, extractFirstUrl, isShareHost, normalizeEscapedUrl, unique } from '../utils.js';

export const name = 'xiaohongshu';

export const hosts = new Set([
  'xhslink.com',
  'www.xhslink.com',
  'xiaohongshu.com',
  'www.xiaohongshu.com',
  'm.xiaohongshu.com'
]);

export const mediaHosts = new Set([
  'xhscdn.com',
]);

// isMediaHost check for subdomains:
export function isMediaHost(hostname) {
  return hostname === 'xhscdn.com' || hostname.endsWith('.xhscdn.com');
}

export function detect(input) {
  try {
    const parsed = new URL(input);
    return hosts.has(parsed.hostname.toLowerCase());
  } catch { return false; }
}

export async function resolveShare(inputText, options) {
  const extracted = extractFirstUrl(inputText);
  if (!extracted) throw new Error('找不到可解析的網址');
  const input = assertHttpUrl(extracted);

  if (isMediaHost(input.hostname)) {
    const isVideo = /\.mp4(?:$|\?)/i.test(input.pathname + input.search) || /video|stream/i.test(input.pathname);
    return {
      sourceUrl: input.toString(), noteId: null, title: null, description: null,
      author: null, cover: null,
      type: isVideo ? 'video' : 'images',
      videoUrl: isVideo ? input.toString() : null, alternatives: [], images: isVideo ? [] : [input.toString()],
      parser: 'direct-media-url', platform: 'xiaohongshu'
    };
  }

  const { html, finalUrl } = await expandAndFetchPage(input.toString(), options);
  const result = parsePublicPageHtml(html, finalUrl);
  if (!result.videoUrl && result.images.length === 0) {
    const error = new Error('公開頁面中沒有找到可下載媒體；可能需要登入、遇到驗證、頁面已改版，或作品不可公開存取');
    error.code = 'MEDIA_NOT_FOUND';
    throw error;
  }
  return { ...result, platform: 'xiaohongshu' };
}
```

Also copy all the internal helper functions from the current resolver.js.

- [ ] **Step 2: Update `src/resolver.js` to be a thin dispatcher**

```js
// src/resolver.js
// Lightweight router: detects platform from URL and delegates.

import { assertHttpUrl, assertPublicResolution, extractFirstUrl, formatBytes, isMediaHost, safeFilename as safeFn } from './utils.js';
import { resolveForPlatform, detectPlatform } from './platforms/index.js';
import { probeMedia as probe } from './platforms/xiaohongshu.js';

export { extractFirstUrl, assertHttpUrl, assertPublicResolution };

export async function resolvePublicShare(inputText, options) {
  return resolveForPlatform(inputText, options);
}

export async function probeMedia(url, timeoutMs = 10000) {
  return probe(url, timeoutMs);
}
```

Wait — `probeMedia` is defined in resolver.js and used by index.js. Let me move `probeMedia` into a shared utility or keep it in the XHS module and re-export.

Actually, `probeMedia` is CDN-agnostic — it just does a HEAD/range request and returns size/type. Let me keep it in resolver.js but make it use the registry.

```js
// src/resolver.js
import { isMediaHost, assertHttpUrl, assertPublicResolution } from './utils.js';
import { resolveForPlatform } from './platforms/index.js';

export { extractFirstUrl } from './utils.js';

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
```

- [ ] **Step 3: Update `src/utils.js` — remove XHS-only hosts, keep generic functions**

Remove `SHARE_HOSTS` set, `isShareHost`, `isMediaHost`. Keep:
- `extractFirstUrl`, `normalizeEscapedUrl`
- `assertHttpUrl`, `assertPublicResolution`
- `isPrivateIPv4`, `isPrivateIPv6`
- `unique`, `formatBytes`, `safeFilename`
- `secureDigest`, `codesEqual`, `getProvidedCode`, `parseRequestBody`

- [ ] **Step 4: Create `test/platforms/xiaohongshu.test.js`**

Port the existing tests from `test/resolver.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicPageHtml, resolveShare, hosts, mediaHosts, detect, isMediaHost } from '../src/platforms/xiaohongshu.js';
import { extractFirstUrl, normalizeEscapedUrl, safeFilename } from '../src/utils.js';

test('xiaohongshu: detect recognizes share hosts', () => {
  assert.ok(detect('https://xhslink.com/o/abc123'));
  assert.ok(detect('https://www.xiaohongshu.com/explore/test'));
  assert.ok(!detect('https://www.youtube.com/watch?v=test'));
});

test('xiaohongshu: isMediaHost checks CDN', () => {
  assert.ok(isMediaHost('sns-video-hw.xhscdn.com'));
  assert.ok(isMediaHost('xhscdn.com'));
  assert.ok(!isMediaHost('example.com'));
});

test('xiaohongshu: parsePublicPageHtml reads Open Graph video', () => {
  const html = `<!doctype html><html><head>
    <title>測試影片</title>
    <meta property="og:description" content="測試文案">
    <meta property="og:video" content="https://sns-video-hw.xhscdn.com/stream/test_258.mp4">
    <meta property="og:image" content="https://sns-webpic-qc.xhscdn.com/test.jpg">
  </head></html>`;
  const result = parsePublicPageHtml(html, 'https://www.xiaohongshu.com/explore/test');
  assert.equal(result.videoUrl, 'https://sns-video-hw.xhscdn.com/stream/test_258.mp4');
  assert.equal(result.title, '測試影片');
  assert.equal(result.description, '測試文案');
  assert.equal(result.type, 'video');
  assert.equal(result.cover, 'https://sns-webpic-qc.xhscdn.com/test.jpg');
});

test('xiaohongshu: parsePublicPageHtml extracts note data from initial state', () => {
  const state = {
    note: {
      noteDetailMap: {
        abc123: {
          note: {
            title: '結構化標題', desc: '結構化文案',
            user: { nickname: '測試作者' },
            video: { media: { stream: { h264: [{ masterUrl: 'https://sns-video-hw.xhscdn.com/stream/state_258.mp4' }] } } },
            imageList: [{ urlDefault: 'https://sns-webpic-qc.xhscdn.com/state-image.jpg' }]
          }
        }
      }
    }
  };
  const html = `<script>window.__INITIAL_STATE__=${JSON.stringify(state)}</script>`;
  const result = parsePublicPageHtml(html, 'https://www.xiaohongshu.com/explore/abc123');
  assert.equal(result.noteId, 'abc123');
  assert.equal(result.title, '結構化標題');
  assert.equal(result.description, '結構化文案');
  assert.equal(result.author, '測試作者');
  assert.equal(result.videoUrl, 'https://sns-video-hw.xhscdn.com/stream/state_258.mp4');
  assert.equal(result.parser, 'initial-state');
});

test('xiaohongshu: parsePublicPageHtml handles undefined in initial state', () => {
  const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"id1":{"note":{"title":"測試","desc":undefined,"imageList":[{"url":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/one.webp"}]}}}}}</script>`;
  const result = parsePublicPageHtml(html, 'https://www.xiaohongshu.com/explore/id1');
  assert.equal(result.title, '測試');
  assert.equal(result.images[0], 'https://sns-webpic-qc.xhscdn.com/one.webp');
  assert.equal(result.type, 'images');
});
```

- [ ] **Step 5: Create `test/platforms/registry.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, getPlatform, isShareHost, isMediaHost, resolveForPlatform } from '../src/platforms/index.js';

test('registry: detectPlatform returns correct platform', () => {
  assert.equal(detectPlatform('xhslink.com')?.name, 'xiaohongshu');
  assert.equal(detectPlatform('www.xiaohongshu.com')?.name, 'xiaohongshu');
  assert.equal(detectPlatform('example.com'), null);
});

test('registry: getPlatform returns platform by name', () => {
  assert.ok(getPlatform('xiaohongshu'));
  assert.equal(getPlatform('nonexistent'), null);
});

test('registry: isShareHost checks all platforms', () => {
  assert.ok(isShareHost('xhslink.com'));
  assert.ok(!isShareHost('example.com'));
});

test('registry: isMediaHost checks all platforms', () => {
  assert.ok(isMediaHost('xhscdn.com'));
  assert.ok(isMediaHost('sns-video-hw.xhscdn.com'));
  assert.ok(!isMediaHost('example.com'));
});
```

- [ ] **Step 6: Update imports across the project**

Files to update:
- `src/index.js`: Change `import { probeMedia, resolvePublicShare } from './resolver.js'` stays the same (resolver still exports them)
- `api/parse.js`: Same — `resolvePublicShare` still exported from resolver
- `test/resolver.test.js`: Delete this file, tests moved to `test/platforms/xiaohongshu.test.js`

- [ ] **Step 7: Run tests to verify Phase 1+2**

Run: `npm test`
Expected: Tests pass for XHS parsing

- [ ] **Step 8: Commit**

```bash
git add src/platforms/ src/resolver.js src/utils.js test/platforms/
git rm test/resolver.test.js
git commit -m "refactor: extract Xiaohongshu into platform module with registry"
```

---

## Phase 3: TikTok Platform Module

### Task 3.1: Implement TikTok module

**Files:**
- Create: `src/platforms/tiktok.js`
- Create: `test/platforms/tiktok.test.js`

- [ ] **Step 1: Write `src/platforms/tiktok.js`**

```js
// src/platforms/tiktok.js
import * as cheerio from 'cheerio';
import { assertHttpUrl, assertPublicResolution, extractFirstUrl } from '../utils.js';

export const name = 'tiktok';

export const hosts = new Set([
  'tiktok.com',
  'www.tiktok.com',
  'vm.tiktok.com',
  'm.tiktok.com'
]);

export const mediaHosts = new Set([
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'bytecdn.com',
  'tikcdn.net',
  'tiktok.com'  // for inline media
]);

export function isMediaHost(hostname) {
  const lower = hostname.toLowerCase();
  return lower.endsWith('.tiktokcdn.com') ||
         lower.endsWith('.tiktokcdn-us.com') ||
         lower.endsWith('.bytecdn.com') ||
         lower.endsWith('.tikcdn.net') ||
         mediaHosts.has(lower);
}

export function detect(input) {
  try {
    const parsed = new URL(input);
    return hosts.has(parsed.hostname.toLowerCase()) ||
           parsed.hostname.toLowerCase().endsWith('.tiktok.com');
  } catch { return false; }
}

const DESKTOP_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
};

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

function extractVideoId(url) {
  // vm.tiktok.com/xxxxx or tiktok.com/@user/video/123456
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'vm.tiktok.com' || parsed.hostname.endsWith('.vm.tiktok.com')) {
      return parsed.pathname.replace(/^\//, '').replace(/\/$/, '');
    }
    const match = parsed.pathname.match(/\/video\/(\d+)/);
    return match?.[1] || null;
  } catch { return null; }
}

function extractStrings(obj, depth = 0) {
  const result = [];
  if (depth > 16 || obj == null) return result;
  if (typeof obj === 'string') { result.push(obj); return result; }
  if (Array.isArray(obj)) { for (const item of obj) result.push(...extractStrings(item, depth + 1)); return result; }
  if (typeof obj === 'object') { for (const val of Object.values(obj)) result.push(...extractStrings(val, depth + 1)); }
  return result;
}

function parseSignedData(html) {
  // Try to extract window.__SIGNED_DATA or other TikTok state objects
  const patterns = [
    /window\.__SIGNED_DATA\s*=\s*({.+?});/s,
    /<script[^>]*id="__NEXT_DATA__"[^>]*>({.+?})<\/script>/s,
    /window\.__INITIAL_STATE__\s*=\s*({.+?});/s,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      try { return JSON.parse(match[1]); } catch { continue; }
    }
  }
  return null;
}

function findVideoUrl(data) {
  // Navigate TikTok's state structure to find video URLs
  const strings = extractStrings(data);
  const candidates = strings.filter((s) => {
    try {
      const u = new URL(s);
      return isMediaHost(u.hostname) && /\.mp4/i.test(s);
    } catch { return false; }
  });
  return candidates.sort((a, b) => b.length - a.length)[0] || null;
}

function findImages(data) {
  const strings = extractStrings(data);
  const candidates = strings.filter((s) => {
    try {
      const u = new URL(s);
      return isMediaHost(u.hostname) && !/\.mp4/i.test(s) && /image|cover|avatar/i.test(s);
    } catch { return false; }
  });
  return [...new Set(candidates)].slice(0, 30);
}

function extractOgMeta(html) {
  const ogVideo = html.match(/<meta[^>]*property="og:video"[^>]*content="([^"]+)"/i)?.[1] || null;
  const ogImage = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i)?.[1] || null;
  const ogTitle = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1] || null;
  const ogDesc = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i)?.[1] || null;
  return { ogVideo, ogImage, ogTitle, ogDesc };
}

async function expandAndFetchPage(rawUrl, options) {
  const input = assertHttpUrl(rawUrl);
  await assertPublicResolution(input.hostname);

  const response = await fetch(input, {
    redirect: 'follow',
    headers: DESKTOP_HEADERS,
    signal: AbortSignal.timeout(options.timeoutMs)
  });
  const finalUrl = assertHttpUrl(response.url);
  if (!response.ok) throw new Error(`TikTok 頁面回應錯誤：HTTP ${response.status}`);

  const contentType = response.headers.get('content-type') || '';
  if (!/text\/html|application\/json/i.test(contentType)) {
    throw new Error(`無法解析的頁面格式：${contentType || '未知'}`);
  }
  const html = await readTextWithLimit(response, options.maxHtmlBytes);
  return { html, finalUrl: finalUrl.toString() };
}

export async function resolveShare(inputText, options) {
  const extracted = extractFirstUrl(inputText);
  if (!extracted) throw new Error('找不到可解析的網址');
  const input = assertHttpUrl(extracted);

  // Direct media URL
  if (isMediaHost(input.hostname)) {
    const isVideo = /\.mp4(?:$|\?)/i.test(input.pathname + input.search);
    return {
      sourceUrl: input.toString(), noteId: extractVideoId(extracted),
      title: null, description: null, author: null, cover: null,
      type: isVideo ? 'video' : 'images',
      videoUrl: isVideo ? input.toString() : null, alternatives: [], images: isVideo ? [] : [input.toString()],
      parser: 'direct-media-url', platform: 'tiktok'
    };
  }

  const { html, finalUrl } = await expandAndFetchPage(input.toString(), options);
  const videoId = extractVideoId(finalUrl);
  const og = extractOgMeta(html);
  const state = parseSignedData(html);

  let videoUrl = og.ogVideo || null;
  let images = [];
  let title = og.ogTitle || null;
  let description = og.ogDesc || null;
  let author = null;

  if (state) {
    const stateVideoUrl = findVideoUrl(state);
    if (stateVideoUrl) videoUrl = stateVideoUrl;
    images = findImages(state);
  }

  if (!videoUrl && !images.length) {
    const error = new Error('TikTok 公開頁面中沒有找到可下載媒體');
    error.code = 'MEDIA_NOT_FOUND';
    throw error;
  }

  return {
    sourceUrl: finalUrl, noteId: videoId, title, description, author,
    cover: og.ogImage || images[0] || null,
    type: videoUrl ? 'video' : (images.length ? 'images' : null),
    videoUrl, alternatives: [], images: images.slice(0, 30),
    parser: state ? 'initial-state' : 'page-media-scan',
    platform: 'tiktok'
  };
}
```

- [ ] **Step 2: Write `test/platforms/tiktok.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, isMediaHost, hosts, mediaHosts, resolveShare } from '../src/platforms/tiktok.js';

test('tiktok: detect recognizes share hosts', () => {
  assert.ok(detect('https://vm.tiktok.com/abcdef/'));
  assert.ok(detect('https://www.tiktok.com/@user/video/123456'));
  assert.ok(detect('https://tiktok.com/@user/video/123456'));
  assert.ok(!detect('https://www.xiaohongshu.com/explore/test'));
});

test('tiktok: isMediaHost checks CDN', () => {
  assert.ok(isMediaHost('v16m.tiktokcdn.com'));
  assert.ok(isMediaHost('example.tiktokcdn-us.com'));
  assert.ok(isMediaHost('example.bytecdn.com'));
  assert.ok(!isMediaHost('xhscdn.com'));
});

test('tiktok: extractVideoId from vm.tiktok.com URL', () => {
  const id = extractVideoId('https://vm.tiktok.com/abcdef123/');
  assert.equal(id, 'abcdef123');
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/platforms/tiktok.js test/platforms/tiktok.test.js
git commit -m "feat: add TikTok platform module"
```

---

## Phase 4: Douyin Platform Module

### Task 4.1: Implement Douyin module

**Files:**
- Create: `src/platforms/douyin.js`
- Create: `test/platforms/douyin.test.js`

- [ ] **Step 1: Write `src/platforms/douyin.js`**

```js
// src/platforms/douyin.js
// Douyin (Chinese TikTok) — similar structure to TikTok but different hosts and page data.
import * as cheerio from 'cheerio';
import { assertHttpUrl, assertPublicResolution, extractFirstUrl } from '../utils.js';

export const name = 'douyin';

export const hosts = new Set([
  'douyin.com',
  'www.douyin.com',
  'v.douyin.com',
  'm.douyin.com',
  'iesdouyin.com'
]);

export const mediaHosts = new Set([
  'douyincdn.com',
  'pstatp.com',
  'toutiaoimg.com',
  'toutiaoimg.cn',
  'douyin.com',
  'douyinpic.com'
]);

export function isMediaHost(hostname) {
  const lower = hostname.toLowerCase();
  // Douyin uses many subdomains on these CDNs
  for (const host of mediaHosts) {
    if (lower === host || lower.endsWith('.' + host)) return true;
  }
  return false;
}

export function detect(input) {
  try {
    const parsed = new URL(input);
    return hosts.has(parsed.hostname.toLowerCase()) ||
           parsed.hostname.toLowerCase().endsWith('.douyin.com');
  } catch { return false; }
}

// ... (similar helper functions as TikTok, adapted for Douyin's page structure)

```

- [ ] **Step 2: Write `test/platforms/douyin.test.js`**

Similar structure to TikTok tests with Douyin-specific URL patterns.

- [ ] **Step 3: Run tests**

Run: `npm test`

- [ ] **Step 4: Commit**

```bash
git add src/platforms/douyin.js test/platforms/douyin.test.js
git commit -m "feat: add Douyin platform module"
```

---

## Phase 5: YouTube Platform Module

### Task 5.1: Implement YouTube module

**Files:**
- Create: `src/platforms/youtube.js`
- Create: `test/platforms/youtube.test.js`

- [ ] **Step 1: Write `src/platforms/youtube.js`**

```js
// src/platforms/youtube.js
// YouTube parser — extracts video info from public watch page.

import { assertHttpUrl, assertPublicResolution, extractFirstUrl } from '../utils.js';

export const name = 'youtube';

export const hosts = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'music.youtube.com'
]);

export const mediaHosts = new Set([
  'googlevideo.com',
  'ytimg.com',
  'youtube.com'
]);

export function isMediaHost(hostname) {
  const lower = hostname.toLowerCase();
  return lower.endsWith('.googlevideo.com') ||
         lower.endsWith('.ytimg.com') ||
         lower === 'ytimg.com';
}

export function detect(input) {
  try {
    const parsed = new URL(input);
    return hosts.has(parsed.hostname.toLowerCase()) ||
           parsed.hostname.toLowerCase().endsWith('.youtube.com');
  } catch { return false; }
}

function extractVideoId(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') return parsed.pathname.slice(1).split('/')[0];
    return parsed.searchParams.get('v');
  } catch { return null; }
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

export function parseWatchPage(html, finalUrl) {
  const videoId = extractVideoId(finalUrl);

  // Extract ytInitialPlayerResponse
  const playerMatch = html.match(/ytInitialPlayerResponse\s*=\s*({.+?})\s*;\s*<\/script>/s);
  let playerData = null;
  if (playerMatch) {
    try { playerData = JSON.parse(playerMatch[1]); } catch {}
  }

  // Extract ytInitialData (for metadata)
  const dataMatch = html.match(/ytInitialData\s*=\s*({.+?})\s*;\s*<\/script>/s);
  let initialData = null;
  if (dataMatch) {
    try { initialData = JSON.parse(dataMatch[1]); } catch {}
  }

  // Extract title, author, description
  const title = html.match(/<meta\s+name="title"\s+content="([^"]+)"/i)?.[1] ||
                html.match(/<title>([^<]+)<\/title>/)?.[1]?.replace(' - YouTube', '') || null;
  const author = html.match(/<link\s+itemprop="name"\s+content="([^"]+)"/i)?.[1] ||
                 html.match(/"author"\s*:\s*"[^"]*"\s*,\s*"channelId"/)?.[1] || null;
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1] || null;

  // Extract video URL from player response
  let videoUrl = null;
  let cover = null;
  if (playerData) {
    const formats = playerData?.streamingData?.formats || [];
    const adaptive = playerData?.streamingData?.adaptiveFormats || [];
    const allFormats = [...formats, ...adaptive]
      .filter((f) => f?.url)
      .sort((a, b) => (b.width || 0) - (a.width || 0));
    videoUrl = allFormats[0]?.url || null;
    cover = playerData?.videoDetails?.thumbnail?.thumbnails?.slice(-1)[0]?.url ||
            `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg` || null;
  } else {
    cover = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
  }

  if (!videoId && !videoUrl) {
    const error = new Error('YouTube 頁面中沒有找到可下載媒體');
    error.code = 'MEDIA_NOT_FOUND';
    throw error;
  }

  return {
    sourceUrl: finalUrl, noteId: videoId, title, description, author, cover,
    type: videoUrl ? 'video' : null,
    videoUrl, alternatives: [],
    images: cover ? [cover] : [],
    parser: playerData ? 'initial-state' : 'page-media-scan',
    platform: 'youtube'
  };
}

async function expandAndFetchPage(rawUrl, options) {
  const input = assertHttpUrl(rawUrl);
  await assertPublicResolution(input.hostname);

  const response = await fetch(input, {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36',
      accept: 'text/html,application/xhtml+xml,*/*',
      'accept-language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(options.timeoutMs)
  });
  if (!response.ok) throw new Error(`YouTube 頁面回應錯誤：HTTP ${response.status}`);
  const html = await readTextWithLimit(response, options.maxHtmlBytes);
  return { html, finalUrl: response.url };
}

export async function resolveShare(inputText, options) {
  const extracted = extractFirstUrl(inputText);
  if (!extracted) throw new Error('找不到可解析的網址');
  const input = assertHttpUrl(extracted);
  const videoId = extractVideoId(input.toString());
  if (!videoId) throw new Error('找不到 YouTube 影片 ID');

  const { html, finalUrl } = await expandAndFetchPage(input.toString(), options);
  return parseWatchPage(html, finalUrl);
}
```

- [ ] **Step 2: Write `test/platforms/youtube.test.js`**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, isMediaHost, extractVideoId, parseWatchPage } from '../src/platforms/youtube.js';

test('youtube: detect recognizes share hosts', () => {
  assert.ok(detect('https://www.youtube.com/watch?v=dQw4w9WgXcQ'));
  assert.ok(detect('https://youtu.be/dQw4w9WgXcQ'));
  assert.ok(detect('https://m.youtube.com/watch?v=dQw4w9WgXcQ'));
  assert.ok(!detect('https://www.xiaohongshu.com/explore/test'));
});

test('youtube: isMediaHost checks CDN', () => {
  assert.ok(isMediaHost('rr2---sn-abc.googlevideo.com'));
  assert.ok(isMediaHost('i.ytimg.com'));
  assert.ok(!isMediaHost('xhscdn.com'));
});

test('youtube: extractVideoId works', () => {
  assert.equal(extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(extractVideoId('https://www.youtube.com/watch?v='), null);
});

test('youtube: parseWatchPage extracts og metadata', () => {
  const html = `<!doctype html><html><head>
    <title>Test Video - YouTube</title>
    <meta name="title" content="Test Video">
    <meta name="description" content="A test video description">
    <link itemprop="name" content="TestChannel">
  </head></html>`;
  const result = parseWatchPage(html, 'https://www.youtube.com/watch?v=test123');
  assert.equal(result.title, 'Test Video');
  assert.equal(result.description, 'A test video description');
  assert.equal(result.type, 'video');
  assert.ok(result.videoUrl || result.cover);
});
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/platforms/youtube.js test/platforms/youtube.test.js
git commit -m "feat: add YouTube platform module"
```

---

## Phase 6: Update Media Proxy and Thumbnail Proxy

### Task 6.1: Update media proxy domain checking

**Files:**
- Modify: `src/index.js`

- [ ] **Step 1: Update `/api/media` and `/api/thumbnail` to use registry**

In `src/index.js`:

```js
// Replace: import { isMediaHost } from './utils.js';
import { isMediaHost } from './platforms/index.js';
```

Remove the now-unused `isMediaHost` import from `./utils.js` in index.js.

No other changes needed — the `/api/media` endpoint already uses `isMediaHost` and `assertPublicResolution`.

- [ ] **Step 2: Update `src/thumbnail.js`**

```js
// Replace: import { isMediaHost } from './utils.js';
import { isMediaHost } from './platforms/index.js';
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add src/index.js src/thumbnail.js
git commit -m "refactor: media/thumbnail proxies use registry for CDN validation"
```

---

## Phase 7: Frontend Updates

### Task 7.1: Update frontend to show platform info

**Files:**
- Modify: `public/index.html`
- Modify: `public/app.js`

- [ ] **Step 1: Update `public/index.html` hero text**

Change:
```html
<h1>貼上連結，<em>提取影片、圖片與文案</em></h1>
<p>支援小紅書公開分享文字、短連結，以及小紅書 CDN 媒體直連。無需微信小程序，電腦與手機瀏覽器皆可操作。</p>
```

To:
```html
<h1>貼上連結，<em>提取影片、圖片與文案</em></h1>
<p>支援小紅書、抖音、TikTok、YouTube 等公開分享連結與媒體直連。無需額外 App，電腦與手機瀏覽器皆可操作。</p>
```

- [ ] **Step 2: Update `public/app.js` — show platform name**

In `renderResult`, add platform display after `parserLabel`:

```js
// Add after setting parserLabel:
const platformLabel = $('platformLabel');
if (platformLabel) {
  platformLabel.textContent = data.platform || '';
  platformLabel.classList.toggle('is-hidden', !data.platform);
}
```

In `public/index.html`, add the platform label element:
```html
<span class="parser-label" id="platformLabel"></span>
```

- [ ] **Step 3: Verify nothing is broken**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add public/index.html public/app.js
git commit -m "feat: update frontend for multi-platform support"
```

---

## Phase 8: Integration and Deployment

### Task 8.1: Full integration test

- [ ] **Step 1: Start local server**

Run: `node src/local.js` (in background)
Expected: Server starts on port 8787

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Deploy to Vercel**

```bash
vercel --prod --yes
```

- [ ] **Step 4: Verify health endpoint**

Run: `curl https://xhs-html-downloader.vercel.app/api/health`
Expected: `{ "ok": true, ... }`

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "v0.5.0: multi-platform support (XHS, Douyin, TikTok, YouTube)"
git push
```

---

## Summary of Dependencies

```
Phase 1 (Registry) ─┐
Phase 2 (XHS refactor) ─┼──> Phase 6 (Media proxy) ──> Phase 7 (Frontend) ──> Phase 8 (Deploy)
Phase 3 (TikTok) ────┘
Phase 4 (Douyin) ────┘
Phase 5 (YouTube) ───┘
```

Phases 2-5 are independent and can be parallelized. Phase 6 requires Phase 1+2. Phase 7 requires Phase 6.
