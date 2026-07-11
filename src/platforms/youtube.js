import { assertAllowedHost, assertHttpUrl, assertPublicResolution, extractFirstUrl, formatBytes } from '../utils.js';

const DEFAULT_YOUTUBE_PROXY_URL = process.env.YOUTUBE_PROXY_URL || process.env.YT_DLP_API_URL || 'http://108.61.163.87:8799/api/yt-dlp';

export const id = 'youtube';
export const label = 'YouTube';
export const shareHosts = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtu.be'
];

function normalizeFormatSize(format) {
  if (format.size) return format.size;
  if (Number.isFinite(format.size_mb)) return `${format.size_mb} MB`;
  if (Number.isFinite(format.filesize)) return formatBytes(format.filesize);
  return null;
}

function mapVideoFormat(format) {
  return {
    hasVideo: true,
    label: format.label || (format.height ? `${format.height}p` : format.format || '影片'),
    height: Number(format.height) || 0,
    fps: format.fps || '',
    ext: format.ext || 'mp4',
    vcodec: format.vcodec || '',
    acodec: format.acodec || '',
    size: normalizeFormatSize(format),
    url: format.url || '',
    formatId: format.format_id || format.itag || ''
  };
}

function mapAudioFormat(format) {
  return {
    hasAudio: true,
    label: format.label || (format.abr ? `${format.abr}k` : format.format || '音訊'),
    abr: Number(format.abr) || 0,
    ext: format.ext || 'm4a',
    acodec: format.acodec || '',
    size: normalizeFormatSize(format),
    url: format.url || '',
    formatId: format.format_id || format.itag || ''
  };
}

function getJsonBody(body) {
  if (!body || typeof body !== 'object') return {};
  return body;
}

export function isYouTubeUrl(input = '') {
  const extracted = extractFirstUrl(input) || input;
  try {
    const url = assertHttpUrl(extracted);
    return shareHosts.some((host) => url.hostname.toLowerCase() === host);
  } catch {
    return false;
  }
}

export async function resolveShare(input, options = {}) {
  const extracted = extractFirstUrl(input) || input;
  const source = assertAllowedHost(assertHttpUrl(extracted), shareHosts, label);
  if (!options.skipDnsCheck) await assertPublicResolution(source.hostname);

  const proxyUrl = assertHttpUrl(options.youtubeProxyUrl || DEFAULT_YOUTUBE_PROXY_URL);
  if (!['http:', 'https:'].includes(proxyUrl.protocol)) {
    throw new Error('YouTube 代理服務網址必須是 HTTP 或 HTTPS');
  }

  const response = await fetch(proxyUrl.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: source.toString() }),
    signal: AbortSignal.timeout(options.timeoutMs || 30_000)
  });
  const payload = getJsonBody(await response.json().catch(() => ({})));

  if (!response.ok || payload.success === false) {
    const error = new Error(payload.error || `YouTube 解析失敗：HTTP ${response.status}`);
    error.code = 'YOUTUBE_PROXY_FAILED';
    throw error;
  }

  const videoFormats = (payload.video_formats || payload.videoFormats || []).map(mapVideoFormat);
  const audioFormats = (payload.audio_formats || payload.audioFormats || []).map(mapAudioFormat);
  const bestUrl =
    payload.best_url ||
    payload.bestUrl ||
    videoFormats.find((format) => format.url)?.url ||
    audioFormats.find((format) => format.url)?.url ||
    '';
  const title = payload.title || 'YouTube 影片';

  return {
    platform: id,
    platformLabel: label,
    sourceUrl: source.toString(),
    noteId: payload.id || payload.video_id || null,
    title,
    description: payload.description || '',
    author: payload.uploader || payload.channel || '',
    cover: payload.thumbnail || '',
    type: 'video',
    videoUrl: bestUrl || null,
    alternatives: videoFormats.map((format) => format.url).filter(Boolean).slice(0, 8),
    images: [],
    parser: 'yt-dlp-vps',
    duration: payload.duration || 0,
    video: bestUrl ? {
      kind: 'video',
      directUrl: bestUrl,
      previewUrl: bestUrl,
      downloadUrl: bestUrl,
      bytes: null,
      size: null,
      contentType: 'video/mp4'
    } : null,
    format: 'MP4',
    videoFormats,
    audioFormats,
    formats: [...videoFormats, ...audioFormats]
  };
}
