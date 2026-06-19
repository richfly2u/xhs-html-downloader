function aiProvider() {
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return null;
}

export default function handler(req, res) {
  const provider = aiProvider();
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    service: 'xhs-html-downloader',
    version: '0.4.5',
    runtime: 'vercel-node-function',
    aiConfigured: Boolean(provider),
    aiProvider: provider,
    aiAccessProtected: Boolean(String(process.env.AI_ACCESS_CODE || '').trim())
  });
}
