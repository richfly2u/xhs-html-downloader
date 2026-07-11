import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import app from '../src/index.js';

async function withServer(fn) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/health returns service metadata', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.service, 'xhs-html-downloader');
    assert.equal(body.version, '0.4.5');
    assert.equal(typeof body.mediaProxyEnabled, 'boolean');
  });
});

test('POST /api/parse rejects unsupported platforms with a JSON error', async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/parse`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/video/123' })
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.success, false);
    assert.match(body.error, /不支援|支援/);
  });
});
