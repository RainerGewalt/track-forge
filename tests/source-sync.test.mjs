import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyLiveSources, hydratePieceSources, savePieceSource } from '../src/sourceSync.js';

test('live scene sources replace bundled code without changing track structure', () => {
  const pieces = [
    {
      id: 'test-piece',
      scenes: [
        { id: 'main', code: 'bundled main' },
        { id: 'pulse', code: 'bundled pulse' },
      ],
    },
  ];

  const updated = applyLiveSources(pieces, [
    {
      kind: 'scene',
      pieceId: 'test-piece',
      sourceId: 'main',
      path: 'pieces/test-piece/main.strudel',
      code: 'live main',
      revision: 'abc123',
    },
    { kind: 'scene', pieceId: 'unknown', sourceId: 'main', code: 'ignored' },
    { kind: 'sketch', sourceId: 'idea', code: 'ignored sketch' },
  ]);

  assert.equal(updated, 1);
  assert.equal(pieces[0].scenes[0].code, 'live main');
  assert.equal(pieces[0].scenes[0].sourceRevision, 'abc123');
  assert.equal(pieces[0].scenes[1].code, 'bundled pulse');
});

test('hydration fails closed when the source endpoint is not JSON', async () => {
  const pieces = [{ id: 'test-piece', scenes: [{ id: 'main', code: 'bundled' }] }];
  const state = await hydratePieceSources(pieces, {
    fetchImpl: async () =>
      new Response('<html>fallback</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
  });

  assert.deepEqual(state, { available: false, writeEnabled: false, updated: 0 });
  assert.equal(pieces[0].scenes[0].code, 'bundled');
});

test('hydration does not contact a disabled source service', async () => {
  const pieces = [{ id: 'test-piece', scenes: [{ id: 'main', code: 'bundled' }] }];
  let requests = 0;
  const state = await hydratePieceSources(pieces, {
    enabled: false,
    fetchImpl: async () => {
      requests += 1;
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  assert.equal(requests, 0);
  assert.deepEqual(state, { available: false, writeEnabled: false, updated: 0 });
});

test('save sends the tried revision and editor token to the exact scene endpoint', async () => {
  let request = null;
  const result = await savePieceSource(
    {
      pieceId: 'test-piece',
      sceneId: 'main',
      code: 'sound("bd")',
      expectedRevision: 'revision-one',
      editorToken: 'secret-token',
    },
    {
      fetchImpl: async (url, options) => {
        request = { url, options };
        return new Response(
          JSON.stringify({
            source: {
              code: 'sound("bd")',
              revision: 'revision-two',
              path: 'pieces/test-piece/main.strudel',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      },
    },
  );

  assert.equal(result.ok, true);
  assert.equal(request.url, '/api/source/scene/test-piece/main');
  assert.equal(request.options.headers.Authorization, 'Bearer secret-token');
  assert.deepEqual(JSON.parse(request.options.body), {
    code: 'sound("bd")',
    expectedRevision: 'revision-one',
  });
});
