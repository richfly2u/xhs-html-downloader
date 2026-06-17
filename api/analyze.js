import { createHash, timingSafeEqual } from 'node:crypto';
import { analyzeCopy } from '../src/analyzer.js';

export const maxDuration = 60;

function setCommonHeaders(res) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-AI-Access-Code');
}

function secureDigest(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest();
}

function codesEqual(left, right) {
  const a = secureDigest(left);
  const b = secureDigest(right);
  return timingSafeEqual(a, b);
}

function getProvidedCode(req, body) {
  const headerCode = req.headers['x-ai-access-code'];
  if (typeof headerCode === 'string' && headerCode.trim()) return headerCode.trim();
  if (Array.isArray(headerCode) && headerCode[0]) return String(headerCode[0]).trim();
  if (typeof body?.accessCode === 'string' && body.accessCode.trim()) return body.accessCode.trim();
  return '';
}

function getBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  if (Buffer.isBuffer(req.body)) {
    try { return JSON.parse(req.body.toString('utf8')); } catch { return {}; }
  }
  return {};
}

export default async function handler(req, res) {
  setCommonHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ success: false, error: '只接受 POST 請求' });
  }

  try {
    const body = getBody(req);
    const requiredCode = String(process.env.AI_ACCESS_CODE || '').trim();
    if (requiredCode) {
      const providedCode = getProvidedCode(req, body);
      if (!providedCode) {
        return res.status(401).json({ success: false, error: 'AI 分析功能需要密碼', code: 'AI_ACCESS_REQUIRED' });
      }
      if (!codesEqual(requiredCode, providedCode)) {
        return res.status(403).json({ success: false, error: 'AI 分析密碼不正確', code: 'AI_ACCESS_INVALID' });
      }
    }

    const result = await analyzeCopy(body);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error('copy analysis failed:', error);
    const message = error instanceof Error ? error.message : '文案分析失敗';
    const status = error?.code === 'NO_ANALYSIS_SOURCE' ? 422 : 400;
    return res.status(status).json({ success: false, error: message });
  }
}
