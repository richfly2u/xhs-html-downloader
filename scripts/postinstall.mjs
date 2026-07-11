// npm postinstall — 確保 yt-dlp 二進位存在
import { existsSync } from 'node:fs';
import { mkdir, chmod, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const binDir = path.resolve(__dirname, '../node_modules/.bin');
const isWin = process.platform === 'win32';
const binName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
const binPath = path.join(binDir, binName);
const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binName}`;

async function main() {
  if (existsSync(binPath)) {
    console.log(`[postinstall] yt-dlp 已存在: ${binPath}`);
    return;
  }
  console.log(`[postinstall] 下載 yt-dlp → ${binPath}`);
  await mkdir(binDir, { recursive: true });
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const ws = createWriteStream(binPath);
  await pipeline(resp.body, ws);
  await chmod(binPath, 0o755);
  console.log('[postinstall] yt-dlp 下載完成');
}

main().catch((err) => {
  console.error('[postinstall] yt-dlp 下載失敗:', err.message);
});
