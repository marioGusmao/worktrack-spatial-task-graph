import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8')) as {
  id: string;
  name: string;
  version: string;
  authorUrl: string;
};

void test('downstream plugin has an identity distinct from the community plugin', () => {
  assert.equal(manifest.id, 'worktrack-spatial-task-graph');
  assert.equal(manifest.name, 'Spatial Task Graph — WorkTrack');
  assert.equal(manifest.version, '1.1.2-worktrack.1');
  assert.equal(manifest.authorUrl, 'https://github.com/marioGusmao/worktrack-spatial-task-graph');
});
