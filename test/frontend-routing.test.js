import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('前端所有平台都使用統一解析端點', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /endpoint\s*=\s*isYT\s*\?\s*['"]\/api\/youtube['"]/);
  assert.match(source, /fetch\(endpoint/);
  assert.match(source, /endpoint\s*=\s*['"]\/api\/parse['"]/);
});
