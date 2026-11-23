import type { Me, SymbolHit, SymbolRef } from '@relaacja/shared';
import { Dialog } from '../edit/Dialog.tsx';
import { CategoryBrowser } from '../library/CategoryBrowser.tsx';

/**
 * "All symbols" of communication mode (F3): the category folders of the active sets, for
 * someone who cannot type a search; a symbol goes to the sentence bar like a tile.
 */
export function AllSymbols({
  me,
  onPick,
  onClose,
}: {
  me: Me;
  onPick: (item: { label: string; src: string; symbol: SymbolRef }) => void;
  onClose: () => void;
}) {
  const pick = (hit: SymbolHit) =>
    onPick({ label: hit.label, src: hit.src, symbol: { set: hit.set, ref: String(hit.id) } });
  return (
    <Dialog title="Wszystkie symbole" onClose={onClose} wide>
      <CategoryBrowser
        me={me}
        className="mt-2 max-h-[70dvh]"
        renderSymbol={(hit) => (
          <button
            type="button"
            onClick={() => pick(hit)}
            className="flex w-full flex-col items-center rounded-2xl bg-white p-2 ring-1 ring-slate-200 hover:bg-brand-50"
          >
            <img src={hit.src} alt="" loading="lazy" className="size-20 object-contain" />
            <span className="mt-1 text-center font-bold leading-tight text-slate-900">
              {hit.label}
            </span>
          </button>
        )}
      />
    </Dialog>
  );
}
