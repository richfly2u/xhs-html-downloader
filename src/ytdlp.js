/**
 * Xiaohongshu internal API fallback for video extraction
 * Used when HTML scraping fails due to xsec_token changes
 * Calls edith.xiaohongshu.com API directly with the xsec_token from URL
 */

export async function tryExtract(url) {
  // Try xiaohongshu internal API first (lighter than yt-dlp)
  const noteId = url.match(/\/item\/([a-f0-9]+)/)?.[1];
  if (!noteId) return null;

  // Extract xsec_token from URL
  const urlObj = new URL(url);
  const xsecToken = urlObj.searchParams.get('xsec_token') || '';

  // Try edith API
  const apiUrl = `https://edith.xiaohongshu.com/api/sns/web/v1/feed?note_id=${noteId}&xsec_token=${encodeURIComponent(xsecToken)}`;

  const response = await fetch(apiUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': `https://www.xiaohongshu.com/discovery/item/${noteId}`,
      'Origin': 'https://www.xiaohongshu.com',
    },
  });

  if (!response.ok) return null;

  const json = await response.json();
  const note = json?.data?.items?.[0]?.note_card || json?.data?.items?.[0];
  if (!note) return null;

  // Check for video
  const videoBlock = note.video || note.media || note.videoInfo || note.video_info;
  let videoUrl = null;
  if (videoBlock) {
    const stream = videoBlock.stream || videoBlock.media?.stream || videoBlock;
    videoUrl = stream.h264?.[0]?.master_url
      || stream.h264?.[0]?.url
      || stream.h264?.[0]?.backup_url
      || videoBlock.downloadUrl || videoBlock.download_url
      || videoBlock.url || videoBlock.directUrl || videoBlock.direct_url;
  }

  if (!videoUrl) return null;

  return {
    videoUrl,
    title: note.title || note.displayTitle || note.display_title || null,
  };
}
