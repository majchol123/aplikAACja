import type { Tile } from '@aplikaacja/shared';
import { useMemo, type CSSProperties, type ReactNode, type Ref } from 'react';
import { ROLE_COLORS } from '../boards/colors.ts';
import { FolderIcon } from './icons.tsx';
import { useTileLook } from './tileLook.tsx';

const LABEL_SIZE: Record<Tile['fontSize'], string> = {
  S: 'tile-label-s',
  M: 'tile-label-m',
  L: 'tile-label-l',
  XL: 'tile-label-xl',
};

let measure: CanvasRenderingContext2D | null | undefined;

/**
 * Width of the label's widest word in em, bold in the app's font: the label shrinks to fit
 * it instead of breaking the word (styles.css, --word).
 */
function widestWord(label: string, uppercase: boolean): number {
  const words = label.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 1;
  if (measure === undefined) {
    measure = document.createElement('canvas').getContext('2d');
    if (measure)
      measure.font = `700 100px ${getComputedStyle(document.documentElement).fontFamily}`;
  }
  const ctx = measure;
  const shown = (word: string) => (uppercase ? word.toLocaleUpperCase('pl') : word);
  // Without a canvas: a generous average glyph width.
  const width = (word: string) =>
    ctx ? ctx.measureText(shown(word)).width / 100 : [...word].length * (uppercase ? 0.8 : 0.7);
  return Math.max(...words.map(width));
}

function useTileAppearance(tile: Tile, src: string | null) {
  const colors = ROLE_COLORS[tile.colorRole ?? 'none'];
  const style =
    tile.colorMode === 'background'
      ? `tile-filled ${colors.background} ${colors.border}`
      : `tile-outline bg-white ${colors.border}`;
  const folder = tile.kind === 'folder';
  const { uppercase, labelPosition } = useTileLook();
  const above = (tile.labelPosition ?? labelPosition) === 'top';
  const word = useMemo(() => widestWord(tile.label, uppercase), [tile.label, uppercase]);
  const fit = { '--word': word.toFixed(3) } as CSSProperties;
  const label = (
    <span
      className={`tile-label ${LABEL_SIZE[tile.fontSize]} ${src ? '' : 'my-auto'} ${uppercase ? 'uppercase' : ''}`}
      style={fit}
    >
      {tile.label}
    </span>
  );
  const className = `tile ${style} ${folder ? 'tile-folder' : ''}`;
  return { above, folder, label, className };
}

function TileBody({
  above,
  folder,
  label,
  src,
  eager,
}: {
  above: boolean;
  folder: boolean;
  label: ReactNode;
  src: string | null;
  eager: boolean;
}) {
  return (
    <>
      {above && label}
      {src && (
        <img
          src={src}
          alt=""
          draggable={false}
          loading={eager ? 'eager' : 'lazy'}
          decoding={eager ? 'sync' : 'async'}
          className="tile-img"
        />
      )}
      {!above && label}
      {folder && (
        <span className="tile-badge">
          <FolderIcon className="tile-badge-icon" />
        </span>
      )}
    </>
  );
}

/** Non-interactive tile face for board printing and print previews. */
export function TileCard({
  tile,
  src,
  eager = false,
}: {
  tile: Tile;
  src: string | null;
  eager?: boolean;
}) {
  const { above, folder, label, className } = useTileAppearance(tile, src);
  return (
    <div data-tile={tile.id} data-label={above ? 'top' : 'bottom'} className={className}>
      <TileBody above={above} folder={folder} label={label} src={src} eager={eager} />
    </div>
  );
}

/**
 * One tile. Sizes are relative to its grid cell (container query units, styles.css), so
 * labels and borders scale with the grid. Activation is handled by the grid (TapFilter); the
 * account's look (upper case, where labels go) comes from tileLook.tsx.
 */
export function TileView({
  tile,
  src,
  flash = false,
  found = false,
  holdMs = 0,
  ariaLabel,
  onClick,
  ref,
}: {
  tile: Tile;
  src: string | null;
  /** Just activated: brief highlight (PLAN §2.5 feedback). */
  flash?: boolean;
  /** Found with the search: a pulsing ring (F3). */
  found?: boolean;
  /** Being held with a minimum hold time: progress ring over that time. */
  holdMs?: number;
  /** Accessible name when the tile does something else than speaking (editor). */
  ariaLabel?: string;
  onClick?: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const { above, folder, label, className } = useTileAppearance(tile, src);
  return (
    <button
      ref={ref}
      type="button"
      data-tile={tile.id}
      data-label={above ? 'top' : 'bottom'}
      aria-label={ariaLabel ?? (folder ? `${tile.label}, folder` : tile.label)}
      onClick={onClick}
      className={`${className} ${flash ? 'tile-flash' : ''} ${found ? 'tile-found' : ''}`}
    >
      <TileBody above={above} folder={folder} label={label} src={src} eager={false} />
      {holdMs > 0 && (
        <svg className="hold-ring" viewBox="0 0 100 100" aria-hidden="true">
          <circle
            cx="50"
            cy="50"
            r="40"
            pathLength={100}
            style={{ animationDuration: `${holdMs}ms` }}
          />
        </svg>
      )}
    </button>
  );
}
