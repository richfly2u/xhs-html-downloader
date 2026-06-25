/**
 * YouTube 媒體解析端點
 * 使用 @distube/ytdl-core 解析 YouTube 影片資訊及格式清單
 * POST /api/youtube
 * Body: { text: "https://youtube.com/watch?v=..." }
 */

import ytdl from '@distube/ytdl-core';

async function getYouTubeInfo(url) {
  let info;
  let lastError;
  const clientTypes = ['ANDROID', 'IOS', 'WEB'];

  for (const client of clientTypes) {
    try {
      info = await ytdl.getInfo(url, {
        clients: [client],
        requestOptions: {
          headers: {
            'Accept-Language': 'zh-TW',
            ...(process.env.YOUTUBE_COOKIES
              ? { Cookie: process.env.YOUTUBE_COOKIES }
              : {}),
          },
        },
      });
      break;
    } catch (e) {
      lastError = e;
      if (!e.message?.includes('Sign in') && !e.message?.includes('bot')) {
        break;
      }
    }
  }

  if (!info) throw lastError || new Error('無法解析 YouTube 影片');
  return info;
}

function formatDuration(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!bytes) return null;
  const mb = Number(bytes) / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(Number(bytes) / 1024).toFixed(1)} KB`;
}

const qualityLabels = {
  2160: '4K',
  1440: '2K',
  1080: '1080p',
  720: '720p',
  480: '480p',
  360: '360p',
  240: '240p',
  144: '144p',
};

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ success: false, error: '只接受 POST 請求' });
  }

  try {
    const body = req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(req.body?.toString?.() || '{}');

    const input = (body.text || body.url || '').trim();
    if (!input) {
      return res.status(400).json({ success: false, error: '請提供 YouTube 連結' });
    }

    const info = await getYouTubeInfo(input);
    const details = info.videoDetails;
    const { formats } = info;
    const videoId = details.videoId;

    // Build video format options (sorted by quality desc)
    const videoFormats = [];
    const seenHeights = new Set();

    const combinedFormats = formats.filter(f => f.hasVideo && f.hasAudio && f.container === 'mp4');
    const videoOnlyFormats = formats.filter(f => f.hasVideo && !f.hasAudio);

    for (const f of [...combinedFormats, ...videoOnlyFormats]
      .sort((a, b) => (Number(b.contentLength) || 0) - (Number(a.contentLength) || 0))) {
      const height = f.height || 0;
      if (seenHeights.has(height)) continue;
      seenHeights.add(height);

      videoFormats.push({
        hasVideo: true,
        label: qualityLabels[height] || `${height}p`,
        height,
        url: f.url,
        size: formatBytes(f.contentLength),
        ext: f.container || 'mp4',
        vcodec: f.codecs || null,
      });
    }

    // Build audio format options (sorted by bitrate desc, max 3)
    const audioFormats = [];
    const seenBitrates = new Set();
    const audioOnly = formats
      .filter(f => f.hasAudio && !f.hasVideo && f.audioBitrate)
      .sort((a, b) => (b.audioBitrate || 0) - (a.audioBitrate || 0));

    for (const f of audioOnly) {
      const br = f.audioBitrate || 0;
      if (seenBitrates.has(br)) continue;
      seenBitrates.add(br);

      audioFormats.push({
        hasAudio: true,
        label: `${br} kbps`,
        abr: br,
        url: f.url,
        size: formatBytes(f.contentLength),
        ext: f.container || 'm4a',
      });

      if (audioFormats.length >= 3) break;
    }

    // Find best combined format for direct play
    const bestCombined = combinedFormats.sort(
      (a, b) => (b.height || 0) - (a.height || 0)
    )[0];

    const duration = parseInt(details.lengthSeconds || '0', 10);
    const thumbnail = details.thumbnails?.sort((a, b) => b.width - a.width)[0]?.url
      || `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

    return res.json({
      success: true,
      data: {
        platform: 'youtube',
        title: details.title || 'YouTube 影片',
        description: details.description?.substring(0, 500) || '',
        author: details.author?.name || details.author?.user || '',
        cover: thumbnail,
        sourceUrl: input,
        parser: 'ytdl-core',
        duration,
        duration_formatted: formatDuration(duration),
        video: {
          previewUrl: bestCombined?.url || videoFormats[0]?.url,
          directUrl: bestCombined?.url || videoFormats[0]?.url,
          downloadUrl: bestCombined?.url || videoFormats[0]?.url,
        },
        formats: [...videoFormats, ...audioFormats],
        videoFormats,
        audioFormats,
      },
    });
  } catch (e) {
    return res.status(200).json({
      success: false,
      error: `YouTube 解析失敗：${e?.message || '未知錯誤'}`,
    });
  }
}
