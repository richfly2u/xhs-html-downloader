import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BIN_DIRS = [
  path.resolve(__dirname, '../bin'),
  path.resolve(__dirname, '../node_modules/youtube-dl-exec/bin'),
  '/tmp'
];
const BIN_NAME = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';

export default async function handler(req, res) {
  const results = { platform: process.platform, cwd: process.cwd(), paths: {} };

  for (const dir of BIN_DIRS) {
    const p = path.join(dir, BIN_NAME);
    results.paths[p] = { exists: existsSync(p) };
  }

  // Try running yt-dlp --version
  results.version = await new Promise((resolve) => {
    execFile('yt-dlp', ['--version'], { timeout: 10000 }, (err, stdout) => {
      if (err) resolve({ error: err.message });
      else resolve(stdout.trim());
    });
  });

  // Check bin/yt-dlp in project root
  const binPath = path.resolve(__dirname, '../bin', BIN_NAME);
  if (existsSync(binPath)) {
    results.binVersion = await new Promise((resolve) => {
      execFile(binPath, ['--version'], { timeout: 10000 }, (err, stdout) => {
        if (err) resolve({ error: err.message });
        else resolve(stdout.trim());
      });
    });
  }

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json(results);
}
