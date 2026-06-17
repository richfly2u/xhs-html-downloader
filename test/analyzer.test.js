import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCopy } from '../src/analyzer.js';

test('built-in caption analysis works without an AI key', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const result = await analyzeCopy({
      title: '三分鐘完成蔬食便當',
      description: '今天分享簡單又好吃的蔬食便當。先準備豆腐、青菜與菇類，最後記得收藏起來！ #蔬食 #便當'
    });
    assert.equal(result.mode, 'local-caption');
    assert.ok(result.summary);
    assert.ok(result.optimizedCopy.includes('蔬食'));
    assert.ok(result.keywords.length >= 1);
  } finally {
    if (oldKey) process.env.OPENAI_API_KEY = oldKey;
  }
});

test('direct media without caption explains that AI key is needed', async () => {
  const oldKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(() => analyzeCopy({ videoUrl: 'https://sns-video-hw.xhscdn.com/a.mp4' }), /OPENAI_API_KEY/);
  } finally {
    if (oldKey) process.env.OPENAI_API_KEY = oldKey;
  }
});
