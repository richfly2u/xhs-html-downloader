import { createHash, timingSafeEqual } from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';

export function extractFirstUrl(input = '') {
  const text = String(input).trim();
  const match = text.match(/https?:\/\/[^\s<>"'，。！？、）\]]+/i);
  if (!match) return null;
  return match[0].replace(/[),.;!?，。！？、]+$/u, '');
}

export function normalizeEscapedUrl(value = '') {
  return String(value)
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003D/gi, '=')
    .replace(/\\u003F/gi, '?')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/\\x26/gi, '&')
    .trim();
}

export function assertHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('網址格式不正確');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('只支援 HTTP 或 HTTPS 網址');
  }
  if (parsed.username || parsed.password) {
    throw new Error('網址不得包含帳號或密碼');
  }
  return parsed;
}

function isPrivateIPv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(Number.isNaN)) return true;
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIPv6(address) {
  const normalized = address.toLowerCase();
  return (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb')
  );
}

export async function assertPublicResolution(hostname) {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error('無法解析目標網域');
  for (const record of records) {
    const version = net.isIP(record.address);
    if ((version === 4 && isPrivateIPv4(record.address)) || (version === 6 && isPrivateIPv6(record.address))) {
      throw new Error('目標網域解析到內部網路位址，已拒絕請求');
    }
  }
}

export function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
}

export function safeFilename(value = 'media', fallback = 'media') {
  const cleaned = String(value)
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

// --- shared helpers for Vercel API handlers & Express ---

export function secureDigest(value) {
  return createHash('sha256').update(String(value || ''), 'utf8').digest();
}

export function codesEqual(left, right) {
  return timingSafeEqual(secureDigest(left), secureDigest(right));
}

export function getProvidedCode(req, body) {
  const headerCode = req.headers?.['x-ai-access-code'] ?? req.get?.('x-ai-access-code');
  if (typeof headerCode === 'string' && headerCode.trim()) return headerCode.trim();
  if (Array.isArray(headerCode) && headerCode[0]) return String(headerCode[0]).trim();
  if (typeof body?.accessCode === 'string' && body.accessCode.trim()) return body.accessCode.trim();
  return '';
}

export function parseRequestBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  if (Buffer.isBuffer(req.body)) {
    try { return JSON.parse(req.body.toString('utf8')); } catch { return {}; }
  }
  return {};
}
