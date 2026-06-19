import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, isMediaHost, extractVideoId } from '../../src/platforms/facebook.js';

test('facebook: detect recognizes share hosts', () => {
  assert.ok(detect('https://www.facebook.com/watch?v=123456'));
  assert.ok(detect('https://fb.watch/abcd123/'));
  assert.ok(detect('https://facebook.com/username/videos/123456'));
  assert.ok(!detect('https://www.xiaohongshu.com/explore/test'));
});

test('facebook: isMediaHost checks CDN', () => {
  assert.ok(isMediaHost('video.fbcdn.net'));
  assert.ok(isMediaHost('scontent.fbcdn.net'));
  assert.ok(isMediaHost('fbcdn.net'));
  assert.ok(!isMediaHost('xhscdn.com'));
});

test('facebook: extractVideoId from fb.watch', () => {
  assert.equal(extractVideoId('https://fb.watch/abcd123/'), 'abcd123');
});

test('facebook: extractVideoId from full URL', () => {
  assert.equal(extractVideoId('https://www.facebook.com/watch?v=123456789'), '123456789');
});

test('facebook: extractVideoId returns null for non-matching URL', () => {
  assert.equal(extractVideoId('https://www.xiaohongshu.com/explore/test'), null);
});
