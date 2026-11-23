import { cellAt, TapFilter, type Board, type Tile } from '@aplikaacja/shared';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useGridAttributes, useGridLayout } from '../boards/layout.ts';
import { useDeviceSettings } from '../device.ts';
import { TileView } from './TileView.tsx';

/** Lifting the finger this far outside the tile still counts as a tap on it (PLAN §2.5). */
const SLOP_PX = 12;
const FLASH_MS = 150;

/** Grid of one board. Pointer input goes through the device's motor settings. */
export function BoardGrid({
  board,
  srcOf,
  uppercase,
  found,
  onActivate,
}: {
  board: Board;
  /** The tile's picture. */
  srcOf: (tile: Tile) => string | null;
  uppercase: boolean;
  /** Tile found with the search, shown with a ring. */
  found: string | null;
  onActivate: (tile: Tile) => void;
}) {
  const [device] = useDeviceSettings();
  const filter = useRef<TapFilter | null>(null);
  filter.current ??= new TapFilter(device.motor);
  useEffect(() => filter.current?.configure(device.motor), [device.motor]);

  // Hidden tiles leave their cell empty: nothing else moves (motor planning).
  const shown = useMemo(() => board.tiles.filter((t) => !t.hidden), [board.tiles]);
  const byId = useMemo(() => new Map(shown.map((t) => [t.id, t])), [shown]);
  const layout = useGridLayout(board);
  const gridAttributes = useGridAttributes(layout);
  const area = useRef<HTMLDivElement>(null);
  // Another board starts at its top; a tile found with the search is scrolled into view.
  // Block bodies: scroll methods return a promise in newer browsers, not a cleanup.
  useLayoutEffect(() => {
    area.current?.scrollTo({ top: 0 });
  }, [board.id]);
  useEffect(() => {
    if (found)
      area.current?.querySelector(`[data-tile="${found}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [found]);
  const cells = useMemo(() => {
    const at = new Map(shown.map((t) => [`${t.row},${t.col}`, t]));
    return Array.from({ length: layout.rows * layout.cols }, (_, i) => {
      const { row, col } = cellAt(layout, i);
      return { key: `${row},${col}`, tile: at.get(`${row},${col}`) };
    });
  }, [layout, shown]);

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
    <div ref={area} className="board-area [grid-area:board]">
      <div
        className="board-grid"
        {...gridAttributes}
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
                src={srcOf(tile)}
                uppercase={uppercase}
                flash={flash === tile.id}
                found={found === tile.id}
                holdMs={held === tile.id ? holdMs : 0}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
