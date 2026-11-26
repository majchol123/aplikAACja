import { gridLayout, TILE_MIN_REM, type GridLayout } from '@aplikaacja/shared';
import { useMemo, useSyncExternalStore, type CSSProperties } from 'react';
import { useDeviceSettings } from '../device.ts';

const PORTRAIT = '(orientation: portrait)';

function subscribe(listener: () => void): () => void {
  const query = window.matchMedia(PORTRAIT);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}
const isPortrait = () => window.matchMedia(PORTRAIT).matches;

/** Phones: the shorter side of the screen below 600 CSS px (tablets start at about 600). */
export const isPhone = () => Math.min(window.screen.width, window.screen.height) < 600;

/** Whether this device fits board grids to the screen's orientation (device setting). */
export function useFitGrid(): boolean {
  const [device] = useDeviceSettings();
  return device.fitGrid ?? isPhone();
}

/** Boards up to this many rows on screen always fit it, as before scrolling existed. */
export const ALWAYS_FIT_ROWS = 6;

/**
 * Attributes of a `.board-grid` (styles.css): its size on screen and the device's smallest
 * tile, below which a board scrolls (vertically or horizontally) instead of shrinking tiles.
 */
export function useGridAttributes(layout: GridLayout): {
  style: CSSProperties;
  'data-transposed'?: true;
  'data-fit'?: true;
} {
  const [device] = useDeviceSettings();
  const fit = device.tileMin === 'fit';
  return {
    style: {
      '--cols': layout.cols,
      '--rows': layout.rows,
      '--tile-min': `${layout.rows > ALWAYS_FIT_ROWS ? TILE_MIN_REM[device.tileMin] : 0}rem`,
      '--col-min': `${TILE_MIN_REM[device.tileMin]}rem`,
    } as CSSProperties,
    ...(layout.transposed ? { 'data-transposed': true as const } : {}),
    ...(fit ? { 'data-fit': true as const } : {}),
  };
}

/** How a board's grid is drawn on this screen now; turning the device redraws it. */
export function useGridLayout(board: { rows: number; cols: number }): GridLayout {
  const fit = useFitGrid();
  const portrait = useSyncExternalStore(subscribe, isPortrait);
  const { rows, cols } = board;
  return useMemo(() => gridLayout({ rows, cols }, { fit, portrait }), [rows, cols, fit, portrait]);
}
