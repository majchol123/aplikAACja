import type { Board } from '@aplikaacja/shared';
import type { ReactNode } from 'react';
import { ArrowBackIcon, HomeIcon } from '../comm/icons.tsx';

/** Home board first, the given board last. */
export function boardPath(boards: Map<string, Board>, board: Board): Board[] {
  const path: Board[] = [];
  for (let b: Board | undefined = board; b; b = b.parentId ? boards.get(b.parentId) : undefined) {
    path.unshift(b);
    if (path.length > 20) break;
  }
  return path;
}

/**
 * Every board reachable from the home board, depth first in reading order, named by its
 * path ("Start › Jedzenie"); boards in `blocked` and below them are left out.
 */
export function boardOptions(
  boards: Map<string, Board>,
  homeId: string,
  blocked: ReadonlySet<string> = new Set(),
): { id: string; name: string }[] {
  const list: { id: string; name: string }[] = [];
  const walk = (boardId: string) => {
    const board = boards.get(boardId);
    if (!board || blocked.has(boardId) || list.length > boards.size) return;
    list.push({
      id: board.id,
      name: boardPath(boards, board)
        .map((b) => b.name)
        .join(' › '),
    });
    for (const t of [...board.tiles].sort((a, b) => a.row - b.row || a.col - b.col)) {
      if (t.targetBoardId) walk(t.targetBoardId);
    }
  };
  walk(homeId);
  return list;
}

function NavButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200 disabled:opacity-35"
    >
      {children}
    </button>
  );
}

/** 🏠, ← and breadcrumbs (PLAN §2.1); `children` go to the right end. */
export function BoardNav({
  boards,
  board,
  homeId,
  onOpen,
  trail = [],
  onBack,
  className = '',
  children,
}: {
  boards: Map<string, Board>;
  board: Board;
  homeId: string;
  onOpen: (boardId: string) => void;
  /** Levels below `board` that are no boards (the folders of "Wszystkie symbole"). */
  trail?: { key: string; name: string; onOpen: () => void }[];
  /** "Wstecz" when `trail` is not empty. */
  onBack?: () => void;
  className?: string;
  children?: ReactNode;
}) {
  const crumbs = [
    ...boardPath(boards, board).map((b) => ({
      key: b.id,
      name: b.name,
      onOpen: () => onOpen(b.id),
    })),
    ...trail,
  ];
  const below = trail.length > 0;
  return (
    <nav
      className={`flex min-w-0 items-center gap-2 ${className}`}
      aria-label="Nawigacja po tablicach"
    >
      <NavButton label="Pulpit" disabled={!board.parentId && !below} onClick={() => onOpen(homeId)}>
        <HomeIcon />
      </NavButton>
      <NavButton
        label="Wstecz"
        disabled={!board.parentId && !below}
        onClick={() => (below ? onBack?.() : board.parentId && onOpen(board.parentId))}
      >
        <ArrowBackIcon />
      </NavButton>
      <ol className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-lg font-semibold text-slate-700">
        {crumbs.map((crumb, i) => (
          <li key={crumb.key} className="flex min-w-0 items-center gap-1">
            {i > 0 && <span aria-hidden="true">›</span>}
            {i === crumbs.length - 1 ? (
              <span className="truncate px-1" aria-current="page" data-testid="current-board">
                {crumb.name}
              </span>
            ) : (
              <button
                type="button"
                className="truncate rounded-lg px-1 underline-offset-4 hover:underline"
                onClick={crumb.onOpen}
              >
                {crumb.name}
              </button>
            )}
          </li>
        ))}
      </ol>
      {children}
    </nav>
  );
}
