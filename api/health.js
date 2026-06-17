export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    service: 'xhs-html-downloader',
    version: '0.4.0',
    runtime: 'vercel-node-function',
    aiConfigured: Boolean(process.env.OPENAI_API_KEY)
  });
}
