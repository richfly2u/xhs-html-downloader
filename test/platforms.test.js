import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPlatform, resolveForPlatform } from '../src/platforms/index.js';
import { resolveShare as resolveYouTubeShare } from '../src/platforms/youtube.js';

test('detectPlatform recognizes supported share hosts', () => {
  const cases = [
    ['https://www.xiaohongshu.com/explore/abc123', 'xiaohongshu'],
    ['https://xhslink.com/o/abc123', 'xiaohongshu'],
    ['https://youtu.be/dQw4w9WgXcQ', 'youtube'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube'],
    ['https://v.douyin.com/abc123/', 'douyin'],
    ['https://www.douyin.com/video/123', 'douyin'],
    ['https://www.tiktok.com/@openai/video/123', 'tiktok'],
    ['https://vm.tiktok.com/ZMabc/', 'tiktok'],
    ['https://www.facebook.com/reel/123', 'facebook'],
    ['https://fb.watch/abc123/', 'facebook']
  ];

  for (const [url, platform] of cases) {
    assert.equal(detectPlatform(url)?.id, platform, url);
  }
});

test('resolveForPlatform rejects unsupported and private URLs before fetching', async () => {
  await assert.rejects(
    () => resolveForPlatform('http://127.0.0.1:8787/private', { timeoutMs: 100, maxHtmlBytes: 1024 }),
    /不支援|HTTP|HTTPS|內部/
  );
});

test('YouTube resolver maps VPS yt-dlp response to the shared result shape', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://ytapi.example.test/api/yt-dlp');
    assert.equal(init.method, 'POST');
    assert.match(String(init.body), /youtu\.be/);
    return new Response(JSON.stringify({
      success: true,
      title: '測試影片',
      thumbnail: 'https://i.ytimg.com/vi/abc/hqdefault.jpg',
      best_url: 'https://rr1---sn.example.googlevideo.com/videoplayback?id=abc',
      duration: 42,
      video_formats: [
        { label: '1080p', height: 1080, fps: 30, ext: 'mp4', vcodec: 'avc1', size_mb: 12.3, url: 'https://video.example/1080' }
      ],
      audio_formats: [
        { label: '128k', abr: 128, ext: 'm4a', acodec: 'mp4a', size_mb: 2.5, url: 'https://audio.example/128' }
      ]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const result = await resolveYouTubeShare('https://youtu.be/abc', {
    timeoutMs: 1000,
    skipDnsCheck: true,
    youtubeProxyUrl: 'https://ytapi.example.test/api/yt-dlp'
  });

  assert.equal(result.platform, 'youtube');
  assert.equal(result.title, '測試影片');
  assert.equal(result.video.directUrl, 'https://rr1---sn.example.googlevideo.com/videoplayback?id=abc');
  assert.equal(result.videoFormats[0].height, 1080);
  assert.equal(result.audioFormats[0].abr, 128);
});
