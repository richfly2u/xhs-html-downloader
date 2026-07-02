/**
 * YouTube 媒體解析端點 - 支援多格式
 * POST /api/youtube
 * Body: { text: "https://youtube.com/..." }
 */
const VPS_API = 'http://108.61.163.87:8799/api/yt-dlp';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: '只接受 POST' });
  }

  try {
    const body = typeof req.body === 'object' ? req.body : JSON.parse(req.body?.toString() || '{}');
    const input = (body.text || body.url || '').trim();
    if (!input) return res.status(400).json({ success: false, error: '請提供 YouTube 連結' });

    const vpsResp = await fetch(VPS_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input }),
      signal: AbortSignal.timeout(30000),
    });
    const vpsData = await vpsResp.json();
    if (!vpsData.success) {
      return res.json({ success: false, error: vpsData.error || 'YouTube 解析失敗' });
    }

    const title = vpsData.title || 'YouTube 影片';
    const thumbnail = vpsData.thumbnail || '';
    const videoFormats = (vpsData.video_formats || []).map(f => ({
      hasVideo: true,
      label: f.label || `${f.height || 0}p`,
      height: f.height || 0,
      fps: f.fps || '',
      ext: f.ext || 'mp4',
      vcodec: f.vcodec || '',
      acodec: f.acodec || '',
      size: f.size_mb ? `${f.size_mb} MB` : null,
      url: f.url || '',
    }));
    const audioFormats = (vpsData.audio_formats || []).map(f => ({
      hasAudio: true,
      label: f.label || `${f.abr || 0}k`,
      abr: f.abr || 0,
      ext: f.ext || 'm4a',
      acodec: f.acodec || '',
      size: f.size_mb ? `${f.size_mb} MB` : null,
      url: f.url || '',
    }));
    const bestUrl = vpsData.best_url || videoFormats.find(f => f.url)?.url || '';

    return res.json({
      success: true,
      data: {
        platform: 'youtube',
        title,
        description: '',
        author: '',
        cover: thumbnail,
        sourceUrl: input,
        parser: 'yt-dlp (VPS)',
        duration: vpsData.duration || 0,
        video: {
          previewUrl: bestUrl,
          directUrl: bestUrl,
          downloadUrl: bestUrl,
        },
        formats: [...videoFormats, ...audioFormats],
        videoFormats,
        audioFormats,
      },
    });
  } catch (e) {
    const msg = e?.message || '未知錯誤';
    if (msg.includes('timed out') || e.name === 'TimeoutError') {
      return res.json({ success: false, error: '解析超時，請稍後再試' });
    }
    return res.json({ success: false, error: `YouTube 解析失敗：${msg}` });
  }
}
