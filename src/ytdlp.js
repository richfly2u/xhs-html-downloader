/**
 * yt-dlp fallback for xiaohongshu URL parsing
 * Used when HTML scraping fails due to xsec_token changes
 * Downloads yt-dlp binary on first run (cached by Vercel)
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BIN_DIR = path.resolve(__dirname, '../bin');
const YTDLP_PATH = path.join(BIN_DIR, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

async function ensureBinary() {
  if (existsSync(YTDLP_PATH)) return;
  mkdirSync(BIN_DIR, { recursive: true });

  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const url = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_${platform}_${arch}`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download yt-dlp: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(YTDLP_PATH, buffer);
  execSync(`chmod +x "${YTDLP_PATH}"`);
}

export async function tryExtract(url) {
  try {
    await ensureBinary();

    const stdout = execSync(
      `"${YTDLP_PATH}" --dump-json --no-download --quiet --no-warnings "${url}"`,
      { timeout: 30000, encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
    ).trim();

    if (!stdout) return null;

    const info = JSON.parse(stdout);

    // Extract video URL
    let videoUrl = info.url || '';

    // Try to get the best format URL
    if (!videoUrl && info.requested_formats?.length) {
      const videoFmt = info.requested_formats.find(f => f.vcodec && f.vcodec !== 'none');
      videoUrl = videoFmt?.url || '';
    }

    if (!videoUrl && info.formats?.length) {
      const bestFormat = info.formats
        .filter(f => f.vcodec && f.vcodec !== 'none')
        .sort((a, b) => (b.height || 0) - (a.height || 0))[0];
      videoUrl = bestFormat?.url || '';
    }

    if (!videoUrl) return null;

    return {
      videoUrl,
      title: info.title || null,
      duration: info.duration || null,
      thumbnail: info.thumbnail || null,
    };
  } catch (err) {
    console.error('[ytdlp fallback error]', err.message);
    return null;
  }
}
