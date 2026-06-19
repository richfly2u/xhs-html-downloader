// 在 Vercel build 時預先下載 yt-dlp 二進位
import { createWriteStream } from 'node:fs';
import { chmod, mkdir } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetDir = path.resolve(__dirname, '../bin');
const isWin = process.platform === 'win32';
const binName = isWin ? 'yt-dlp.exe' : 'yt-dlp';
const targetPath = path.join(targetDir, binName);
const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${binName}`;

async function download() {
  await mkdir(targetDir, { recursive: true });
  console.log(`[download-ytdlp] 下載 ${url} → ${targetPath}`);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  await pipeline(resp.body, createWriteStream(targetPath));
  await chmod(targetPath, 0o755);
  console.log('[download-ytdlp] 完成');
}

download().catch((err) => {
  console.error('[download-ytdlp] 失敗:', err.message);
  process.exit(1);
});
