import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeCopy } from '../src/analyzer.js';

function saveEnv() {
  return {
    groq: process.env.GROQ_API_KEY,
    openai: process.env.OPENAI_API_KEY
  };
}

function restoreEnv(old) {
  if (old.groq === undefined) delete process.env.GROQ_API_KEY;
  else process.env.GROQ_API_KEY = old.groq;
  if (old.openai === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = old.openai;
}

test('built-in caption analysis works without an AI key', async () => {
  const old = saveEnv();
  delete process.env.GROQ_API_KEY;
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
    restoreEnv(old);
  }
});

test('direct media without caption explains that Groq key is needed', async () => {
  const old = saveEnv();
  delete process.env.GROQ_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    await assert.rejects(
      () => analyzeCopy({ videoUrl: 'https://sns-video-hw.xhscdn.com/a.mp4' }),
      /GROQ_API_KEY/
    );
  } finally {
    restoreEnv(old);
  }
});

test('Groq key enables AI optimized copy', async () => {
  const old = saveEnv();
  const oldFetch = global.fetch;
  process.env.GROQ_API_KEY = 'test-key';
  delete process.env.OPENAI_API_KEY;
  global.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'llama-3.3-70b-versatile');
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            summary: '介紹快速完成蔬食便當的方法',
            hook: '三分鐘就能完成一份好吃蔬食便當',
            audience: '忙碌又想吃得健康的人',
            structure: '痛點、步驟、成果、行動呼籲',
            strengths: ['主題明確'],
            improvements: ['增加成果描述'],
            keywords: ['蔬食', '便當'],
            optimizedCopy: '忙碌也能吃得健康！今天用三分鐘帶你完成一份簡單又好吃的蔬食便當。'
          })
        }
      }]
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await analyzeCopy({
      title: '三分鐘蔬食便當',
      description: '分享快速完成蔬食便當的方法。'
    });
    assert.equal(result.mode, 'ai-caption');
    assert.equal(result.provider, 'groq');
    assert.equal(result.model, 'llama-3.3-70b-versatile');
    assert.match(result.optimizedCopy, /忙碌也能吃得健康/);
  } finally {
    global.fetch = oldFetch;
    restoreEnv(old);
  }
});
