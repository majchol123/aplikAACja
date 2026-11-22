import type { Tile } from '@relaacja/shared';
import type { Ref } from 'react';
import { ROLE_COLORS } from '../boards/colors.ts';
import { FolderIcon } from './icons.tsx';

const LABEL_SIZE: Record<Tile['fontSize'], string> = {
  S: 'tile-label-s',
  M: 'tile-label-m',
  L: 'tile-label-l',
  XL: 'tile-label-xl',
};

/**
 * One tile. Sizes are relative to its grid cell (container query units, styles.css), so
 * labels and borders scale with the grid. Activation is handled by the grid (TapFilter).
 */
export function TileView({
  tile,
  src,
  uppercase = false,
  flash = false,
  holdMs = 0,
  ariaLabel,
  onClick,
  ref,
}: {
  tile: Tile;
  src: string | null;
  uppercase?: boolean;
  /** Just activated: brief highlight (PLAN §2.5 feedback). */
  flash?: boolean;
  /** Being held with a minimum hold time: progress ring over that time. */
  holdMs?: number;
  /** Accessible name when the tile does something else than speaking (editor). */
  ariaLabel?: string;
  onClick?: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const colors = ROLE_COLORS[tile.colorRole ?? 'none'];
  const style =
    tile.colorMode === 'background'
      ? `tile-filled ${colors.background} ${colors.border}`
      : `tile-outline bg-white ${colors.border}`;
  const folder = tile.kind === 'folder';
  const label = (
    <span
      className={`tile-label ${LABEL_SIZE[tile.fontSize]} ${src ? '' : 'my-auto'} ${uppercase ? 'uppercase' : ''}`}
    >
      {tile.label}
    </span>
  );
  return (
    <button
      ref={ref}
      type="button"
      data-tile={tile.id}
      aria-label={ariaLabel ?? (folder ? `${tile.label}, folder` : tile.label)}
      onClick={onClick}
      className={`tile ${style} ${folder ? 'tile-folder' : ''} ${flash ? 'tile-flash' : ''}`}
    >
      {tile.labelPosition === 'top' && label}
      {src && (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          className="min-h-0 w-full flex-1 object-contain"
        />
      )}
      {tile.labelPosition === 'bottom' && label}
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
      {folder && (
        <span className="tile-badge">
          <FolderIcon className="tile-badge-icon" />
        </span>
      )}
    </button>
  );
}
