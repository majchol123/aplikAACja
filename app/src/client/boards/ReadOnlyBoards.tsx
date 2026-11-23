import { cellAt, type Board, type BoardTree, type Me } from '@relaacja/shared';
import { useMemo, useState, type CSSProperties } from 'react';
import { TileView } from '../comm/TileView.tsx';
import { BoardNav } from './BoardNav.tsx';
import { useSymbolResolver } from './data.ts';
import { useGridLayout } from './layout.ts';

/**
 * A board tree to look at, not to use: folders open, tiles neither speak nor change.
 * The admin data view and received shares show other people's boards this way;
 * `ownUrl` (stable) says where their photos come from.
 */
export function ReadOnlyBoards({
  me,
  tree,
  ownUrl,
  empty,
}: {
  me: Me;
  tree: BoardTree;
  ownUrl: (key: string) => string;
  empty: string;
}) {
  const boards = useMemo(() => new Map(tree.boards.map((b) => [b.id, b])), [tree.boards]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const homeId = tree.homeId;
  const board = boards.get(boardId ?? homeId ?? '') ?? (homeId ? boards.get(homeId) : undefined);
  if (!homeId || !board) return <p className="mt-3 text-slate-600">{empty}</p>;
  return (
    <div className="mt-3">
      <BoardNav boards={boards} board={board} homeId={homeId} onOpen={setBoardId} />
      <Grid me={me} board={board} ownUrl={ownUrl} onOpen={setBoardId} />
      <p className="mt-2 text-sm text-slate-600">
        Podgląd tylko do odczytu: foldery się otwierają, kafelki nie mówią.
        {!me.extraSet &&
          ' Zamiast symboli dodatkowego zestawu widać podobne symbole ARASAAC, dobrane po napisie.'}
      </p>
    </div>
  );
}

function Grid({
  me,
  board,
  ownUrl,
  onOpen,
}: {
  me: Me;
  board: Board;
  ownUrl: (key: string) => string;
  onOpen: (boardId: string) => void;
}) {
  const resolve = useSymbolResolver(me, board.tiles, ownUrl);
  const at = new Map(board.tiles.map((t) => [`${t.row},${t.col}`, t]));
  const layout = useGridLayout(board);
  return (
    <div className="mt-3 h-[min(60dvh,30rem)] rounded-2xl bg-slate-100 p-2">
      <div className="board-area h-full">
        <div
          className="board-grid"
          style={{ '--cols': layout.cols, '--rows': layout.rows } as CSSProperties}
          data-testid="preview-grid"
        >
          {Array.from({ length: layout.rows * layout.cols }, (_, i) => {
            const { row, col } = cellAt(layout, i);
            const tile = at.get(`${row},${col}`);
            return (
              <div key={`${row},${col}`} className="tile-cell">
                {tile && (
                  // Hidden tiles: dimmed and marked, as in edit mode.
                  <div className={`relative size-full ${tile.hidden ? 'tile-hidden' : ''}`}>
                    <TileView
                      tile={tile}
                      src={resolve(tile.symbol)}
                      ariaLabel={`${tile.kind === 'folder' ? `Otwórz folder ${tile.label}` : tile.label}${tile.hidden ? ' (ukryty)' : ''}`}
                      onClick={
                        tile.targetBoardId ? () => onOpen(tile.targetBoardId as string) : undefined
                      }
                    />
                    {tile.hidden && (
                      <span className="tile-hidden-badge" aria-hidden="true">
                        ukryty
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
