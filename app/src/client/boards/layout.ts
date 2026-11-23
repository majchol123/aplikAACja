import { gridLayout, type GridLayout } from '@aplikaacja/shared';
import { useMemo, useSyncExternalStore } from 'react';
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

/** How a board's grid is drawn on this screen now; turning the device redraws it. */
export function useGridLayout(board: { rows: number; cols: number }): GridLayout {
  const fit = useFitGrid();
  const portrait = useSyncExternalStore(subscribe, isPortrait);
  const { rows, cols } = board;
  return useMemo(() => gridLayout({ rows, cols }, { fit, portrait }), [rows, cols, fit, portrait]);
}
