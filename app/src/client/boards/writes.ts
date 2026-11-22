import type { Board, BoardChanges, CreateTile, PatchBoard, PatchTile } from '@relaacja/shared';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { api, ApiError } from '../api.ts';
import { applyChanges, TREE_KEY, type CachedTree } from './data.ts';

/** One editor change. Boards are named by ID: the revision is read when the write is sent. */
export type BoardWrite =
  | { op: 'createTile'; boardId: string; input: Omit<CreateTile, 'rev'> }
  | { op: 'patchTile'; boardId: string; tileId: string; input: Omit<PatchTile, 'rev'> }
  | { op: 'deleteTile'; boardId: string; tileId: string }
  | {
      op: 'moveTile';
      boardId: string;
      tileId: string;
      toBoardId: string;
      row: number;
      col: number;
    }
  | { op: 'patchBoard'; boardId: string; input: Omit<PatchBoard, 'rev'> };

const MESSAGES: Record<string, string> = {
  conflict:
    'Tablica zmieniła się w międzyczasie (np. na innym urządzeniu). Wczytano aktualną wersję — spróbuj jeszcze raz.',
  not_found: 'Tego kafelka lub tablicy już nie ma. Wczytano aktualną wersję.',
  cell_occupied: 'To pole jest już zajęte.',
  out_of_bounds:
    'Część kafelków nie zmieści się w mniejszej siatce. Najpierw je przenieś lub usuń.',
  invalid_move: 'Folderu nie można przenieść do niego samego ani do jego podfolderu.',
  too_deep: 'Za dużo poziomów folderów (najwyżej 10).',
  quota_exceeded: 'Osiągnięto limit konta: 500 tablic i 20 000 kafelków.',
  unknown_symbol: 'Wybranego obrazka już nie ma.',
  extra_set_not_enabled: 'Ten zestaw symboli nie jest dostępny na tym koncie.',
  rate_limited: 'Za dużo zmian w krótkim czasie. Odczekaj chwilę.',
};

export function writeProblem(err: unknown): string {
  return (
    (err instanceof ApiError && MESSAGES[err.code]) ||
    'Nie udało się zapisać zmiany. Sprawdź połączenie z internetem.'
  );
}

function boardOf(queryClient: QueryClient, id: string): Board {
  const board = queryClient
    .getQueryData<CachedTree>(TREE_KEY)
    ?.tree.boards.find((b) => b.id === id);
  if (!board) throw new ApiError(404, 'not_found');
  return board;
}

function send(queryClient: QueryClient, write: BoardWrite): Promise<BoardChanges> {
  const rev = boardOf(queryClient, write.boardId).rev;
  switch (write.op) {
    case 'createTile':
      return api(`/api/boards/${write.boardId}/tiles`, {
        method: 'POST',
        json: { ...write.input, rev },
      });
    case 'patchTile':
      return api(`/api/tiles/${write.tileId}`, { method: 'PATCH', json: { ...write.input, rev } });
    case 'deleteTile':
      return api(`/api/tiles/${write.tileId}?rev=${rev}`, { method: 'DELETE' });
    case 'patchBoard':
      return api(`/api/boards/${write.boardId}`, {
        method: 'PATCH',
        json: { ...write.input, rev },
      });
    case 'moveTile': {
      const other = write.toBoardId !== write.boardId;
      return api('/api/tiles/move', {
        method: 'POST',
        json: {
          tileId: write.tileId,
          rev,
          toBoardId: write.toBoardId,
          ...(other ? { toRev: boardOf(queryClient, write.toBoardId).rev } : {}),
          row: write.row,
          col: write.col,
        },
      });
    }
  }
}

/** Dragging within a board shows the result at once; the server answer replaces it. */
function moveLocally(queryClient: QueryClient, write: BoardWrite): void {
  if (write.op !== 'moveTile' || write.toBoardId !== write.boardId) return;
  queryClient.setQueryData<CachedTree>(TREE_KEY, (cached) => {
    if (!cached) return cached;
    const boards = cached.tree.boards.map((board) => {
      if (board.id !== write.boardId) return board;
      const moving = board.tiles.find((t) => t.id === write.tileId);
      if (!moving) return board;
      const tiles = board.tiles.map((t) => {
        if (t.id === moving.id) return { ...t, row: write.row, col: write.col };
        if (t.row === write.row && t.col === write.col)
          return { ...t, row: moving.row, col: moving.col };
        return t;
      });
      return { ...board, tiles };
    });
    return { ...cached, tree: { ...cached.tree, boards } };
  });
}

/**
 * Editor writes, one at a time: each one reads the board revision only after the previous
 * answer was applied, so quick successive edits never trip over their own revision.
 * A failed write reloads the tree (another device may have changed it).
 */
export function useBoardWrites() {
  const queryClient = useQueryClient();
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [pending, setPending] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const write = useCallback(
    (change: BoardWrite): Promise<BoardChanges | null> => {
      moveLocally(queryClient, change);
      setPending((n) => n + 1);
      const run = queue.current.then(async () => {
        try {
          const changes = await send(queryClient, change);
          applyChanges(queryClient, changes);
          setProblem(null);
          return changes;
        } catch (err) {
          setProblem(writeProblem(err));
          await queryClient.invalidateQueries({ queryKey: TREE_KEY });
          return null;
        } finally {
          setPending((n) => n - 1);
        }
      });
      queue.current = run;
      return run;
    },
    [queryClient],
  );

  return { write, saving: pending > 0, problem, dismiss: () => setProblem(null) };
}
