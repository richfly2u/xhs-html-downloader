# Multi-Platform Support Design

## Overview

Extend the current Xiaohongshu-only downloader to support multiple platforms:
Xiaohongshu (existing), Douyin (Chinese TikTok), TikTok (international), and YouTube.

Each platform supports: link resolution, media download, thumbnail proxy, and AI analysis.
AI analysis (analyzer.js) is already platform-agnostic and will not be modified.

## Architecture

### Current vs Proposed

```
Current:
  resolver.js (XHS hardcoded)
  utils.js    (XHS hosts hardcoded)
  thumbnail.js (XHS CDN hardcoded)
  index.js    (/api/media XHS CDN hardcoded)

Proposed:
  src/platforms/
    xiaohongshu.js    ← XHS logic from resolver.js
    douyin.js          ← new
    tiktok.js          ← new
    youtube.js         ← new
    index.js           ← platform registry + detect(url)

  src/resolver.js      ← lightweight router: detect → dispatch
  src/utils.js         ← generic utilities only (no platform hosts)
  src/thumbnail.js     ← platform-aware: checks allowed CDNs from registry
  src/index.js         ← /api/media: checks allowed CDNs from registry
```

### Platform Module Interface

```typescript
interface Platform {
  name: string;               // e.g. 'xiaohongshu', 'douyin', 'tiktok', 'youtube'
  hosts: Set<string>;         // share URL hostnames
  mediaHosts: Set<string>;    // media CDN hostnames

  // Return true if this platform handles the given URL
  detect(input: string): boolean;

  // Resolve a share URL/text → media metadata
  resolveShare(inputText: string, options: {
    timeoutMs: number;
    maxHtmlBytes: number;
  }): Promise<ResolutionResult>;

  // Parse HTML page content → media metadata (for testing/fallback)
  parsePage?(html: string, finalUrl: string): ResolutionResult;

  // Optional: platform-specific thumbnail fetching
  fetchThumbnail?(rawUrl: string, options: {
    timeoutMs: number;
    maxBytes: number;
  }): Promise<{ buffer: Buffer; contentType: string; etag?: string; lastModified?: string }>;
}
```

```typescript
interface ResolutionResult {
  sourceUrl: string | null;
  noteId?: string | null;        // platform-internal ID
  title: string | null;
  description: string | null;
  author: string | null;
  cover: string | null;
  type: 'video' | 'images' | null;
  videoUrl: string | null;
  alternatives: string[];
  images: string[];
  parser: string;
  platform: string;              // platform name
}
```

### Platform Registry (src/platforms/index.js)

```js
// Central registry of all platforms.
// Used by resolver, thumbnail, and media proxy to validate hosts.

const platforms = [
  require('./xiaohongshu.js'),
  require('./douyin.js'),
  require('./tiktok.js'),
  require('./youtube.js'),
];

export function detectPlatform(input) { ... }
export function getPlatform(name) { ... }
export function getAllShareHosts() { ... }     // union of all hosts
export function getAllMediaHosts() { ... }     // union of all mediaHosts
export function isShareHost(hostname) { ... }
export function isMediaHost(hostname) { ... }
```

## Platform Details

### Xiaohongshu (移植現有邏輯)

- Extracted from current `src/resolver.js` into `src/platforms/xiaohongshu.js`
- Same parsing logic: `window.__INITIAL_STATE__`, meta tags, Cheerio fallback
- Same hosts: `xhslink.com`, `xiaohongshu.com`, `m.xiaohongshu.com`
- Same media hosts: `xhscdn.com`, `*.xhscdn.com`
- Covers: share links → redirect → public page → media extraction

### Douyin (抖音中國版)

- Share URL patterns: `v.douyin.com/*`, `douyin.com/video/*`
- Parsing approach:
  1. Follow redirect from short link
  2. Extract `window._SSR_HYDRATED_DATA` or `window.__INITIAL_STATE__` from page
  3. Fallback: extract from JSON-LD or meta tags
- Media hosts: `*.douyincdn.com`, `*.pstatp.com`, `*.toutiaoimg.com`
- Key challenge: anti-scraping measures (User-Agent, cookies)
- No login required for public videos

### TikTok (國際版)

- Share URL patterns: `vm.tiktok.com/*`, `tiktok.com/@user/video/*`
- Parsing approach:
  1. Follow redirect from short link (`vm.tiktok.com`)
  2. Extract video data from `window.__SIGNED_DATA` or `#video` meta
  3. Fallback: server-side HTML parsing with Cheerio
- Media hosts: `*.tiktokcdn.com`, `*.bytecdn.com`
- Note: TikTok page structure changes frequently — fallback strategy important

### YouTube

- URL patterns: `youtube.com/watch?v=`, `youtu.be/*`, `m.youtube.com/*`
- Parsing approach:
  1. Extract video ID from URL
  2. Fetch page HTML and extract `ytInitialPlayerResponse` or `ytInitialData`
  3. Extract video URL from player response (adaptive formats)
  4. Thumbnail via known pattern: `https://img.youtube.com/vi/{id}/maxresdefault.jpg`
- Media hosts: `*.googlevideo.com`, `*.ytimg.com` (thumbnails)
- Note: youtube-dl approach not needed — we only extract the publicly available stream URL from page data

## Media Proxy Changes

### src/index.js (/api/media)

- Replace direct `isMediaHost(url.hostname)` with registry lookup
- Thumbnail fetch URL domain check also uses registry
- Redirect check uses same registry
- All other security (DNS, private IP check) remains unchanged

### src/thumbnail.js

- Replace `xhscdn.com` only check with `isMediaHost()` from registry

## Frontend Changes

### public/index.html

- Change static text "小紅書媒體解析器" → dynamic platform detection display
- Update description text to mention supported platforms

### public/app.js

- `parserName()`: already maps parser type to display name — extend with platform names
- `renderResult()`: display `data.platform` alongside existing metadata
- History display: no changes needed (already platform-agnostic)

## API Changes

### POST /api/parse

- Response now includes `platform` field (already in `ResolutionResult`)
- Backward compatible — existing clients ignore unknown fields

### GET /api/thumbnail

- Already generic URL-based — just need to update domain validation to use registry

### GET /api/media

- Already generic proxy — just domain validation change

## Error Handling

- Platform not recognized: `{ success: false, code: 'UNSUPPORTED_PLATFORM', error: '不支援此平台' }`
- Platform parsing failure: `{ success: false, code: 'PARSE_FAILED', error: '...' }`
- Each platform module handles its own parsing errors internally

## Testing Strategy

### Unit Tests

- Each platform module: `test/platforms/xiaohongshu.test.js`, `douyin.test.js`, etc.
- Test URL detection, share host validation, page parsing with mock HTML
- Test registry index (`platforms/index.js`): detect, getPlatform, host lookups

### Existing Tests

- `test/resolver.test.js`: update imports to point to `platforms/xiaohongshu`
- `test/analyzer.test.js`: no changes needed (platform-agnostic)

### Integration

- Test media proxy with multiple CDN hosts
- Test thumbnail proxy with non-XHS hosts
- Platform routing via resolver

## Implementation Order

1. **Phase 1 — Refactor**: Extract XHS into `platforms/xiaohongshu.js`, create `platforms/index.js` registry, update imports
2. **Phase 2 — TikTok**: Implement TikTok platform module (most similar to XHS)
3. **Phase 3 — Douyin**: Implement Douyin module (similar to TikTok, different CDNs)
4. **Phase 4 — YouTube**: Implement YouTube module (different page structure, known patterns)
5. **Phase 5 — Media proxy**: Update `/api/media` and `/api/thumbnail` to use registry
6. **Phase 6 — Frontend**: Update text labels and platform display
7. **Phase 7 — Testing**: Write tests for all new modules

## Security Considerations

- Each platform module MUST validate media URLs are from permitted CDNs
- `assertPublicResolution` (DNS private IP check) applies to ALL platforms
- Media proxy redirect check applies to ALL platforms
- Thumbnail proxy only allows registered media hosts
- No platform should bypass the shared security layer
