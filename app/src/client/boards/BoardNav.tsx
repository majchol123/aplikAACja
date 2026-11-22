import type { Board } from '@relaacja/shared';
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
  className = '',
  children,
}: {
  boards: Map<string, Board>;
  board: Board;
  homeId: string;
  onOpen: (boardId: string) => void;
  className?: string;
  children?: ReactNode;
}) {
  const path = boardPath(boards, board);
  return (
    <nav
      className={`flex min-w-0 items-center gap-2 ${className}`}
      aria-label="Nawigacja po tablicach"
    >
      <NavButton label="Pulpit" disabled={!board.parentId} onClick={() => onOpen(homeId)}>
        <HomeIcon />
      </NavButton>
      <NavButton
        label="Wstecz"
        disabled={!board.parentId}
        onClick={() => board.parentId && onOpen(board.parentId)}
      >
        <ArrowBackIcon />
      </NavButton>
      <ol className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-lg font-semibold text-slate-700">
        {path.map((b, i) => (
          <li key={b.id} className="flex min-w-0 items-center gap-1">
            {i > 0 && <span aria-hidden="true">›</span>}
            {i === path.length - 1 ? (
              <span className="truncate" aria-current="page" data-testid="current-board">
                {b.name}
              </span>
            ) : (
              <button
                type="button"
                className="truncate rounded-lg px-1 underline-offset-4 hover:underline"
                onClick={() => onOpen(b.id)}
              >
                {b.name}
              </button>
            )}
          </li>
        ))}
      </ol>
      {children}
    </nav>
  );
}
