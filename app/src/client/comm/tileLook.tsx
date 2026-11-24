import { DEFAULT_SETTINGS, type LabelPosition, type Settings } from '@aplikaacja/shared';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useAccountSettings } from '../settings/account.ts';

/** How an account draws its tiles (account settings), for every TileView below it. */
export interface TileLook {
  uppercase: boolean;
  /** Where labels go on tiles without a place of their own (Tile.labelPosition null). */
  labelPosition: LabelPosition;
}

const TileLookContext = createContext<TileLook>({
  uppercase: DEFAULT_SETTINGS.uppercaseLabels,
  labelPosition: DEFAULT_SETTINGS.labelPosition,
});

export const useTileLook = (): TileLook => useContext(TileLookContext);

/** Tiles below drawn as `settings` say (the admin's preview of another account). */
export function TileLookOf({ settings, children }: { settings: Settings; children: ReactNode }) {
  const { uppercaseLabels: uppercase, labelPosition } = settings;
  const look = useMemo(() => ({ uppercase, labelPosition }), [uppercase, labelPosition]);
  return <TileLookContext value={look}>{children}</TileLookContext>;
}

/** Tiles below drawn as the signed-in account's settings say. */
export function AccountTileLook({ children }: { children: ReactNode }) {
  const account = useAccountSettings();
  return <TileLookOf settings={account.data ?? DEFAULT_SETTINGS}>{children}</TileLookOf>;
}
