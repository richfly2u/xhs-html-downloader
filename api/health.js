export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    ok: true,
    service: 'xhs-html-downloader',
    version: '0.3.1',
    runtime: 'vercel-node-function'
  });
}
