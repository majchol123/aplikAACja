import {
  autoPrintOrientation,
  boardPrintPages,
  MAX_PRINT_ROWS,
  type Board,
  type PrintOrientation,
  type PrintPaging,
  type SymbolRef,
  type Tile,
} from '@aplikaacja/shared';
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { TileCard } from '../comm/TileView.tsx';
import { Dialog } from '../edit/Dialog.tsx';
import { ui } from '../edit/ui.ts';
import { ARASAAC_NOTE } from '../library/attribution.ts';

/**
 * Dynamic `@page` rule applied via CSSOM `adoptedStyleSheets` (CSP blocks inline `<style>`
 * without `'unsafe-inline'`, whereas Constructable Stylesheets bypass it safely).
 */
const activePrintSheets = new Map<symbol, PrintOrientation>();
let pageStyleSheet: CSSStyleSheet | null = null;

function syncPrintPageRule(): void {
  if (typeof document === 'undefined' || !('adoptedStyleSheets' in document)) return;
  const last = [...activePrintSheets.values()].at(-1) ?? null;
  if (!last) {
    if (pageStyleSheet) {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== pageStyleSheet);
    }
    return;
  }
  pageStyleSheet ??= new CSSStyleSheet();
  pageStyleSheet.replaceSync(`@page { size: ${last}; margin: 10mm; }`);
  if (!document.adoptedStyleSheets.includes(pageStyleSheet)) {
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, pageStyleSheet];
  }
}

/** Safari ignores CSS `@page size`; users there pick orientation in the system print dialog. */
const isSafari = () =>
  typeof navigator !== 'undefined' && /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

/** Wait for all images in `root` to finish loading (capped so offline/broken icons never hang). */
async function waitForImages(root: HTMLElement | null): Promise<void> {
  if (!root) return;
  const imgs = [...root.querySelectorAll('img')];
  await Promise.race([
    Promise.all(
      imgs.map((img) =>
        img.complete
          ? img.decode().catch(() => undefined)
          : new Promise<void>((resolve) => {
              img.addEventListener('load', () => resolve(), { once: true });
              img.addEventListener('error', () => resolve(), { once: true });
            }),
      ),
    ),
    new Promise<void>((resolve) => window.setTimeout(resolve, 3000)),
  ]);
}

function BoardPages({
  board,
  resolve,
  orientation,
  paging,
  showTitle,
  includeHidden,
  preview,
  eager,
}: {
  board: Board;
  resolve: (symbol: SymbolRef | null) => string | null;
  orientation: PrintOrientation;
  paging: PrintPaging;
  showTitle: boolean;
  includeHidden: boolean;
  preview: boolean;
  eager: boolean;
}) {
  const tiles = useMemo(
    () => (includeHidden ? board.tiles : board.tiles.filter((t) => !t.hidden)),
    [board.tiles, includeHidden],
  );
  const at = useMemo(() => {
    const map = new Map<string, Tile>();
    for (const t of tiles) map.set(`${t.row},${t.col}`, t);
    return map;
  }, [tiles]);
  const slices = useMemo(
    () => boardPrintPages(board.rows, orientation, paging),
    [board.rows, orientation, paging],
  );
  const usesArasaac = useMemo(() => tiles.some((t) => t.symbol?.set === 'arasaac'), [tiles]);

  return (
    <>
      {slices.map((slice) => {
        const hasHeader = showTitle || slice.totalPages > 1;
        return (
          <section
            key={slice.page}
            className={
              preview
                ? `board-print-preview-page mx-auto w-full rounded-lg bg-white text-slate-900 shadow-md ring-1 ring-slate-300 ${
                    orientation === 'landscape'
                      ? 'aspect-[297/210] max-w-xl'
                      : 'aspect-[210/297] max-w-sm'
                  }`
                : 'board-print-page'
            }
          >
            {hasHeader && (
              <header
                className={`flex items-baseline justify-between gap-2 font-bold text-slate-900 ${
                  preview ? 'text-xs' : 'text-[13pt]'
                }`}
              >
                <span className="truncate">{showTitle ? board.name : ''}</span>
                {slice.totalPages > 1 && (
                  <span
                    className={`shrink-0 font-normal text-slate-600 ${preview ? 'text-[10px]' : 'text-[10pt]'}`}
                  >
                    {slice.page + 1} / {slice.totalPages}
                  </span>
                )}
              </header>
            )}
            <div
              className="board-print-grid"
              style={
                {
                  '--cols': board.cols,
                  '--rows': slice.gridRows,
                } as CSSProperties
              }
            >
              {Array.from({ length: slice.rowCount * board.cols }, (_, i) => {
                const row = slice.rowStart + Math.floor(i / board.cols);
                const col = i % board.cols;
                const tile = at.get(`${row},${col}`);
                return (
                  <div
                    key={`${row},${col}`}
                    className={`tile-cell ${tile?.hidden ? 'tile-hidden' : ''}`}
                  >
                    {tile && (
                      <div className="relative size-full">
                        <TileCard tile={tile} src={resolve(tile.symbol)} eager={eager} />
                        {tile.hidden && (
                          <span className="tile-hidden-badge" aria-hidden="true">
                            ukryty
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {usesArasaac && (
              <p
                className={`text-slate-600 ${preview ? 'text-[8px] leading-tight' : 'text-[8pt]'}`}
              >
                {ARASAAC_NOTE}
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}

/**
 * Hidden print portal for the displayed board (styles.css, `.board-sheet`). Mounted either by
 * `PrintBoardDialog` (with user choices) or in the background so Ctrl+P prints the board too.
 */
export function BoardPrintSheet({
  board,
  resolve,
  orientation = autoPrintOrientation(board),
  paging = 'auto',
  showTitle = true,
  includeHidden = false,
  eager = false,
  sheetRef,
}: {
  board: Board;
  resolve: (symbol: SymbolRef | null) => string | null;
  orientation?: PrintOrientation;
  paging?: PrintPaging;
  showTitle?: boolean;
  includeHidden?: boolean;
  eager?: boolean;
  sheetRef?: Ref<HTMLDivElement>;
}) {
  useEffect(() => {
    const token = Symbol();
    activePrintSheets.set(token, orientation);
    syncPrintPageRule();
    return () => {
      activePrintSheets.delete(token);
      syncPrintPageRule();
    };
  }, [orientation]);

  return createPortal(
    <div ref={sheetRef} className="board-sheet" data-orientation={orientation} aria-hidden="true">
      <BoardPages
        board={board}
        resolve={resolve}
        orientation={orientation}
        paging={paging}
        showTitle={showTitle}
        includeHidden={includeHidden}
        preview={false}
        eager={eager}
      />
    </div>,
    document.body,
  );
}

/** Print preview and options dialog for a board (orientation auto-picked from its grid). */
export function PrintBoardDialog({
  board,
  resolve,
  onClose,
}: {
  board: Board;
  resolve: (symbol: SymbolRef | null) => string | null;
  onClose: () => void;
}) {
  const id = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const [paging, setPaging] = useState<PrintPaging>('auto');
  const [orientationOverride, setOrientationOverride] = useState<PrintOrientation | null>(null);
  const [showTitle, setShowTitle] = useState(true);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  const recommended = autoPrintOrientation(board, paging);
  const orientation = orientationOverride ?? recommended;
  const hasHidden = board.tiles.some((t) => t.hidden);
  const showPagingOption = board.rows > MAX_PRINT_ROWS[orientation] || paging === 'single';
  const autoPagesCount = boardPrintPages(board.rows, orientation, 'auto').length;

  async function printNow(): Promise<void> {
    setBusy(true);
    try {
      await waitForImages(sheetRef.current);
      window.print();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog title={`Drukuj tablicę „${board.name}”`} onClose={onClose} wide>
      <div className="mt-4 space-y-4">
        <fieldset>
          <legend className={ui.field}>Orientacja strony</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2 sm:max-w-sm">
            {(
              [
                ['landscape', 'Poziomo'],
                ['portrait', 'Pionowo'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={ui.choice}>
                <input
                  type="radio"
                  name={`${id}-orientation`}
                  value={value}
                  checked={orientation === value}
                  onChange={() => setOrientationOverride(value === recommended ? null : value)}
                  className="sr-only"
                />
                <span>
                  {label}
                  {value === recommended ? ' (zalecana)' : ''}
                </span>
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-sm text-slate-600">
            Dobrana automatycznie dla siatki {board.rows}×{board.cols}.
            {isSafari() && ' W Safari potwierdź wybraną orientację w oknie drukowania.'}
          </p>
        </fieldset>

        {showPagingOption && (
          <fieldset>
            <legend className={ui.field}>Podział na strony</legend>
            <div className="mt-1.5 grid grid-cols-2 gap-2 sm:max-w-md">
              <label className={ui.choice}>
                <input
                  type="radio"
                  name={`${id}-paging`}
                  value="auto"
                  checked={paging === 'auto'}
                  onChange={() => setPaging('auto')}
                  className="sr-only"
                />
                <span>Automatyczny ({autoPagesCount} str.)</span>
              </label>
              <label className={ui.choice}>
                <input
                  type="radio"
                  name={`${id}-paging`}
                  value="single"
                  checked={paging === 'single'}
                  onChange={() => setPaging('single')}
                  className="sr-only"
                />
                <span>Zmieść na 1 stronie</span>
              </label>
            </div>
          </fieldset>
        )}

        <div className="flex flex-wrap gap-x-6 gap-y-2 text-slate-800">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-5"
              checked={showTitle}
              onChange={(e) => setShowTitle(e.target.checked)}
            />
            Pokaż nazwę tablicy
          </label>
          {hasHidden && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                className="size-5"
                checked={includeHidden}
                onChange={(e) => setIncludeHidden(e.target.checked)}
              />
              Pokaż ukryte kafelki
            </label>
          )}
        </div>

        <div
          className="max-h-[46dvh] space-y-4 overflow-y-auto rounded-2xl bg-slate-100 p-4"
          aria-hidden="true"
          data-testid="board-print-preview"
          data-orientation={orientation}
        >
          <BoardPages
            board={board}
            resolve={resolve}
            orientation={orientation}
            paging={paging}
            showTitle={showTitle}
            includeHidden={includeHidden}
            preview
            eager
          />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" className={ui.secondary} onClick={onClose}>
          Anuluj
        </button>
        <button
          type="button"
          className={ui.primary}
          disabled={busy}
          onClick={() => void printNow()}
        >
          {busy ? 'Przygotowywanie…' : 'Drukuj'}
        </button>
      </div>

      <BoardPrintSheet
        board={board}
        resolve={resolve}
        orientation={orientation}
        paging={paging}
        showTitle={showTitle}
        includeHidden={includeHidden}
        eager
        sheetRef={sheetRef}
      />
    </Dialog>
  );
}
