/**
 * YouTube 媒體解析端點
 * 經 Vercel 後端 → VPS yt-dlp 伺服器（解決 mixed content + ytdl-core 相容性問題）
 * POST /api/youtube
 * Body: { text: "https://youtube.com/watch?v=..." }
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return res.status(204).end();
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

    // Proxy to VPS yt-dlp server (backend-to-backend, no mixed content issue)
    const vpsResp = await fetch('http://108.61.163.87:8799/api/yt-dlp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: input }),
      signal: AbortSignal.timeout(25000),
    });

    const vpsData = await vpsResp.json();
    if (!vpsData.success) {
      return res.json({ success: false, error: vpsData.error || 'YouTube 解析失敗' });
    }

    // Transform VPS format to frontend format
    const title = vpsData.title || 'YouTube 影片';
    const bestUrl = vpsData.best_url || vpsData.video_formats?.[0]?.url || '';
    const formats = (vpsData.video_formats || []).map(f => ({
      hasVideo: true,
      label: f.height ? `${f.height}p` : f.id,
      height: f.height || 0,
      url: f.url,
      size: f.size_mb ? `${f.size_mb} MB` : null,
      ext: f.ext || 'mp4',
    }));
    const audioFormats = (vpsData.audio_formats || []).map(f => ({
      hasAudio: true,
      label: `${f.tbr || 128} kbps`,
      abr: f.tbr || 128,
      url: f.url,
      size: f.size_mb ? `${f.size_mb} MB` : null,
      ext: f.ext || 'm4a',
    }));

    return res.json({
      success: true,
      data: {
        platform: 'youtube',
        title,
        description: '',
        author: '',
        cover: vpsData.thumbnail || '',
        sourceUrl: input,
        parser: 'yt-dlp (VPS)',
        duration: vpsData.duration || 0,
        duration_formatted: vpsData.duration ? `${Math.floor(vpsData.duration / 60)}:${String(vpsData.duration % 60).padStart(2, '0')}` : '',
        video: {
          previewUrl: bestUrl,
          directUrl: bestUrl,
          downloadUrl: bestUrl,
        },
        formats: [...formats, ...audioFormats],
      },
    });
  } catch (e) {
    const msg = e?.message || '未知錯誤';
    if (msg.includes('timed out') || msg.includes('Abort')) {
      return res.json({ success: false, error: 'YouTube 解析超時，請稍後再試。' });
    }
    return res.json({ success: false, error: `YouTube 解析失敗：${msg}` });
  }
}
