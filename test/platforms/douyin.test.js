import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detect,
  isMediaHost,
  isDirectMediaUrl,
  isVideoDirectUrl,
  extractVideoId,
  parsePublicPageHtml
} from '../../src/platforms/douyin.js';

test('douyin: detect recognizes share hosts', () => {
  assert.ok(detect('https://v.douyin.com/abcdef/'));
  assert.ok(detect('https://www.douyin.com/video/123456'));
  assert.ok(detect('https://douyin.com/video/123456'));
  assert.ok(!detect('https://www.youtube.com/watch?v=test'));
});

test('douyin: isMediaHost checks CDN', () => {
  assert.ok(isMediaHost('example.douyincdn.com'));
  assert.ok(isMediaHost('v26-web.douyinvod.com'));
  assert.ok(isMediaHost('example.pstatp.com'));
  assert.ok(isMediaHost('example.toutiaoimg.com'));
  assert.ok(isMediaHost('example.toutiaoimg.cn'));
  assert.ok(isMediaHost('p3-sign.douyinpic.com'));
  assert.equal(isMediaHost('www.douyin.com'), false);
  assert.ok(!isMediaHost('xhscdn.com'));
});

test('douyin: direct media detection does not classify share pages as media', () => {
  assert.equal(isDirectMediaUrl('https://www.douyin.com/video/123456789'), false);
  assert.equal(isVideoDirectUrl('https://www.douyin.com/video/123456789'), false);
  assert.equal(
    isDirectMediaUrl('https://www.douyin.com/aweme/v1/play/?video_id=abc&ratio=720p&line=0'),
    true
  );
  assert.equal(
    isVideoDirectUrl('https://www.douyin.com/aweme/v1/play/?video_id=abc&ratio=720p&line=0'),
    true
  );
});

test('douyin: extractVideoId from short link', () => {
  assert.equal(extractVideoId('https://v.douyin.com/abcdef/'), 'abcdef');
});

test('douyin: extractVideoId from full share URL', () => {
  assert.equal(extractVideoId('https://www.douyin.com/video/123456789'), '123456789');
  assert.equal(extractVideoId('https://www.iesdouyin.com/share/video/987654321/'), '987654321');
});

test('douyin: extractVideoId returns null for non-matching URL', () => {
  assert.equal(extractVideoId('https://www.xiaohongshu.com/explore/test'), null);
});

test('douyin: parsePublicPageHtml extracts media from encoded render data', () => {
  const playUrl = 'https://www.douyin.com/aweme/v1/play/?video_id=abc123&ratio=720p&line=0';
  const coverUrl = 'https://p3-sign.douyinpic.com/tos-cn-i-dy/cover.jpeg';
  const data = {
    aweme: {
      detail: {
        desc: 'Test Douyin video',
        author: { nickname: 'Creator' },
        video: {
          play_addr: { url_list: [playUrl] },
          cover: { url_list: [coverUrl] }
        }
      }
    }
  };
  const html = `<!doctype html><html><head>
    <meta property="og:title" content="Fallback title">
  </head><body>
    <script id="RENDER_DATA" type="application/json">${encodeURIComponent(JSON.stringify(data))}</script>
  </body></html>`;

  const result = parsePublicPageHtml(html, 'https://www.douyin.com/video/123456789');
  assert.equal(result.platform, undefined);
  assert.equal(result.noteId, '123456789');
  assert.equal(result.type, 'video');
  assert.equal(result.videoUrl, playUrl);
  assert.equal(result.cover, coverUrl);
  assert.equal(result.title, 'Test Douyin video');
  assert.equal(result.author, 'Creator');
  assert.equal(result.parser, 'initial-state');
});
