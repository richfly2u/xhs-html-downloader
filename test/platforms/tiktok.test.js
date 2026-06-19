import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, isMediaHost, extractVideoId } from '../../src/platforms/tiktok.js';

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
  assert.equal(extractVideoId('https://vm.tiktok.com/abcdef123/'), 'abcdef123');
});

test('tiktok: extractVideoId from full URL', () => {
  assert.equal(extractVideoId('https://www.tiktok.com/@user/video/123456789'), '123456789');
});

test('tiktok: extractVideoId returns null for non-matching URL', () => {
  assert.equal(extractVideoId('https://www.xiaohongshu.com/explore/test'), null);
});
