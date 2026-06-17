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
const historySection = $('historySection');
const historyList = $('historyList');
const themeButton = $('themeButton');
const analysisSection = $('analysisSection');
const analysisLoading = $('analysisLoading');
const analysisError = $('analysisError');
const analysisErrorText = $('analysisErrorText');
const analysisContent = $('analysisContent');
const analysisStatus = $('analysisStatus');
const analysisWarning = $('analysisWarning');
const transcriptBox = $('transcriptBox');
let analysisResult = null;
let analysisRequestId = 0;
const HISTORY_KEY = 'xhs-html-downloader-history-v1';
let result = null;
let toastTimer = null;


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
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
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
      throw new Error(payload?.error || `文案分析服務錯誤：HTTP ${response.status}`);
    }
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
  hideError();
  resultSection.classList.remove('is-hidden');
  mediaPlaceholder.classList.add('is-hidden');
  videoPlayer.classList.add('is-hidden');
  imageGrid.classList.add('is-hidden');
  videoPlayer.removeAttribute('src');
  videoPlayer.load();

  const isVideo = Boolean(data.video);
  if (isVideo) {
    videoPlayer.src = data.video.previewUrl || data.video.directUrl;
    if (data.cover) videoPlayer.poster = data.cover;
    videoPlayer.classList.remove('is-hidden');
    configureDownloadLink(downloadButton, data.video.downloadUrl || data.video.directUrl, '開啟影片下載');
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

  $('mediaType').textContent = isVideo ? '影片' : '圖片筆記';
  $('parserLabel').textContent = parserName(data.parser);
  $('resultTitle').textContent = data.title || '未命名作品';
  $('formatValue').textContent = data.format || (isVideo ? 'MP4' : '圖片');
  $('sizeValue').textContent = data.size || '未提供';
  $('countValue').textContent = isVideo ? `1 部影片${data.alternatives?.length ? ` · ${data.alternatives.length} 個備選` : ''}` : `${data.images?.length || 0} 張圖片`;

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
  analyzeCurrentResult(data);
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
    const response = await fetch('/api/parse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: value })
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
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 8)));
  renderHistory();
}

function addHistory(data) {
  if (!data.sourceUrl) return;
  const items = readHistory().filter((item) => item.sourceUrl !== data.sourceUrl);
  items.unshift({
    sourceUrl: data.sourceUrl,
    title: data.title || '未命名作品',
    cover: data.cover || data.images?.[0]?.previewUrl || '',
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
    if (item.cover) {
      const img = document.createElement('img');
      img.src = item.cover;
      img.alt = '';
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7L8 5Z"/></svg>';
    }

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
  if (!analysisResult && result) analyzeCurrentResult(result);
  if (downloadButton.dataset.external === '1') {
    showToast('已開啟原始媒體，文案分析會在原頁繼續進行');
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
  showToast('已清除最近紀錄');
});
themeButton.addEventListener('click', () => {
  applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
});

const preferredTheme = localStorage.getItem('xhs-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
applyTheme(preferredTheme);
updateCounter();
renderHistory();
