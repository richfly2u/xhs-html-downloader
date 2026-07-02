const $ = (id) => document.getElementById(id);
const input = $('shareInput');
const parseButton = $('parseButton');
const pasteButton = $('pasteButton');
const clearButton = $('clearButton');
const errorBox = $('errorBox');
const errorText = $('errorText');
const resultSection = $('resultSection');
const videoPlayer = $('videoPlayer');
const imageGrid = $('imageGrid');
const mediaPlaceholder = $('mediaPlaceholder');
const downloadButton = $('downloadButton');
const downloadLabel = $('downloadLabel');
const copyLinkButton = $('copyLinkButton');
const copyTextButton = $('copyTextButton');
const mediaPanel = $('mediaPanel');
const historySection = $('historySection');
const historyList = $('historyList');
const formatPicker = $('formatPicker') || { classList: { add() {}, remove() {} } };
const formatList = $('formatList');
const coverDownloadButton = $('coverDownloadButton');
const retryAnalysisButton = $('retryAnalysisButton');
const themeButton = $('themeButton');
const analysisSection = $('analysisSection');
const analysisLoading = $('analysisLoading');
const analysisError = $('analysisError');
const analysisErrorText = $('analysisErrorText');
const analysisContent = $('analysisContent');
const analysisStatus = $('analysisStatus');
const analysisWarning = $('analysisWarning');
const transcriptBox = $('transcriptBox');
const aiAccessCodeInput = $('aiAccessCodeInput');
const saveAiAccessCodeButton = $('saveAiAccessCodeButton');
const clearAiAccessCodeButton = $('clearAiAccessCodeButton');
const aiAccessCodeStatus = $('aiAccessCodeStatus');
let analysisResult = null;
let analysisRequestId = 0;
const HISTORY_KEY = 'xhs-html-downloader-history-v1';
const AI_ACCESS_CODE_KEY = 'xhs-html-downloader-ai-access-code';
let result = null;
let resultData = null; // raw data from API
let toastTimer = null;


function getAiAccessCode() {
  return localStorage.getItem(AI_ACCESS_CODE_KEY) || '';
}

function setAiAccessCode(value) {
  const clean = String(value || '').trim();
  if (clean) localStorage.setItem(AI_ACCESS_CODE_KEY, clean);
  else localStorage.removeItem(AI_ACCESS_CODE_KEY);
  syncAiAccessUI();
}

function syncAiAccessUI(message = '') {
  const hasCode = Boolean(getAiAccessCode());
  if (aiAccessCodeInput) aiAccessCodeInput.value = hasCode ? getAiAccessCode() : '';
  if (aiAccessCodeStatus) {
    aiAccessCodeStatus.textContent = message || (hasCode
      ? '已儲存 AI 功能密碼。之後按「重新分析」或解析新內容時，會自動附帶密碼。'
      : '尚未儲存 AI 密碼。公開網址可供任何人使用一般解析功能，建議保護 AI 功能以避免消耗您的 Token。');
    aiAccessCodeStatus.classList.toggle('is-ok', hasCode && !message);
    aiAccessCodeStatus.classList.toggle('is-warn', !hasCode || Boolean(message));
  }
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2100);
}

function showError(message) {
  errorText.textContent = message;
  errorBox.classList.remove('is-hidden');
}

function hideError() {
  errorBox.classList.add('is-hidden');
  errorText.textContent = '';
}

function setLoading(loading) {
  parseButton.disabled = loading;
  pasteButton.disabled = loading;
  parseButton.classList.toggle('is-loading', loading);
}

async function copyText(value, successMessage) {
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    showToast(successMessage);
  } catch {
    const helper = document.createElement('textarea');
    helper.value = value;
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.appendChild(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
    showToast(successMessage);
  }
}


function analysisModeName(mode) {
  const names = {
    'ai-video': 'Groq AI 影片逐字稿＋優化文案',
    'ai-caption': 'Groq AI 文案優化',
    'local-caption': '內建文案分析'
  };
  return names[mode] || '自動文案分析';
}

function resetAnalysisUI() {
  analysisResult = null;
  analysisSection.classList.remove('is-hidden');
  analysisLoading.classList.remove('is-hidden');
  analysisError.classList.add('is-hidden');
  analysisContent.classList.add('is-hidden');
  analysisStatus.classList.remove('is-done');
  analysisStatus.lastChild.textContent = '分析中';
  analysisWarning.classList.add('is-hidden');
  transcriptBox.classList.add('is-hidden');
}

function renderList(id, items) {
  const list = $(id);
  list.textContent = '';
  for (const value of items || []) {
    const li = document.createElement('li');
    li.textContent = value;
    list.appendChild(li);
  }
}

function renderAnalysis(data) {
  analysisResult = data;
  analysisLoading.classList.add('is-hidden');
  analysisError.classList.add('is-hidden');
  analysisContent.classList.remove('is-hidden');
  analysisStatus.classList.add('is-done');
  analysisStatus.lastChild.textContent = '已完成';
  retryAnalysisButton.textContent = '重新分析';

  $('analysisMode').textContent = analysisModeName(data.mode);
  $('analysisSummary').textContent = data.summary || '分析完成';
  $('analysisHook').textContent = data.hook || '—';
  $('analysisAudience').textContent = data.audience || '—';
  $('analysisStructure').textContent = data.structure || '—';
  renderList('analysisStrengths', data.strengths);
  renderList('analysisImprovements', data.improvements);

  const keywords = $('analysisKeywords');
  keywords.textContent = '';
  for (const value of data.keywords || []) {
    const tag = document.createElement('span');
    tag.textContent = `#${String(value).replace(/^#/, '')}`;
    keywords.appendChild(tag);
  }
  keywords.classList.toggle('is-hidden', !data.keywords?.length);
  $('optimizedCopy').textContent = data.optimizedCopy || '';

  if (data.warning) {
    analysisWarning.textContent = data.warning;
    analysisWarning.classList.remove('is-hidden');
  } else {
    analysisWarning.classList.add('is-hidden');
  }

  if (data.transcript || data.transcriptionStatus) {
    $('transcriptionStatus').textContent = data.transcriptionStatus || '';
    $('transcriptText').textContent = data.transcript || '沒有取得逐字稿。';
    transcriptBox.classList.remove('is-hidden');
  } else {
    transcriptBox.classList.add('is-hidden');
  }
}

function showAnalysisError(message) {
  analysisLoading.classList.add('is-hidden');
  analysisContent.classList.add('is-hidden');
  analysisError.classList.remove('is-hidden');
  analysisErrorText.textContent = message;
  analysisStatus.classList.remove('is-done');
  analysisStatus.lastChild.textContent = '未完成';
}

async function analyzeCurrentResult(data = result) {
  if (!data) return;
  const requestId = ++analysisRequestId;
  resetAnalysisUI();
  try {
    const aiAccessCode = getAiAccessCode();
    const headers = { 'content-type': 'application/json' };
    if (aiAccessCode) headers['x-ai-access-code'] = aiAccessCode;
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title: data.title || '',
        description: data.description || '',
        author: data.author || '',
        sourceUrl: data.sourceUrl || '',
        videoUrl: data.video?.directUrl || data.videoUrl || ''
      })
    });
    const payload = await response.json().catch(() => null);
    if (requestId !== analysisRequestId) return;
    if (!response.ok || !payload?.success) {
      if (response.status === 401) {
        syncAiAccessUI('此網站已啟用 AI 密碼保護，請先輸入正確密碼後再重新分析。');
      } else if (response.status === 403) {
        syncAiAccessUI('AI 密碼不正確，請重新輸入後再試一次。');
      }
      throw new Error(payload?.error || `文案分析服務錯誤：HTTP ${response.status}`);
    }
    if (aiAccessCode) syncAiAccessUI();
    renderAnalysis(payload.data);
  } catch (error) {
    if (requestId !== analysisRequestId) return;
    showAnalysisError(error.message || '文案分析失敗，請稍後再試。');
  }
}

function analysisAsText(data) {
  if (!data) return '';
  const lines = [
    `核心摘要：${data.summary || ''}`,
    `吸睛開頭：${data.hook || ''}`,
    `目標觀眾：${data.audience || ''}`,
    `文案結構：${data.structure || ''}`,
    '',
    '文案優點：',
    ...(data.strengths || []).map((item) => `• ${item}`),
    '',
    '可改善之處：',
    ...(data.improvements || []).map((item) => `• ${item}`),
    '',
    `關鍵字：${(data.keywords || []).map((item) => `#${String(item).replace(/^#/, '')}`).join(' ')}`,
    '',
    '優化後文案：',
    data.optimizedCopy || ''
  ];
  if (data.transcript) lines.push('', '影片逐字稿：', data.transcript);
  return lines.join('\n');
}

function parserName(value) {
  const names = {
    'initial-state': '結構資料',
    'page-media-scan': '頁面掃描',
    'direct-media-url': '媒體直連'
  };
  return names[value] || value || '';
}

function iconDownload() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 5-5m-5 5-5-5M5 20h14"/></svg>';
}


function configureDownloadLink(link, url, directLabel) {
  link.href = url || '#';
  let isExternal = false;
  try {
    isExternal = Boolean(url) && new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    isExternal = false;
  }

  link.dataset.external = isExternal ? '1' : '0';
  if (isExternal) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.removeAttribute('download');
    if (link === downloadButton) downloadLabel.textContent = directLabel;
  } else {
    link.removeAttribute('target');
    link.removeAttribute('rel');
    link.setAttribute('download', '');
  }
}

function renderImages(images) {
  imageGrid.textContent = '';
  for (const image of images) {
    const item = document.createElement('div');
    item.className = 'image-item';
    const img = document.createElement('img');
    img.src = image.previewUrl || image.directUrl;
    img.alt = `圖片 ${image.index}`;
    img.loading = 'lazy';
    const link = document.createElement('a');
    link.className = 'image-download';
    configureDownloadLink(link, image.downloadUrl || image.directUrl, '開啟圖片');
    link.setAttribute('aria-label', `下載圖片 ${image.index}`);
    link.innerHTML = iconDownload();
    item.append(img, link);
    imageGrid.appendChild(item);
  }
}

function renderResult(data) {
  result = data;
  resultData = data; // store raw data for format picker
  hideError();
  resultSection.classList.remove('is-hidden');
  mediaPlaceholder.classList.add('is-hidden');
  videoPlayer.classList.add('is-hidden');
  imageGrid.classList.add('is-hidden');
  formatPicker.classList.add('is-hidden');
  videoPlayer.removeAttribute('src');
  videoPlayer.load();

  const isVideo = Boolean(data.video);
  // Build format picker for YouTube
  if (data.platform === 'youtube' && data.formats?.length > 0 && formatList) {
    const list = formatList;
    list.textContent = '';
    
    // Helper: create download row
    function createFormatRow(fmt) {
      const row = document.createElement('div');
      row.className = 'yt-format-row';
      
      const info = document.createElement('div');
      info.className = 'yt-format-info';
      
      const label = document.createElement('span');
      label.className = 'yt-format-label';
      if (fmt.hasVideo) {
        label.textContent = fmt.label;
      } else {
        label.textContent = fmt.label;
      }
      info.appendChild(label);
      
      if (fmt.size) {
        const sizeEl = document.createElement('span');
        sizeEl.className = 'yt-format-size';
        sizeEl.textContent = fmt.size;
        info.appendChild(sizeEl);
      }
      
      // Show codec for video, abr for audio
      if (fmt.hasVideo && fmt.vcodec) {
        const codecEl = document.createElement('span');
        codecEl.className = 'yt-format-codec';
        const codecName = fmt.vcodec.replace(/^avc1\./, 'avc1/').replace(/^av01\./, 'av01/').replace(/\.\d+[a-zA-Z0-9]*$/, '').substring(0, 12);
        codecEl.textContent = codecName;
        info.appendChild(codecEl);
      } else if (fmt.hasAudio && fmt.ext) {
        const codecEl = document.createElement('span');
        codecEl.className = 'yt-format-codec';
        codecEl.textContent = fmt.ext === 'm4a' ? '.m4a' : `.${fmt.ext}`;
        info.appendChild(codecEl);
      }
      
      row.appendChild(info);
      
      const dlBtn = document.createElement('a');
      dlBtn.className = 'yt-format-dl';
      dlBtn.href = fmt.url;
      dlBtn.target = '_blank';
      dlBtn.rel = 'noopener noreferrer';
      dlBtn.textContent = '下載';
      dlBtn.addEventListener('click', (e) => {
        // YouTube CDN URLs expire, so re-parse on each click
        e.preventDefault();
        dlBtn.textContent = '…';
        dlBtn.style.pointerEvents = 'none';
        const videoUrl = input.value.trim() || resultData?.sourceUrl;
        if (!videoUrl) { showToast('請重新貼上 YouTube 連結'); dlBtn.textContent = '下載'; dlBtn.style.pointerEvents = ''; return; }
        fetch('/api/youtube', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: videoUrl })
        }).then(r => r.json()).then(payload => {
          if (!payload.success || !payload.data) {
            showToast('重新解析失敗，請稍後再試');
            dlBtn.textContent = '下載';
            dlBtn.style.pointerEvents = '';
            return;
          }
          // Find matching format by height/abr
          const freshFormats = payload.data.formats || [];
          const matched = fmt.height
            ? freshFormats.find(f => f.height === fmt.height)
            : (fmt.abr ? freshFormats.find(f => f.abr === fmt.abr) : freshFormats[0]);
          const targetUrl = matched?.url || payload.data.videoUrl;
          if (targetUrl) {
            window.open(targetUrl, '_blank', 'noopener,noreferrer');
          } else {
            showToast('此格式暫無可用連結，請嘗試其他');
          }
        }).catch(() => {
          showToast('請求失敗，請稍後再試');
        }).finally(() => {
          dlBtn.textContent = '下載';
          dlBtn.style.pointerEvents = '';
        });
      });
      row.appendChild(dlBtn);
      return row;
    }
    
    // Audio section
    const audioFormats = data.audioFormats || [];
    const videoFormats = data.videoFormats || [];
    
    if (audioFormats.length > 0) {
      const audioSection = document.createElement('div');
      audioSection.className = 'yt-section';
      const audioTitle = document.createElement('div');
      audioTitle.className = 'yt-section-title';
      audioTitle.textContent = '音訊';
      audioSection.appendChild(audioTitle);
      for (const fmt of audioFormats) {
        audioSection.appendChild(createFormatRow(fmt));
      }
      list.appendChild(audioSection);
    }
    
    // Video section
    if (videoFormats.length > 0) {
      const videoSection = document.createElement('div');
      videoSection.className = 'yt-section';
      const videoTitle = document.createElement('div');
      videoTitle.className = 'yt-section-title';
      videoTitle.textContent = '影片';
      videoSection.appendChild(videoTitle);
      for (const fmt of videoFormats) {
        videoSection.appendChild(createFormatRow(fmt));
      }
      list.appendChild(videoSection);
    }
    
    formatPicker?.classList.remove('is-hidden');
    const totalFormats = audioFormats.length + videoFormats.length;
    $('countValue').textContent = `${totalFormats} 種格式`;
  }

  if (isVideo) {
    // YouTube CDN URLs don't play in browser - show poster only
    if (data.platform === 'youtube') {
      videoPlayer.removeAttribute('src');
      videoPlayer.load();
      // Show a message overlay on the video element
      const msg = document.createElement('div');
      msg.className = 'yt-overlay-msg';
      msg.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7L8 5Z"/></svg> 點下方按鈕下載影片';
      mediaPanel.querySelector('.yt-overlay-msg')?.remove();
      mediaPanel.appendChild(msg);
    } else {
      videoPlayer.src = data.video.previewUrl || data.video.directUrl;
    }
    if (data.cover) videoPlayer.poster = data.cover;
    videoPlayer.classList.remove('is-hidden');
    configureDownloadLink(downloadButton, data.video.downloadUrl || data.video.directUrl, '開啟影片下載');
    // YouTube: POST blob download via /api/dl-proxy (no URL encoding issues)
    if (data.platform === 'youtube') {
      const ytDlUrl = data.video.downloadUrl || data.video.directUrl;
      const ytTitle = (data.title || 'youtube').replace(/[^\w\-. ]/g, '').slice(0, 80) || 'youtube';
      downloadButton.href = '#';
      downloadButton.target = '';
      downloadButton.rel = '';
      downloadButton.removeAttribute('download');
      downloadButton.dataset.external = '0';
      downloadLabel.textContent = '下載影片';
      copyLinkButton.dataset.url = ytDlUrl;
      downloadButton.onclick = async (e) => {
        e.preventDefault();
        downloadLabel.textContent = '下載中…';
        try {
          const resp = await fetch('/api/dl-proxy', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: ytDlUrl }),
          });
          if (!resp.ok) throw new Error(await resp.text().catch(() => ''));
          const blob = await resp.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = ytTitle + '.mp4';
          a.style.display = 'none';
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(blobUrl);
          downloadLabel.textContent = '下載完成';
          setTimeout(() => { downloadLabel.textContent = '下載影片'; }, 3000);
        } catch (err) {
          downloadLabel.textContent = '下載失敗，請重試';
          console.error('Download error:', err);
        }
      };
    } else {
      downloadButton.onclick = null;
    }
    if (downloadButton.dataset.external !== '1') downloadLabel.textContent = '下載影片';
    copyLinkButton.dataset.url = data.video.directUrl;
  } else {
    renderImages(data.images || []);
    imageGrid.classList.remove('is-hidden');
    const first = data.images?.[0];
    configureDownloadLink(downloadButton, first?.downloadUrl || first?.directUrl || '#', '開啟圖片下載');
    if (downloadButton.dataset.external !== '1') downloadLabel.textContent = data.images?.length > 1 ? '下載第一張' : '下載圖片';
    copyLinkButton.dataset.url = first?.directUrl || '';
  }

  // 縮圖下載按鈕 (vd6s-style thumbnail download)
  $('coverDownloadButton')?.classList.toggle('is-hidden', !data.cover);
  $('coverDownloadButton') && ($('coverDownloadButton').dataset.url = data.cover || '');

  $('mediaType').textContent = isVideo ? '影片' : '圖片筆記';
  $('parserLabel').textContent = parserName(data.parser);
  const platformLabel = $('platformLabel');
  if (platformLabel) {
    platformLabel.textContent = data.platform || '';
    platformLabel.classList.toggle('is-hidden', !data.platform);
  }
  $('resultTitle').textContent = data.title || '未命名作品';
  $('formatValue').textContent = data.format || (isVideo ? 'MP4' : '圖片');
  $('sizeValue').textContent = data.size || '未提供';
  if (!(data.platform === 'youtube' && data.formats?.length)) {
    $('countValue').textContent = isVideo ? `1 部影片${data.alternatives?.length ? ` · ${data.alternatives.length} 個備選` : ''}` : `${data.images?.length || 0} 張圖片`;
  }

  const authorLine = $('authorLine');
  if (data.author) {
    authorLine.textContent = `作者：${data.author}`;
    authorLine.classList.remove('is-hidden');
  } else {
    authorLine.classList.add('is-hidden');
  }

  const description = $('resultDescription');
  if (data.description) {
    description.textContent = data.description;
    description.classList.remove('is-hidden');
    copyTextButton.classList.remove('is-hidden');
  } else {
    description.classList.add('is-hidden');
    copyTextButton.classList.add('is-hidden');
  }

  addHistory(data);
  resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // 不自動觸發 AI 分析（避免無意間消耗 Token），使用者可點「開始分析」
  analysisSection.classList.remove('is-hidden');
  analysisLoading.classList.add('is-hidden');
  analysisContent.classList.add('is-hidden');
  analysisError.classList.remove('is-hidden');
  analysisErrorText.textContent = '點擊下方按鈕開始文案分析（無 AI 金鑰時使用內建分析，不會消耗 Token）。';
  analysisStatus.lastChild.textContent = '待分析';
  analysisStatus.classList.remove('is-done');
  retryAnalysisButton.textContent = '開始分析';
}

function isYouTubeLink(text) {
  return /(?:youtube\.com|youtu\.be)/i.test(text);
}

async function parseCurrentInput() {
  const value = input.value.trim();
  if (!value) {
    showError('請先貼上小紅書分享文字或連結。');
    input.focus();
    return;
  }

  hideError();
  setLoading(true);
  try {
    const isYT = isYouTubeLink(value);
    const endpoint = isYT ? '/api/youtube' : '/api/parse';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: value })
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      throw new Error(payload?.error || `伺服器回應錯誤：HTTP ${response.status}`);
    }
    renderResult(payload.data);
  } catch (error) {
    showError(error.message || '解析失敗，請稍後再試。');
  } finally {
    setLoading(false);
  }
}

function readHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 30)));
  renderHistory();
syncAiAccessUI();
}

function addHistory(data) {
  if (!data.sourceUrl) return;
  const items = readHistory().filter((item) => item.sourceUrl !== data.sourceUrl);
  items.unshift({
    sourceUrl: data.sourceUrl,
    title: data.title || '未命名作品',
    cover: data.cover || data.images?.[0]?.directUrl || data.images?.[0]?.previewUrl || '',
    mediaUrl: data.video?.directUrl || data.images?.[0]?.directUrl || '',
    type: data.type,
    time: Date.now()
  });
  saveHistory(items);
}

function relativeTime(timestamp) {
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function historyPlaceholder(thumb, type) {
  thumb.textContent = '';
  thumb.innerHTML = type === 'video'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7L8 5Z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4V5Zm3 10 3-3 3 3 2-2 3 3M9 9h.01"/></svg>';
}

function thumbnailProxyUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin === window.location.origin) return parsed.toString();
    if (!parsed.hostname.endsWith('.xhscdn.com') && parsed.hostname !== 'xhscdn.com') return url;
    return `/api/thumbnail?url=${encodeURIComponent(parsed.toString())}`;
  } catch {
    return url;
  }
}

function renderHistoryThumbnail(thumb, item) {
  const rawCandidates = [...new Set([item.cover, item.type !== 'video' ? item.mediaUrl : ''].filter(Boolean))];
  const candidates = [];
  for (const url of rawCandidates) {
    const proxied = thumbnailProxyUrl(url);
    if (proxied) candidates.push(proxied);
    if (url !== proxied) candidates.push(url);
  }

  if (candidates.length) {
    const img = document.createElement('img');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    let index = 0;
    const loadNext = () => {
      if (index >= candidates.length) {
        historyPlaceholder(thumb, item.type);
        return;
      }
      img.src = candidates[index++];
    };
    img.addEventListener('error', loadNext);
    thumb.appendChild(img);
    loadNext();
    return;
  }

  if (item.type === 'video' && item.mediaUrl) {
    const video = document.createElement('video');
    video.src = item.mediaUrl;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('aria-hidden', 'true');
    video.addEventListener('loadedmetadata', () => {
      try { video.currentTime = Math.min(0.1, Number.isFinite(video.duration) ? video.duration / 10 : 0.1); } catch {}
    }, { once: true });
    video.addEventListener('error', () => historyPlaceholder(thumb, item.type), { once: true });
    thumb.appendChild(video);
    return;
  }

  historyPlaceholder(thumb, item.type);
}

function renderHistory() {
  const items = readHistory();
  historyList.textContent = '';
  historySection.classList.toggle('is-hidden', items.length === 0);
  for (const item of items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'history-item';

    const thumb = document.createElement('span');
    thumb.className = 'history-thumb';
    renderHistoryThumbnail(thumb, item);

    const info = document.createElement('span');
    info.className = 'history-info';
    const title = document.createElement('strong');
    title.textContent = item.title;
    const detail = document.createElement('span');
    detail.textContent = `${item.type === 'video' ? '影片' : '圖片'} · ${relativeTime(item.time)}`;
    info.append(title, detail);

    const arrow = document.createElement('span');
    arrow.className = 'history-arrow';
    arrow.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
    button.append(thumb, info, arrow);
    button.addEventListener('click', () => {
      input.value = item.sourceUrl;
      updateCounter();
      parseCurrentInput();
    });
    historyList.appendChild(button);
  }
}

function updateCounter() {
  $('charCount').textContent = `${input.value.length} / 4096`;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem('xhs-theme', theme);
  themeButton.setAttribute('aria-label', theme === 'dark' ? '切換淺色模式' : '切換深色模式');
}

downloadButton.addEventListener('click', () => {
  if (downloadButton.dataset.external === '1') {
    showToast('已開啟原始媒體');
  }
});

parseButton.addEventListener('click', parseCurrentInput);
input.addEventListener('input', updateCounter);
input.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') parseCurrentInput();
});
pasteButton.addEventListener('click', async () => {
  hideError();
  try {
    input.value = await navigator.clipboard.readText();
    updateCounter();
    input.focus();
  } catch {
    showError('瀏覽器沒有允許讀取剪貼簿，請長按輸入框後手動貼上。');
  }
});
clearButton.addEventListener('click', () => {
  input.value = '';
  updateCounter();
  hideError();
  input.focus();
});
copyLinkButton.addEventListener('click', () => copyText(copyLinkButton.dataset.url, '已複製媒體直連'));
copyTextButton.addEventListener('click', () => copyText(result?.description, '已複製文案'));
$('copyOptimizedButton').addEventListener('click', () => copyText(analysisResult?.optimizedCopy, '已複製優化文案'));
$('copyAnalysisButton').addEventListener('click', () => copyText(analysisAsText(analysisResult), '已複製完整分析'));
$('retryAnalysisButton').addEventListener('click', () => analyzeCurrentResult(result));
$('clearHistoryButton').addEventListener('click', () => {
  localStorage.removeItem(HISTORY_KEY);
  renderHistory();
syncAiAccessUI();
  showToast('已清除最近紀錄');
});
themeButton.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

saveAiAccessCodeButton.addEventListener('click', () => {
  const value = aiAccessCodeInput.value.trim();
  if (!value) {
    setAiAccessCode('');
    syncAiAccessUI('尚未輸入密碼，請先填入 AI 功能密碼。');
    return;
  }
  setAiAccessCode(value);
  showToast('已儲存 AI 功能密碼');
  if (result) analyzeCurrentResult(result);
});

clearAiAccessCodeButton.addEventListener('click', () => {
  setAiAccessCode('');
  syncAiAccessUI();
  showToast('已清除 AI 功能密碼');
});

aiAccessCodeInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') saveAiAccessCodeButton.click();
});

// 縮圖下載 (vd6s-inspired)
coverDownloadButton.addEventListener('click', () => {
  const url = coverDownloadButton.dataset.url;
  if (!url) return;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.click();
  showToast('已開啟封面圖片');
});

// 貼上自動解析 (vd6s-inspired onpaste auto-trigger)
input.addEventListener('paste', () => {
  setTimeout(() => {
    const val = input.value.trim();
    if (val.length > 0) {
      parseCurrentInput();
    }
  }, 100);
});

const preferredTheme = localStorage.getItem('xhs-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
applyTheme(preferredTheme);
updateCounter();
renderHistory();
syncAiAccessUI();
