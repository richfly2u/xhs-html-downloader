import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, isMediaHost, extractVideoId, parseWatchPage } from '../../src/platforms/youtube.js';

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
  assert.ok(result.cover);
  assert.equal(result.platform, 'youtube');
});
