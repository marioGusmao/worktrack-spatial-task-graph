import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_WORKSPACE_ROOT,
  createBoardDefinition,
  ensureBoardStorage,
  isPathWithinWorkspace,
  migrateSettings,
  storageDirectories,
  uniqueBoardFolder,
} from '../src/board-config.ts';

void test('default workspace is isolated from the rest of the vault', () => {
  assert.equal(DEFAULT_WORKSPACE_ROOT, 'Sub pastas/Spatial Task Graph');
  assert.equal(isPathWithinWorkspace('Sub pastas/Spatial Task Graph/Inbox.md', DEFAULT_WORKSPACE_ROOT), true);
  assert.equal(isPathWithinWorkspace('Sub pastas/Spatial Task Graphical/Inbox.md', DEFAULT_WORKSPACE_ROOT), false);
  assert.equal(isPathWithinWorkspace('Sub pastas/Tarefas/Inbox.md', DEFAULT_WORKSPACE_ROOT), false);
});

void test('new boards receive a dedicated folder and inbox', () => {
  const board = createBoardDefinition({
    id: 'board-2',
    name: 'Área Fiscal',
    workspaceRoot: DEFAULT_WORKSPACE_ROOT,
  });

  assert.deepEqual(board.source, {
    folder: 'Sub pastas/Spatial Task Graph/area-fiscal',
    inboxFile: 'Sub pastas/Spatial Task Graph/area-fiscal/Inbox.md',
  });
  assert.deepEqual(board.filters.folders, ['Sub pastas/Spatial Task Graph/area-fiscal']);
  assert.deepEqual(board.data, { layout: {}, edges: [], nodeStatus: {}, textNodes: [] });
});

void test('legacy settings migrate without exposing the whole vault', () => {
  const migrated = migrateSettings({
    boards: [
      {
        id: 'default',
        name: 'Main board',
        filters: { tags: [], excludeTags: [], folders: [], status: [' ', '/'], tagMode: 'OR' },
        data: { layout: {}, edges: [], nodeStatus: {}, textNodes: [] },
      },
      {
        id: 'other',
        name: 'Board 2',
        filters: { tags: [], excludeTags: [], folders: [], status: [' ', '/'], tagMode: 'OR' },
        data: { layout: {}, edges: [], nodeStatus: {}, textNodes: [] },
      },
    ],
    lastActiveBoardId: 'other',
    autoFitAfterLayout: true,
  });

  assert.equal(migrated.workspaceRoot, DEFAULT_WORKSPACE_ROOT);
  assert.deepEqual(migrated.boards[0]?.source, {
    folder: DEFAULT_WORKSPACE_ROOT,
    inboxFile: `${DEFAULT_WORKSPACE_ROOT}/Inbox.md`,
  });
  assert.deepEqual(migrated.boards[0]?.filters.folders, [DEFAULT_WORKSPACE_ROOT]);
  assert.deepEqual(migrated.boards[1]?.source, {
    folder: `${DEFAULT_WORKSPACE_ROOT}/board-2`,
    inboxFile: `${DEFAULT_WORKSPACE_ROOT}/board-2/Inbox.md`,
  });
  assert.deepEqual(migrated.boards[1]?.filters.folders, [`${DEFAULT_WORKSPACE_ROOT}/board-2`]);
  assert.equal(migrated.lastActiveBoardId, 'other');
});

void test('existing in-root board folders are preserved during migration', () => {
  const migrated = migrateSettings({
    workspaceRoot: DEFAULT_WORKSPACE_ROOT,
    boards: [
      {
        id: 'default',
        name: 'Main board',
        filters: {
          tags: [],
          excludeTags: [],
          folders: [`${DEFAULT_WORKSPACE_ROOT}/Hermes`],
          status: [' ', '/'],
          tagMode: 'OR',
        },
        data: { layout: {}, edges: [], nodeStatus: {}, textNodes: [] },
      },
    ],
    lastActiveBoardId: 'default',
    autoFitAfterLayout: true,
  });

  assert.deepEqual(migrated.boards[0]?.source, {
    folder: `${DEFAULT_WORKSPACE_ROOT}/Hermes`,
    inboxFile: `${DEFAULT_WORKSPACE_ROOT}/Hermes/Inbox.md`,
  });
});

void test('board folders remain unique after a board is deleted and recreated', () => {
  const occupied = new Set([`${DEFAULT_WORKSPACE_ROOT}/board-2`]);
  assert.equal(
    uniqueBoardFolder(DEFAULT_WORKSPACE_ROOT, 'Board 2', occupied),
    `${DEFAULT_WORKSPACE_ROOT}/board-2-2`,
  );
});

void test('storage creation is idempotent and never overwrites an existing inbox', async () => {
  const existing = new Set<string>(['Sub pastas']);
  const createdFolders: string[] = [];
  const createdFiles: [string, string][] = [];
  const host = {
    exists: async (path: string) => existing.has(path),
    createFolder: async (path: string) => { createdFolders.push(path); existing.add(path); },
    createFile: async (path: string, content: string) => { createdFiles.push([path, content]); existing.add(path); },
  };
  const board = createBoardDefinition({ id: 'h', name: 'Hermes', workspaceRoot: DEFAULT_WORKSPACE_ROOT });

  await ensureBoardStorage(host, board);
  await ensureBoardStorage(host, board);

  assert.deepEqual(createdFolders, [
    DEFAULT_WORKSPACE_ROOT,
    `${DEFAULT_WORKSPACE_ROOT}/hermes`,
  ]);
  assert.deepEqual(createdFiles, [[`${DEFAULT_WORKSPACE_ROOT}/hermes/Inbox.md`, '# Inbox\n']]);
});

void test('storage directory plan is parent-first and vault-relative', () => {
  assert.deepEqual(storageDirectories('Sub pastas/Spatial Task Graph/Hermes'), [
    'Sub pastas',
    'Sub pastas/Spatial Task Graph',
    'Sub pastas/Spatial Task Graph/Hermes',
  ]);
});
