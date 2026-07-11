import test from 'node:test';
import assert from 'node:assert/strict';
import { findYtDlp } from '../../src/platforms/youtube.js';

test('youtube: YTDLP_PATH 環境設定優先於 node_modules 執行檔', () => {
  const previous = process.env.YTDLP_PATH;
  process.env.YTDLP_PATH = '/custom/yt-dlp';
  try {
    assert.equal(findYtDlp({ exists: (candidate) => candidate === '/custom/yt-dlp' }), '/custom/yt-dlp');
  } finally {
    if (previous === undefined) delete process.env.YTDLP_PATH;
    else process.env.YTDLP_PATH = previous;
  }
});
