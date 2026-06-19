import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePublicPageHtml } from '../src/resolver.js';
import { extractFirstUrl, normalizeEscapedUrl, safeFilename } from '../src/utils.js';

test('extractFirstUrl extracts a URL from share text', () => {
  assert.equal(
    extractFirstUrl('分享一下 https://xhslink.com/o/abc123 ，很好看'),
    'https://xhslink.com/o/abc123'
  );
});

test('normalizeEscapedUrl normalizes JSON escaped URL', () => {
  assert.equal(
    normalizeEscapedUrl('https:\\/\\/sns-video-hw.xhscdn.com\\/stream\\/a.mp4'),
    'https://sns-video-hw.xhscdn.com/stream/a.mp4'
  );
});

test('parsePublicPageHtml reads Open Graph video', () => {
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

test('parsePublicPageHtml extracts note data from initial state', () => {
  const state = {
    note: {
      noteDetailMap: {
        abc123: {
          note: {
            title: '結構化標題',
            desc: '結構化文案',
            user: { nickname: '測試作者' },
            video: {
              media: {
                stream: {
                  h264: [{ masterUrl: 'https://sns-video-hw.xhscdn.com/stream/state_258.mp4' }]
                }
              }
            },
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

test('parsePublicPageHtml handles undefined in initial state', () => {
  const html = `<script>window.__INITIAL_STATE__={"note":{"noteDetailMap":{"id1":{"note":{"title":"測試","desc":undefined,"imageList":[{"url":"https:\\/\\/sns-webpic-qc.xhscdn.com\\/one.webp"}]}}}}}</script>`;
  const result = parsePublicPageHtml(html, 'https://www.xiaohongshu.com/explore/id1');
  assert.equal(result.title, '測試');
  assert.equal(result.images[0], 'https://sns-webpic-qc.xhscdn.com/one.webp');
  assert.equal(result.type, 'images');
});

test('safeFilename removes illegal filename characters', () => {
  assert.equal(safeFilename('測試:影片/名稱?'), '測試 影片 名稱');
});
