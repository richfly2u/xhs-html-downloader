import { probeMedia } from './resolver.js';
import { assertHttpUrl, assertPublicResolution, isMediaHost, unique } from './utils.js';

const OPENAI_API_BASE = 'https://api.openai.com/v1';
const DEFAULT_MAX_TRANSCRIBE_BYTES = 24 * 1024 * 1024;
const DEFAULT_AI_TIMEOUT_MS = 55_000;

function cleanText(value, maxLength = 12_000) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

function splitSentences(text) {
  return cleanText(text)
    .split(/(?<=[。！？!?；;])|\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractKeywords(text) {
  const source = cleanText(text);
  const hashtags = [...source.matchAll(/#([^#\s，。！？、]+)/gu)].map((match) => match[1]);
  const common = [
    '料理', '素食', '美食', '食譜', '旅遊', '景點', '穿搭', '保養', '健身', '減脂',
    '生活', '收納', '教學', '開箱', '手機', '電腦', 'AI', '影片', '攝影', '寵物',
    '狗狗', '貓咪', '親子', '工作', '創業', '省錢', '推薦', '心得', '技巧', '分享'
  ].filter((word) => source.toLowerCase().includes(word.toLowerCase()));

  return unique([...hashtags, ...common]).slice(0, 10);
}

function inferAudience(text) {
  const source = cleanText(text).toLowerCase();
  const rules = [
    [/素食|蔬食|料理|食譜|便當|美食/u, '喜歡料理、美食或蔬食內容的觀眾'],
    [/旅遊|景點|住宿|飯店|行程/u, '正在規劃旅遊或尋找景點靈感的觀眾'],
    [/保養|彩妝|穿搭|髮型|美容/u, '關注美妝、穿搭與生活風格的觀眾'],
    [/健身|減脂|運動|瑜伽|體態/u, '想改善體態、健身或建立健康習慣的觀眾'],
    [/手機|電腦|app|軟體|ai|科技|教學/u, '喜歡科技工具、實用教學與效率方法的觀眾'],
    [/狗|貓|寵物|毛孩/u, '喜歡寵物與療癒內容的觀眾'],
    [/親子|孩子|小孩|育兒/u, '家長與關注親子生活的觀眾']
  ];
  return rules.find(([pattern]) => pattern.test(source))?.[1] || '對主題有興趣、想快速獲得重點資訊的觀眾';
}

function detectStructure(text) {
  const source = cleanText(text);
  const parts = [];
  if (/^[^。！？!?]{4,35}[。！？!?]?/u.test(source)) parts.push('開頭以主題或情境切入');
  if (/\d+[\.、）)]|第一|第二|首先|接著|最後/u.test(source)) parts.push('中段採步驟或條列說明');
  else parts.push('中段以敘述方式展開重點');
  if (/你也|留言|收藏|分享|追蹤|試試|快來|推薦/u.test(source)) parts.push('結尾帶有互動或行動呼籲');
  else parts.push('結尾可再補強行動呼籲');
  return parts.join('；');
}

function shorten(text, max = 92) {
  const source = cleanText(text);
  return source.length > max ? `${source.slice(0, max).trim()}…` : source;
}

function localAnalysis({ title, description, transcript }) {
  const body = cleanText([description, transcript].filter(Boolean).join('\n\n'));
  const sentences = splitSentences(body);
  const hook = cleanText(title) || sentences[0] || '從觀眾最在意的問題開始切入';
  const keywords = extractKeywords(`${title || ''}\n${body}`);
  const strengths = [];
  const improvements = [];

  if (title) strengths.push('主題明確，觀眾能快速理解內容方向');
  if (sentences.length >= 3) strengths.push('內容具備一定資訊量與敘事層次');
  if (keywords.length) strengths.push('已有可延伸為搜尋標籤的主題關鍵字');
  if (/[！!？?]/u.test(body)) strengths.push('語氣具有情緒或提問感，較容易吸引注意');
  if (!strengths.length) strengths.push('內容簡潔，適合再加工成短影音文案');

  if (!title || title.length < 8) improvements.push('補上一句更具利益點或好奇心的標題');
  if (!/你|大家|一起|留言|收藏|分享|試試|快來/u.test(body)) improvements.push('增加與觀眾對話的語句及明確行動呼籲');
  if (body.length < 60) improvements.push('補充一個具體情境、成果或關鍵細節，提升可信度');
  if (body.length > 500) improvements.push('刪減重複句，將重點整理成 3 至 5 個短段落');
  if (keywords.length < 3) improvements.push('補充 3 至 5 個精準主題標籤，增加搜尋辨識度');
  if (!improvements.length) improvements.push('將最重要的一句提前到第一行，強化前三秒吸引力');

  const keywordLine = keywords.length
    ? keywords.slice(0, 6).map((word) => `#${word}`).join(' ')
    : '#實用分享 #生活靈感 #值得收藏';
  const core = body || '這段內容值得整理成更有吸引力的短影音文案。';
  const optimizedCopy = [
    `【${cleanText(title) || '你一定要知道的實用分享'}】`,
    shorten(sentences[0] || core, 70),
    '',
    shorten(core, 320),
    '',
    '你最有感的是哪一點？歡迎留言分享，也可以先收藏起來慢慢看。',
    keywordLine
  ].join('\n');

  return {
    summary: shorten(core, 120),
    hook: shorten(hook, 80),
    audience: inferAudience(`${title || ''}\n${body}`),
    structure: detectStructure(body),
    strengths: strengths.slice(0, 4),
    improvements: improvements.slice(0, 4),
    keywords,
    optimizedCopy
  };
}

function getResponseText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const parts = [];
  for (const item of payload?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

async function openAIJsonAnalysis({ title, description, transcript }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY 未設定');
  const model = process.env.OPENAI_TEXT_MODEL || 'gpt-5.5';
  const input = [
    title ? `標題：${title}` : '',
    description ? `原始貼文文案：\n${description}` : '',
    transcript ? `影片語音逐字稿：\n${transcript}` : ''
  ].filter(Boolean).join('\n\n');

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['summary', 'hook', 'audience', 'structure', 'strengths', 'improvements', 'keywords', 'optimizedCopy'],
    properties: {
      summary: { type: 'string' },
      hook: { type: 'string' },
      audience: { type: 'string' },
      structure: { type: 'string' },
      strengths: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
      improvements: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 5 },
      keywords: { type: 'array', items: { type: 'string' }, maxItems: 10 },
      optimizedCopy: { type: 'string' }
    }
  };

  const body = {
    model,
    store: false,
    max_output_tokens: 1800,
    instructions: [
      '你是繁體中文短影音文案顧問。',
      '請根據提供的標題、貼文文案與逐字稿分析，不得捏造影片中沒有的資訊。',
      '輸出應實用、具體、語氣自然，並提供一份可直接發布的優化文案。',
      '關鍵字不要加 #，optimizedCopy 內可以加入適量標籤。'
    ].join(''),
    input,
    text: {
      format: {
        type: 'json_schema',
        name: 'copy_analysis',
        strict: true,
        schema
      }
    }
  };
  if (/^gpt-5/i.test(model)) body.reasoning = { effort: 'low' };

  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS || DEFAULT_AI_TIMEOUT_MS))
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`AI 文案分析失敗：${detail}`);
  }
  const text = getResponseText(payload);
  if (!text) throw new Error('AI 沒有回傳可用的分析內容');
  return { analysis: JSON.parse(text), model };
}

async function fetchVideoForTranscription(videoUrl, maxBytes) {
  const parsed = assertHttpUrl(videoUrl);
  if (!isMediaHost(parsed.hostname)) throw new Error('僅允許分析小紅書 CDN 影片');
  await assertPublicResolution(parsed.hostname);

  const response = await fetch(parsed, {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/134.0 Safari/537.36',
      referer: 'https://www.xiaohongshu.com/',
      accept: 'video/mp4,*/*;q=0.8'
    },
    signal: AbortSignal.timeout(Number(process.env.AI_MEDIA_TIMEOUT_MS || 45_000))
  });
  if (!response.ok) throw new Error(`影片讀取失敗：HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || 'video/mp4';
  const contentLength = Number(response.headers.get('content-length')) || null;
  if (contentLength && contentLength > maxBytes) throw new Error('影片超過語音辨識大小上限');
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > maxBytes) throw new Error('影片超過語音辨識大小上限');
  return { buffer, contentType };
}

async function transcribeVideo(videoUrl) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !videoUrl) return { transcript: null, status: '未啟用影片語音辨識' };
  if (String(process.env.AI_TRANSCRIBE_VIDEO || 'true').toLowerCase() === 'false') {
    return { transcript: null, status: '影片語音辨識已關閉' };
  }

  const maxBytes = Math.min(
    Number(process.env.MAX_TRANSCRIBE_BYTES || DEFAULT_MAX_TRANSCRIBE_BYTES),
    25 * 1024 * 1024
  );
  const probe = await probeMedia(videoUrl, 10_000).catch(() => ({ bytes: null }));
  if (probe.bytes && probe.bytes > maxBytes) {
    return { transcript: null, status: `影片 ${(probe.bytes / 1024 / 1024).toFixed(1)} MB，超過語音辨識上限` };
  }

  const { buffer, contentType } = await fetchVideoForTranscription(videoUrl, maxBytes);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }), 'video.mp4');
  form.append('model', process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe');
  form.append('response_format', 'json');
  form.append('prompt', '請以繁體中文準確轉錄影片語音，保留專有名詞、料理名稱與品牌名稱。');

  const response = await fetch(`${OPENAI_API_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS || DEFAULT_AI_TIMEOUT_MS))
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = payload?.error?.message || `HTTP ${response.status}`;
    throw new Error(`影片語音辨識失敗：${detail}`);
  }
  return {
    transcript: cleanText(payload?.text, 24_000) || null,
    status: payload?.text ? '已完成影片語音轉文字' : '影片沒有辨識到清楚語音'
  };
}

export async function analyzeCopy(payload = {}) {
  const title = cleanText(payload.title, 500);
  const description = cleanText(payload.description, 12_000);
  const videoUrl = cleanText(payload.videoUrl, 2_000);
  const aiConfigured = Boolean(process.env.OPENAI_API_KEY);

  let transcript = null;
  let transcriptionStatus = aiConfigured ? '沒有提供影片網址' : '未設定 AI 金鑰，僅分析貼文文案';
  let warning = null;

  if (aiConfigured && videoUrl) {
    try {
      const transcription = await transcribeVideo(videoUrl);
      transcript = transcription.transcript;
      transcriptionStatus = transcription.status;
    } catch (error) {
      warning = error instanceof Error ? error.message : '影片語音辨識失敗';
      transcriptionStatus = warning;
    }
  }

  const hasSourceText = Boolean(title || description || transcript);
  if (!hasSourceText) {
    const error = new Error(aiConfigured
      ? '沒有可分析的標題、貼文文案或影片語音'
      : '這是媒體直連，沒有附帶文案；設定 OPENAI_API_KEY 後可嘗試分析影片語音');
    error.code = 'NO_ANALYSIS_SOURCE';
    throw error;
  }

  if (aiConfigured) {
    try {
      const ai = await openAIJsonAnalysis({ title, description, transcript });
      return {
        ...ai.analysis,
        mode: transcript ? 'ai-video' : 'ai-caption',
        model: ai.model,
        transcript,
        transcriptionStatus,
        warning,
        analyzedAt: new Date().toISOString()
      };
    } catch (error) {
      warning = [warning, error instanceof Error ? error.message : 'AI 分析失敗'].filter(Boolean).join('；');
    }
  }

  return {
    ...localAnalysis({ title, description, transcript }),
    mode: 'local-caption',
    model: null,
    transcript,
    transcriptionStatus,
    warning,
    analyzedAt: new Date().toISOString()
  };
}
