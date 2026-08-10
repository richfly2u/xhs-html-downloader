/**
 * 小紅書媒體代理下載端點
 * 解決跨域 CDN 無法直接下載的問題
 * GET /api/download?url=https://...
 */
export default async function handler(req, res) {
  const { url, title } = req.query;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: '缺少 url 參數' });
  }

  if (url.length > 2000) {
    return res.status(400).json({ error: 'URL 過長' });
  }

  // 檔名安全化：移除 Windows/Unix 非法字元、控制字元，限制長度
  function safeName(raw) {
    if (!raw || typeof raw !== 'string') return null;
    // FB 標題帶 HTML entity（&#xa0; 等）→ 先解碼成實際字元
    const decoded = raw
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
      .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
      .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ');
    // 壓縮空白（含全形空格）→ 單一空格，避免手機下載對話框因空格截斷檔名
    const collapsed = decoded
      .replace(/[\s\u00a0]+/g, ' ')
      .trim();
    return collapsed
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || null;
  }

  try {
    const targetUrl = decodeURIComponent(url);
    new URL(targetUrl); // validate URL

    // FB 的 CDN（fbcdn.net）對一般瀏覽器 UA 會回非預期內容（音訊流/403）；
    // 用 facebookexternalhit/1.1 才能拿到完整影片（與解析端一致）
    const isFbCdn = /fbcdn\.net/i.test(targetUrl);
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': isFbCdn
          ? 'facebookexternalhit/1.1'
          : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36',
        Referer: isFbCdn ? 'https://www.facebook.com/' : 'https://www.xiaohongshu.com/',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      let msg = `遠端伺服器錯誤 (${response.status})`;
      if (response.status === 403) msg = '來源拒絕存取（媒體連結可能已過期或禁止外部下載，請重新解析）';
      if (response.status === 404) msg = '來源已不存在（媒體可能被刪除或連結失效）';
      return res.status(response.status).json({ error: msg });
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = response.headers.get('content-length');

    // Extract filename: 優先使用主題標題，否則退回 URL / 類型預設
    let filename = 'download';
    let ext = 'mp4';
    const fileTitle = safeName(title);
    if (contentType?.startsWith('video/')) {
      ext = 'mp4';
      filename = fileTitle ? `${fileTitle}.${ext}` : 'video.mp4';
    } else if (contentType?.startsWith('image/')) {
      ext = contentType.split('/').pop() || 'jpg';
      filename = fileTitle ? `${fileTitle}.${ext}` : `image.${ext}`;
    } else if (fileTitle) {
      // octet-stream 等未知類型：優先依 URL 副檔名判斷
      const m = targetUrl.match(/\.(mp4|jpg|jpeg|png|webp|gif|mov)(?:\?|$)/i);
      ext = m ? m[1].toLowerCase() : 'mp4';
      filename = `${fileTitle}.${ext}`;
    }
    if (targetUrl.match(/\/[^/]+\.[a-z0-9]+(?:\?|$)/i)) {
      const match = targetUrl.match(/\/([^/?]+)\.([a-z0-9]+)(?:\?|$)/i);
      if (match && !fileTitle) filename = `xiaohongshu_${match[1].slice(0, 20)}.${match[2]}`;
    }

    // RFC 5987 支援中文檔名（Content-Disposition filename*）
    // asciiFallback：非 ASCII 與空格都換底線（部分手機瀏覽器解析 filename= 遇空格截斷）
    const asciiFallback = filename.replace(/[^\x20-\x7e]/g, '_').replace(/\s+/g, '_').slice(0, 60);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    // 自訂 header：讓前端知道真實副檔名（blob.type 常為 octet-stream 不可靠）
    res.setHeader('X-Download-Ext', ext);
    if (contentLength) res.setHeader('Content-Length', contentLength);
    res.setHeader('Cache-Control', 'public, max-age=86400');

    // Stream the response
    for await (const chunk of response.body) {
      res.write(chunk);
    }
    res.end();
  } catch (err) {
    if (err.message?.includes('Invalid URL')) {
      return res.status(400).json({ error: '無效的 URL 格式' });
    }
    console.error('[DOWNLOAD PROXY ERROR]', err.message);
    res.status(502).json({ error: '代理下載失敗：' + err.message });
  }
}
