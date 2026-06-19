import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPlatform,
  getPlatform,
  isShareHost,
  isMediaHost
} from '../../src/platforms/index.js';

test('detectPlatform returns xiaohongshu for xhslink.com', () => {
  const platform = detectPlatform('xhslink.com');
  assert.ok(platform);
  assert.equal(platform.name, 'xiaohongshu');
});

test('detectPlatform returns xiaohongshu for xiaohongshu.com', () => {
  const platform = detectPlatform('www.xiaohongshu.com');
  assert.ok(platform);
  assert.equal(platform.name, 'xiaohongshu');
});

test('detectPlatform returns xiaohongshu for xhscdn.com subdomains', () => {
  const platform = detectPlatform('sns-video-hw.xhscdn.com');
  assert.ok(platform);
  assert.equal(platform.name, 'xiaohongshu');
});

test('detectPlatform returns null for unknown hosts', () => {
  assert.equal(detectPlatform('www.google.com'), null);
  assert.equal(detectPlatform(''), null);
});

test('getPlatform returns module by name', () => {
  const platform = getPlatform('xiaohongshu');
  assert.ok(platform);
  assert.equal(platform.name, 'xiaohongshu');
});

test('getPlatform returns null for unknown name', () => {
  assert.equal(getPlatform('nonexistent'), null);
});

test('isShareHost checks against all registered platforms', () => {
  assert.equal(isShareHost('xhslink.com'), true);
  assert.equal(isShareHost('www.xiaohongshu.com'), true);
  assert.equal(isShareHost('m.xiaohongshu.com'), true);
  assert.equal(isShareHost('www.google.com'), false);
  assert.equal(isShareHost(''), false);
});

test('isMediaHost checks against all registered platforms', () => {
  assert.equal(isMediaHost('xhscdn.com'), true);
  assert.equal(isMediaHost('sns-video-hw.xhscdn.com'), true);
  assert.equal(isMediaHost('sns-webpic-qc.xhscdn.com'), true);
  assert.equal(isMediaHost('example.com'), false);
  assert.equal(isMediaHost(''), false);
});
