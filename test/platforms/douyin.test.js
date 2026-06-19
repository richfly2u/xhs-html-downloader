import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, isMediaHost, extractVideoId } from '../../src/platforms/douyin.js';

test('douyin: detect recognizes share hosts', () => {
  assert.ok(detect('https://v.douyin.com/abcdef/'));
  assert.ok(detect('https://www.douyin.com/video/123456'));
  assert.ok(detect('https://douyin.com/video/123456'));
  assert.ok(!detect('https://www.youtube.com/watch?v=test'));
});

test('douyin: isMediaHost checks CDN', () => {
  assert.ok(isMediaHost('example.douyincdn.com'));
  assert.ok(isMediaHost('example.pstatp.com'));
  assert.ok(isMediaHost('example.toutiaoimg.com'));
  assert.ok(isMediaHost('example.toutiaoimg.cn'));
  assert.ok(!isMediaHost('xhscdn.com'));
});

test('douyin: extractVideoId from short link', () => {
  assert.equal(extractVideoId('https://v.douyin.com/abcdef/'), 'abcdef');
});

test('douyin: extractVideoId returns null for non-matching URL', () => {
  assert.equal(extractVideoId('https://www.xiaohongshu.com/explore/test'), null);
});
