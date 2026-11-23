import type { Board, BoardTree, Tile } from './boards.ts';

/**
 * Restoring boards from an encrypted backup (PLAN §6): the vault's tables as the backup
 * stores them (columns and rows, app/src/worker/lib/backup.ts) back into the board tree of
 * GET /api/boards, from which the usual package and Open Board file are built. The file
 * then goes through the same import as any other (validation, quotas, photo re-encoding).
 */
export interface DumpTable {
  columns: string[];
  rows: unknown[][];
}

export interface VaultDump {
  v: 1;
  kind: 'vault';
  at: number;
  tables: Record<string, DumpTable>;
}

export interface DumpedPhoto {
  id: string;
  label: string;
  mime: 'image/webp' | 'image/jpeg' | 'image/png';
  width: number;
  height: number;
}

function records(table: DumpTable | undefined): Record<string, unknown>[] {
  if (!table) return [];
  return table.rows.map((row) => Object.fromEntries(table.columns.map((c, i) => [c, row[i]])));
}

const text = (v: unknown) => (v === null || v === undefined ? null : String(v));

export function restoreTree(dump: VaultDump): { tree: BoardTree; photos: DumpedPhoto[] } {
  if (dump.v !== 1 || dump.kind !== 'vault' || !dump.tables.boards || !dump.tables.tiles) {
    throw new Error('not a vault backup');
  }
  const tilesOf = new Map<string, Tile[]>();
  for (const t of records(dump.tables.tiles)) {
    const set = text(t.symbol_set) as NonNullable<Tile['symbol']>['set'] | null;
    const tile: Tile = {
      id: String(t.id),
      row: Number(t.row),
      col: Number(t.col),
      kind: t.kind as Tile['kind'],
      targetBoardId: text(t.target_board_id),
      label: String(t.label),
      labelPosition: t.label_position as Tile['labelPosition'],
      fontSize: t.font_size as Tile['fontSize'],
      colorRole: text(t.color_role) as Tile['colorRole'],
      colorMode: t.color_mode as Tile['colorMode'],
      symbol: set ? { set, ref: String(t.symbol_ref) } : null,
      // Backups made before the vault had the column have no hidden tiles.
      hidden: Number(t.hidden ?? 0) === 1,
    };
    const board = String(t.board_id);
    tilesOf.set(board, [...(tilesOf.get(board) ?? []), tile]);
  }
  const boards: Board[] = records(dump.tables.boards).map((b) => ({
    id: String(b.id),
    name: String(b.name),
    parentId: text(b.parent_board_id),
    rows: Number(b.rows),
    cols: Number(b.cols),
    rev: Number(b.rev),
    tiles: tilesOf.get(String(b.id)) ?? [],
  }));
  const photos = records(dump.tables.media).map((m) => ({
    id: String(m.id),
    label: String(m.label),
    mime: m.mime as DumpedPhoto['mime'],
    width: Number(m.width),
    height: Number(m.height),
  }));
  return {
    tree: { homeId: boards.find((b) => b.parentId === null)?.id ?? null, boards },
    photos,
  };
}
