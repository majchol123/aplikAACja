import { TapFilter, type Board, type BoardTree, type Me, type Tile } from '@relaacja/shared';
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { useSymbolResolver } from '../boards/data.ts';
import { useDeviceSettings } from '../device.ts';
import { useSpeaker } from '../speech.ts';
import { useAccountSettings } from '../settings.ts';
import { ArrowBackIcon, BackspaceIcon, HomeIcon, LockIcon, PlayIcon, TrashIcon } from './icons.tsx';
import { TileView } from './TileView.tsx';
import { useWakeLock } from './wake-lock.ts';

interface SentenceItem {
  key: number;
  label: string;
  src: string | null;
}

const HOLD_MS = 2000;

/** Child's view: grid of the current board, sentence bar, folder navigation (PLAN §2.1). */
export function Communication({
  me,
  tree,
  onParentMode,
}: {
  me: Me;
  tree: BoardTree;
  onParentMode: () => void;
}) {
  const boards = useMemo(() => new Map(tree.boards.map((b) => [b.id, b])), [tree.boards]);
  const homeId = tree.homeId ?? '';
  const [currentId, setCurrentId] = useState(homeId);
  // A board deleted on another device: fall back to the home board.
  const board = boards.get(currentId) ?? boards.get(homeId);
  const [sentence, setSentence] = useState<SentenceItem[]>([]);
  const nextKey = useRef(0);
  const speak = useSpeaker();
  const [device] = useDeviceSettings();
  const account = useAccountSettings();
  const allTiles = useMemo(() => tree.boards.flatMap((b) => b.tiles), [tree.boards]);
  const resolve = useSymbolResolver(me, allTiles);
  useWakeLock();

  if (!board) return null;

  const path: Board[] = [];
  for (let b: Board | undefined = board; b; b = b.parentId ? boards.get(b.parentId) : undefined) {
    path.unshift(b);
    if (path.length > 20) break;
  }

  function activate(tile: Tile): void {
    if (tile.kind === 'folder') {
      if (tile.targetBoardId && boards.has(tile.targetBoardId)) setCurrentId(tile.targetBoardId);
      return;
    }
    setSentence((items) => [
      ...items,
      { key: nextKey.current++, label: tile.label, src: resolve(tile.symbol) },
    ]);
    if (device.speakOnTap) speak(tile.label);
    if ((account.data?.returnToHome ?? true) && board?.parentId) setCurrentId(homeId);
  }

  const speakSentence = () => speak(sentence.map((i) => i.label).join(' '));

  return (
    <main className="comm-root flex h-dvh flex-col gap-2 bg-slate-100 p-2 sm:gap-3 sm:p-3">
      <h1 className="sr-only">Tablica: {board.name}</h1>
      <SentenceBar
        items={sentence}
        onSpeak={speakSentence}
        onBackspace={() => setSentence((items) => items.slice(0, -1))}
        onClear={() => setSentence([])}
      />
      <nav className="flex items-center gap-2" aria-label="Nawigacja po tablicach">
        <NavButton label="Pulpit" disabled={!board.parentId} onClick={() => setCurrentId(homeId)}>
          <HomeIcon />
        </NavButton>
        <NavButton
          label="Wstecz"
          disabled={!board.parentId}
          onClick={() => board.parentId && setCurrentId(board.parentId)}
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
                  onClick={() => setCurrentId(b.id)}
                >
                  {b.name}
                </button>
              )}
            </li>
          ))}
        </ol>
        <ParentLock onUnlock={onParentMode} />
      </nav>
      <BoardGrid
        board={board}
        resolve={resolve}
        uppercase={account.data?.uppercaseLabels ?? false}
        onActivate={activate}
      />
    </main>
  );
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

function SentenceBar({
  items,
  onSpeak,
  onBackspace,
  onClear,
}: {
  items: SentenceItem[];
  onSpeak: () => void;
  onBackspace: () => void;
  onClear: () => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ left: scroller.current.scrollWidth, behavior: 'smooth' });
  }, [items.length]);
  const empty = items.length === 0;
  return (
    <div className="flex h-24 shrink-0 items-stretch gap-2 sm:h-28">
      <div
        ref={scroller}
        role="button"
        tabIndex={0}
        aria-label={
          empty ? 'Pasek zdania jest pusty' : `Zdanie: ${items.map((i) => i.label).join(' ')}`
        }
        onClick={onSpeak}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSpeak()}
        data-testid="sentence"
        className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto rounded-2xl bg-white px-3 shadow-sm ring-1 ring-slate-200"
      >
        {items.map((item) => (
          <span
            key={item.key}
            className="flex h-full max-h-24 shrink-0 flex-col items-center justify-center py-1"
            data-testid="sentence-item"
          >
            {item.src && (
              <img
                src={item.src}
                alt=""
                draggable={false}
                className="min-h-0 w-16 flex-1 object-contain"
              />
            )}
            <span className="text-base font-bold leading-tight text-slate-800">{item.label}</span>
          </span>
        ))}
      </div>
      <BarButton label="Usuń ostatnie słowo" disabled={empty} onClick={onBackspace}>
        <BackspaceIcon />
      </BarButton>
      <BarButton label="Wyczyść zdanie" disabled={empty} onClick={onClear}>
        <TrashIcon />
      </BarButton>
      <BarButton label="Powiedz zdanie" disabled={empty} onClick={onSpeak} primary>
        <PlayIcon />
      </BarButton>
    </div>
  );
}

function BarButton({
  label,
  disabled,
  onClick,
  primary = false,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-16 shrink-0 items-center justify-center rounded-2xl shadow-sm sm:w-20 disabled:opacity-35 ${
        primary ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

/** Lifting the finger this far outside the tile still counts as a tap on it (PLAN §2.5). */
const SLOP_PX = 12;
const FLASH_MS = 150;

/** Grid of one board. Pointer input goes through the device's motor settings. */
function BoardGrid({
  board,
  resolve,
  uppercase,
  onActivate,
}: {
  board: Board;
  resolve: (symbol: Tile['symbol']) => string | null;
  uppercase: boolean;
  onActivate: (tile: Tile) => void;
}) {
  const [device] = useDeviceSettings();
  const filter = useRef<TapFilter | null>(null);
  filter.current ??= new TapFilter(device.motor);
  useEffect(() => filter.current?.configure(device.motor), [device.motor]);

  const byId = useMemo(() => new Map(board.tiles.map((t) => [t.id, t])), [board.tiles]);
  const cells = useMemo(() => {
    const at = new Map(board.tiles.map((t) => [`${t.row},${t.col}`, t]));
    return Array.from({ length: board.rows * board.cols }, (_, i) => ({
      key: i,
      tile: at.get(`${Math.floor(i / board.cols)},${i % board.cols}`),
    }));
  }, [board]);

  // Where each pointer went down: the tile and its box (touch pointers are captured by that
  // element, so the lift position is compared with the box instead of hit-testing).
  const starts = useRef(new Map<number, { id: string | null; box: DOMRect | null }>());
  const [held, setHeld] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);
  const holdMs = device.motor.activateOn === 'release' ? device.motor.minHoldMs : 0;

  const fire = (id: string | null) => {
    const tile = id ? byId.get(id) : undefined;
    if (!tile) return;
    if (device.feedback) {
      navigator.vibrate?.(20);
      setFlash(tile.id);
      window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_MS);
    }
    onActivate(tile);
  };
  const onPointerDown = (e: PointerEvent) => {
    const el = (e.target as Element).closest<HTMLElement>('[data-tile]');
    const id = el?.dataset.tile ?? null;
    starts.current.set(e.pointerId, { id, box: el?.getBoundingClientRect() ?? null });
    if (holdMs > 0 && starts.current.size === 1) setHeld(id);
    fire(filter.current?.down(e.pointerId, id, e.timeStamp) ?? null);
  };
  const onPointerUp = (e: PointerEvent) => {
    const start = starts.current.get(e.pointerId);
    starts.current.delete(e.pointerId);
    setHeld(null);
    const box = start?.box;
    const inside =
      box &&
      e.clientX >= box.left - SLOP_PX &&
      e.clientX <= box.right + SLOP_PX &&
      e.clientY >= box.top - SLOP_PX &&
      e.clientY <= box.bottom + SLOP_PX;
    fire(filter.current?.up(e.pointerId, inside ? (start?.id ?? null) : null, e.timeStamp) ?? null);
  };
  const onPointerCancel = (e: PointerEvent) => {
    starts.current.delete(e.pointerId);
    setHeld(null);
    filter.current?.cancel(e.pointerId);
  };

  return (
    <div
      className="grid min-h-0 flex-1 gap-2 sm:gap-3"
      style={{
        gridTemplateColumns: `repeat(${board.cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${board.rows}, minmax(0, 1fr))`,
      }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(e) => e.preventDefault()}
      // Keyboard and switch access: a click without a pointer (detail 0) activates directly.
      onClick={(e) => {
        if (e.detail !== 0) return;
        const id = (e.target as HTMLElement).closest<HTMLElement>('[data-tile]')?.dataset.tile;
        fire(id ?? null);
      }}
      data-testid="board-grid"
    >
      {cells.map(({ key, tile }) => (
        <div key={key} className="tile-cell">
          {tile && (
            <TileView
              tile={tile}
              src={resolve(tile.symbol)}
              uppercase={uppercase}
              flash={flash === tile.id}
              holdMs={held === tile.id ? holdMs : 0}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** Parent mode only after holding the button for 2 s, so a child does not open it by chance. */
function ParentLock({ onUnlock }: { onUnlock: () => void }) {
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const start = () => {
    window.clearTimeout(timer.current);
    setHolding(true);
    setHint(false);
    timer.current = window.setTimeout(() => {
      setHolding(false);
      onUnlock();
    }, HOLD_MS);
  };
  const stop = () => {
    if (timer.current === undefined) return;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (holding) setHint(true);
    setHolding(false);
  };

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Tryb rodzica (przytrzymaj 2 sekundy)"
        data-holding={holding}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !e.repeat && start()}
        onKeyUp={stop}
        onContextMenu={(e) => e.preventDefault()}
        className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white text-slate-500 shadow-sm ring-1 ring-slate-200"
      >
        <LockIcon />
        <span className="hold-progress absolute inset-x-0 bottom-0 h-1.5 bg-brand-600" />
      </button>
      {hint && (
        <span
          role="status"
          className="absolute right-0 top-14 z-10 w-max rounded-lg bg-slate-800 px-3 py-2 text-sm text-white"
        >
          Przytrzymaj 2 sekundy
        </span>
      )}
    </div>
  );
}
