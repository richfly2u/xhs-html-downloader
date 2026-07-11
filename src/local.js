import 'dotenv/config';
import { existsSync } from 'node:fs';
import { mkdir, chmod } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import app from './index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binName = 'yt-dlp' + (process.platform === 'win32' ? '.exe' : '');
const binPath = path.resolve(__dirname, '../node_modules/.bin', binName);

// 啟動時確保 yt-dlp 二進位存在
async function ensureYtDlp() {
  // 先確認 PATH 中是否已有（nixpacks 安裝）
  try {
    const { execFileSync } = await import('node:child_process');
    execFileSync('yt-dlp', ['--version'], { stdio: 'ignore' });
    console.log('[startup] yt-dlp ' + execFileSync('yt-dlp',['--version']).toString().trim() + '（PATH）');
    return;
  } catch { /* PATH 無 yt-dlp，繼續下載 */ }
  if (existsSync(binPath)) return;
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binName}`;
  console.log('[startup] 下載 yt-dlp...');
  await mkdir(path.dirname(binPath), { recursive: true });
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  await pipeline(resp.body, createWriteStream(binPath));
  await chmod(binPath, 0o755);
  console.log('[startup] yt-dlp 下載完成');
}

const port = Number(process.env.PORT || 8787);

ensureYtDlp().catch((err) => console.error('[startup] yt-dlp 下載失敗:', err.message));

app.listen(port, () => {
  console.log(`XHS HTML downloader: http://127.0.0.1:${port}`);
});
