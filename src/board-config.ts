import type { Edge, Viewport } from 'reactflow';

export const DEFAULT_WORKSPACE_ROOT = 'Sub pastas/Spatial Task Graph';

export interface TextNodeData {
  id: string;
  text: string;
  x: number;
  y: number;
}

export interface BoardSource {
  folder: string;
  inboxFile: string;
}

export interface BoardFilters {
  tags: string[];
  excludeTags: string[];
  folders: string[];
  status: string[];
  tagMode?: 'AND' | 'OR';
}

export interface GraphBoard {
  id: string;
  name: string;
  source: BoardSource;
  filters: BoardFilters;
  data: {
    layout: Record<string, { x: number; y: number }>;
    edges: Edge[];
    nodeStatus: Record<string, string>;
    textNodes: TextNodeData[];
    viewport?: Viewport;
  };
}

export interface TaskGraphSettings {
  workspaceRoot: string;
  boards: GraphBoard[];
  lastActiveBoardId: string;
  autoFitAfterLayout: boolean;
}

type LegacyGraphBoard = Omit<GraphBoard, 'source'> & { source?: Partial<BoardSource> };
type LegacySettings = Omit<Partial<TaskGraphSettings>, 'boards'> & { boards?: LegacyGraphBoard[] };

export function normalizeVaultPath(path: string): string {
  const segments = path
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && segment !== '.');

  if (segments.length === 0) {
    throw new Error('Vault paths cannot be empty.');
  }
  if (segments.some((segment) => segment === '..')) {
    throw new Error('Vault paths cannot contain parent-directory segments.');
  }

  return segments.join('/');
}

export function isPathWithinWorkspace(path: string, workspaceRoot: string): boolean {
  const normalizedPath = normalizeVaultPath(path);
  const normalizedRoot = normalizeVaultPath(workspaceRoot);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function slugifyBoardName(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'board';
}

export function uniqueBoardFolder(
  workspaceRoot: string,
  boardName: string,
  occupiedFolders: ReadonlySet<string>,
): string {
  const root = normalizeVaultPath(workspaceRoot);
  const base = `${root}/${slugifyBoardName(boardName)}`;
  let candidate = base;
  let suffix = 2;

  while (occupiedFolders.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

export function storageDirectories(folder: string): string[] {
  const segments = normalizeVaultPath(folder).split('/');
  const directories: string[] = [];
  for (let index = 1; index <= segments.length; index += 1) {
    directories.push(segments.slice(0, index).join('/'));
  }
  return directories;
}

export interface BoardStorageHost {
  exists(path: string): Promise<boolean>;
  createFolder(path: string): Promise<void>;
  createFile(path: string, content: string): Promise<void>;
}

export async function ensureBoardStorage(host: BoardStorageHost, board: GraphBoard): Promise<void> {
  for (const folder of storageDirectories(board.source.folder)) {
    if (!await host.exists(folder)) {
      await host.createFolder(folder);
    }
  }
  if (!await host.exists(board.source.inboxFile)) {
    await host.createFile(board.source.inboxFile, '# Inbox\n');
  }
}

export interface CreateBoardDefinitionOptions {
  id: string;
  name: string;
  workspaceRoot: string;
  occupiedFolders?: ReadonlySet<string>;
  folder?: string;
}

export function createBoardDefinition(options: CreateBoardDefinitionOptions): GraphBoard {
  const occupied = options.occupiedFolders ?? new Set<string>();
  const folder = options.folder
    ? normalizeVaultPath(options.folder)
    : uniqueBoardFolder(options.workspaceRoot, options.name, occupied);

  if (!isPathWithinWorkspace(folder, options.workspaceRoot)) {
    throw new Error('Board storage must stay inside the configured workspace root.');
  }

  return {
    id: options.id,
    name: options.name,
    source: {
      folder,
      inboxFile: `${folder}/Inbox.md`,
    },
    filters: {
      tags: [],
      excludeTags: [],
      folders: [folder],
      status: [' ', '/'],
      tagMode: 'OR',
    },
    data: {
      layout: {},
      edges: [],
      nodeStatus: {},
      textNodes: [],
    },
  };
}

export async function createBoardDefinitionWithAvailableFolder(
  options: CreateBoardDefinitionOptions,
  pathExists: (path: string) => Promise<boolean>,
): Promise<GraphBoard> {
  const occupied = new Set(options.occupiedFolders ?? []);
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const board = createBoardDefinition({ ...options, occupiedFolders: occupied });
    if (!await pathExists(board.source.folder)) return board;
    occupied.add(board.source.folder);
  }
  throw new Error('Could not allocate a unique board folder.');
}

export const DEFAULT_BOARD: GraphBoard = createBoardDefinition({
  id: 'default',
  name: 'Main board',
  workspaceRoot: DEFAULT_WORKSPACE_ROOT,
  folder: DEFAULT_WORKSPACE_ROOT,
});

export const DEFAULT_SETTINGS: TaskGraphSettings = {
  workspaceRoot: DEFAULT_WORKSPACE_ROOT,
  boards: [DEFAULT_BOARD],
  lastActiveBoardId: 'default',
  autoFitAfterLayout: true,
};

export function migrateSettings(input: LegacySettings | null | undefined): TaskGraphSettings {
  const workspaceRoot = DEFAULT_WORKSPACE_ROOT;
  const legacyBoards = input?.boards && input.boards.length > 0 ? input.boards : [DEFAULT_BOARD];
  const occupiedFolders = new Set<string>();

  const boards = legacyBoards.map((legacyBoard, index) => {
    const configuredFolder = legacyBoard.source?.folder || legacyBoard.filters?.folders?.[0];
    let folder: string;
    let normalizedConfiguredFolder: string | undefined;
    try {
      normalizedConfiguredFolder = configuredFolder ? normalizeVaultPath(configuredFolder) : undefined;
    } catch {
      normalizedConfiguredFolder = undefined;
    }

    if (normalizedConfiguredFolder && isPathWithinWorkspace(normalizedConfiguredFolder, workspaceRoot)) {
      folder = normalizedConfiguredFolder;
    } else if (legacyBoard.id === 'default' || index === 0) {
      folder = workspaceRoot;
    } else {
      folder = uniqueBoardFolder(workspaceRoot, legacyBoard.name, occupiedFolders);
    }
    occupiedFolders.add(folder);

    const configuredInbox = legacyBoard.source?.inboxFile;
    let normalizedInbox: string | undefined;
    try {
      normalizedInbox = configuredInbox ? normalizeVaultPath(configuredInbox) : undefined;
    } catch {
      normalizedInbox = undefined;
    }
    const inboxFile = normalizedInbox && isPathWithinWorkspace(normalizedInbox, folder)
      ? normalizedInbox
      : `${folder}/Inbox.md`;

    return {
      id: legacyBoard.id,
      name: legacyBoard.name,
      source: { folder, inboxFile },
      filters: {
        tags: [...(legacyBoard.filters?.tags ?? [])],
        excludeTags: [...(legacyBoard.filters?.excludeTags ?? [])],
        folders: [folder],
        status: [...(legacyBoard.filters?.status ?? [' ', '/'])],
        tagMode: legacyBoard.filters?.tagMode === 'AND' ? 'AND' : 'OR',
      },
      data: {
        layout: { ...(legacyBoard.data?.layout ?? {}) },
        edges: [...(legacyBoard.data?.edges ?? [])],
        nodeStatus: { ...(legacyBoard.data?.nodeStatus ?? {}) },
        textNodes: [...(legacyBoard.data?.textNodes ?? [])],
        ...(legacyBoard.data?.viewport ? { viewport: { ...legacyBoard.data.viewport } } : {}),
      },
    } satisfies GraphBoard;
  });

  const requestedActiveBoard = input?.lastActiveBoardId;
  const lastActiveBoardId = boards.some((board) => board.id === requestedActiveBoard)
    ? requestedActiveBoard as string
    : boards[0]?.id ?? 'default';

  return {
    workspaceRoot,
    boards,
    lastActiveBoardId,
    autoFitAfterLayout: input?.autoFitAfterLayout ?? true,
  };
}
