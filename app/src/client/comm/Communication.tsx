import {
  type Board,
  type BoardTree,
  type FitzgeraldRole,
  spokenText,
  type Me,
  type PhraseItem,
  type SymbolRef,
  type Tile,
  type TileGrammar,
} from '@aplikaacja/shared';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { ALL_SYMBOLS_ID, ALL_SYMBOLS_TILE, withAllSymbols } from '../boards/allSymbols.ts';
import { BoardNav } from '../boards/BoardNav.tsx';
import { useSymbolResolver } from '../boards/data.ts';
import { BoardPrintSheet } from '../boards/PrintBoardDialog.tsx';
import { useDeviceSettings } from '../device.ts';
import { PhraseGenerator } from '../phrase/PhraseGenerator.tsx';
import { useSpeaker } from '../speech.ts';
import { useAccountSettings } from '../settings/account.ts';
import { BoardGrid } from './BoardGrid.tsx';
import { FormPicker } from './FormPicker.tsx';
import { sentenceForms, useGrammar } from './grammar.ts';
import { HistoryPanel } from './HistoryPanel.tsx';
import {
  BackspaceIcon,
  ClockIcon,
  KeyboardIcon,
  PencilIcon,
  PinIcon,
  PlayIcon,
  SearchIcon,
  TrashIcon,
} from './icons.tsx';
import { useHistory } from './phrases.ts';
import { SearchPanel } from './SearchPanel.tsx';
import { BROWSE_START, SymbolFolders, type Browse, type PickedSymbol } from './SymbolFolders.tsx';
import { useUsageCounter } from './usage.ts';
import { useWakeLock } from './wake-lock.ts';

interface SentenceItem {
  key: number;
  /** The tile's label or the symbol's word; the bar shows its form in the sentence (F8). */
  label: string;
  src: string | null;
  symbol: SymbolRef | null;
  /** Said instead of the label (Tile.speech). */
  speech?: string;
  /** Fitzgerald role of the tile or symbol: tells the grammar "mam" (mieć) from "mam" (mama). */
  role?: FitzgeraldRole | null;
  /** Said as before, never inflected: history, favourites, the phrase generator. */
  fixed?: boolean;
  /** A form picked by hand ("Wybierz formę"). */
  picked?: string;
  /** How the tile's word inflects (Tile.grammar, G3). */
  grammar?: TileGrammar | null;
}

const HOLD_MS = 2000;
/** How long a tile found with the search keeps its ring. */
const FOUND_MS = 4000;

/** Communication view: grid of the current board, sentence bar, folder navigation (PLAN §2.1). */
export function Communication({
  me,
  tree,
  boardId,
  onBoardChange,
  onEditMode,
}: {
  me: Me;
  tree: BoardTree;
  /** Board on screen (shared with the editor); null = home. */
  boardId: string | null;
  onBoardChange: (boardId: string) => void;
  onEditMode: () => void;
}) {
  const boards = useMemo(() => new Map(tree.boards.map((b) => [b.id, b])), [tree.boards]);
  const homeId = tree.homeId ?? '';
  // A board deleted on another device: fall back to the home board.
  const board = boards.get(boardId ?? homeId) ?? boards.get(homeId);
  const [sentence, setSentence] = useState<SentenceItem[]>([]);
  const nextKey = useRef(0);
  const speak = useSpeaker();
  const grammar = useGrammar(me.extraSet);
  // What the bar shows and says: the words in agreeing forms ("ty" + "iść" → "idziesz").
  const shown = useMemo(() => {
    const forms = sentenceForms(sentence, grammar);
    return sentence.map((item, i) => ({ ...item, label: forms[i] ?? item.label }));
  }, [sentence, grammar]);
  // Index of the word whose forms are offered (held in the bar).
  const [picking, setPicking] = useState<number | null>(null);
  const [device, updateDevice] = useDeviceSettings();
  const account = useAccountSettings();
  const allTiles = useMemo(
    () => [ALL_SYMBOLS_TILE, ...tree.boards.flatMap((b) => b.tiles)],
    [tree.boards],
  );
  const resolve = useSymbolResolver(me, allTiles);
  const [searching, setSearching] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  // "Wszystkie symbole" open (drawn instead of the board), and where in it.
  const [browse, setBrowse] = useState<Browse | null>(null);
  const [phrasing, setPhrasing] = useState(false);
  const history = useHistory(me.id, showHistory);
  const countUsage = useUsageCounter(me.id);
  const [found, setFound] = useState<string | null>(null);
  const foundTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(foundTimer.current), []);
  useWakeLock();
  // A pinned board deleted meanwhile (another device) is forgotten.
  const pinned = device.pinnedBoard && boards.has(device.pinnedBoard) ? device.pinnedBoard : null;
  useEffect(() => {
    if (device.pinnedBoard && !pinned) updateDevice({ pinnedBoard: null });
  }, [device.pinnedBoard, pinned, updateDevice]);
  const back = pinned ?? homeId;
  // Opening the app (boardId not chosen yet) shows the pinned board, as after a word.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (boardId === null && pinned) onBoardChange(pinned);
  }, [boardId, pinned, onBoardChange]);

  // G4: on this device tiles may show the form their word takes in the sentence now ("ty" →
  // "iść" shows "idziesz"); a tapped tile still brings its own label (activate).
  const showAll = account.data?.showAllSymbols ?? true;
  const onScreen = useMemo(() => {
    if (!board) return undefined;
    const drawn = withAllSymbols(board, !showAll);
    if (!device.previewForms || !grammar.lexicon || grammar.level === 'off') return drawn;
    let changed = false;
    const tiles = drawn.tiles.map((tile) => {
      if (tile.kind !== 'word' || tile.speech || tile.grammar?.fixed) return tile;
      const next = { label: tile.label, role: tile.colorRole, grammar: tile.grammar };
      const form = sentenceForms([...sentence, next], grammar).at(-1);
      if (!form || form === tile.label) return tile;
      changed = true;
      return { ...tile, label: form };
    });
    return changed ? { ...drawn, tiles } : drawn;
  }, [board, showAll, device.previewForms, grammar, sentence]);

  const home = boards.get(homeId);
  if (!board || !home) return null;
  const held = picking === null ? undefined : sentence[picking];

  /** A form picked by hand for the held word, or undefined to let the grammar choose again. */
  function pickForm(form: string | undefined): void {
    setSentence((items) =>
      items.map((item, i) => {
        if (i !== picking) return item;
        const next = { ...item };
        if (form === undefined) delete next.picked;
        else next.picked = form;
        return next;
      }),
    );
    setPicking(null);
  }

  /** To a board, leaving "Wszystkie symbole". */
  function open(id: string): void {
    setBrowse(null);
    onBoardChange(id);
  }

  function add(item: Omit<SentenceItem, 'key'>): void {
    setSentence((items) => [...items, { ...item, key: nextKey.current++ }]);
    if (device.speakOnTap) {
      // The new word in its form in the sentence: "ty" + "iść" says "idziesz".
      const forms = sentenceForms([...sentence, item], grammar);
      speak(item.speech ?? forms[forms.length - 1] ?? item.label);
    }
    countUsage('tiles');
  }

  function show(tile: Tile, on: Board): void {
    setSearching(false);
    open(on.id);
    setFound(tile.id);
    window.clearTimeout(foundTimer.current);
    foundTimer.current = window.setTimeout(() => setFound(null), FOUND_MS);
  }

  function activate(drawn: Tile): void {
    // Shown in its form in the sentence (G4): the word itself goes to the sentence.
    const tile = board?.tiles.find((t) => t.id === drawn.id) ?? drawn;
    if (tile.id === ALL_SYMBOLS_ID) {
      setBrowse(BROWSE_START);
      return;
    }
    if (tile.kind === 'folder') {
      if (tile.targetBoardId && boards.has(tile.targetBoardId)) onBoardChange(tile.targetBoardId);
      return;
    }
    add({
      label: tile.label,
      src: resolve(tile.symbol),
      symbol: tile.symbol,
      role: tile.colorRole,
      ...(tile.speech ? { speech: tile.speech } : {}),
      ...(tile.grammar ? { grammar: tile.grammar } : {}),
    });
    // A pinned board takes the place of the home board as the one to come back to.
    if ((account.data?.returnToHome ?? true) && board?.id !== back) onBoardChange(back);
  }

  /** A symbol from "Wszystkie symbole": to the sentence, then back as after a word. */
  function pick(item: PickedSymbol): void {
    add(item);
    if (account.data?.returnToHome ?? true) open(back);
  }

  // The history keeps what was said, so a replay says it again word for word.
  const speakSentence = () => {
    speak(spokenText(shown));
    if (shown.length > 0) countUsage('utterances');
    history.record(
      shown.map(({ label, symbol, speech }) => ({
        label,
        symbol,
        ...(speech ? { speech } : {}),
      })),
    );
  };

  function replay(items: PhraseItem[]): void {
    setShowHistory(false);
    setSentence(
      items.map((item) => ({
        ...item,
        key: nextKey.current++,
        src: resolve(item.symbol),
        fixed: true,
      })),
    );
    speak(spokenText(items));
    countUsage('utterances');
    history.record(items);
  }

  const tools = (
    <>
      <ToolButton label="Szukaj" onClick={() => setSearching(true)}>
        <SearchIcon />
      </ToolButton>
      <ToolButton label="Historia i ulubione" onClick={() => setShowHistory(true)}>
        <ClockIcon />
      </ToolButton>
      {account.data?.showPhraseGenerator && (
        <ToolButton label="Generator fraz" onClick={() => setPhrasing(true)}>
          <KeyboardIcon />
        </ToolButton>
      )}
    </>
  );

  return (
    <main className="comm-root h-dvh bg-slate-100">
      <h1 className="sr-only">Tablica: {board.name}</h1>
      <SentenceBar
        items={shown}
        onSpeak={speakSentence}
        onBackspace={() => setSentence((items) => items.slice(0, -1))}
        onClear={() => setSentence([])}
        onHold={grammar.lexicon ? setPicking : undefined}
      />
      {browse ? (
        <SymbolFolders
          me={me}
          browse={browse}
          home={home}
          boards={boards}
          cols={home.cols}
          resolve={resolve}
          tools={tools}
          onBrowse={(next) => (next ? setBrowse(next) : open(homeId))}
          onHome={open}
          onPick={pick}
        />
      ) : (
        <>
          <BoardNav
            boards={boards}
            board={board}
            homeId={homeId}
            onOpen={open}
            className="[grid-area:nav]"
          >
            <PinButton
              board={board}
              pinned={pinned ? boards.get(pinned) : undefined}
              onPin={(id) => updateDevice({ pinnedBoard: id })}
              onOpen={open}
            />
            {tools}
          </BoardNav>
          <BoardGrid
            board={onScreen ?? board}
            srcOf={(tile) => resolve(tile.symbol)}
            found={found}
            onActivate={activate}
          />
        </>
      )}
      <EditLock onUnlock={onEditMode} />
      {phrasing && (
        <PhraseGenerator
          me={me}
          onToSentence={(items) => {
            setPhrasing(false);
            // Typed words keep the forms they were typed in.
            setSentence((current) => [
              ...current,
              ...items.map((item) => ({ ...item, key: nextKey.current++, fixed: true })),
            ]);
          }}
          onClose={() => setPhrasing(false)}
        />
      )}
      {held && grammar.lexicon && picking !== null && (
        <FormPicker
          label={held.label}
          role={held.role ?? null}
          grammar={held.grammar ?? null}
          shown={shown[picking]?.label ?? held.label}
          picked={held.picked !== undefined}
          lexicon={grammar.lexicon}
          onPick={pickForm}
          onSpeak={speak}
          onClose={() => setPicking(null)}
        />
      )}
      {showHistory && (
        <HistoryPanel
          history={history.entries}
          keep={history.keep}
          loading={history.loading}
          clearing={history.clear.isPending}
          resolve={resolve}
          onPlay={replay}
          onClearHistory={() => history.clear.mutate()}
          onClose={() => setShowHistory(false)}
        />
      )}
      {searching && (
        <SearchPanel
          me={me}
          tree={tree}
          sources={account.data?.searchSources ?? 'both'}
          resolve={resolve}
          onShowTile={show}
          onPick={(item) => {
            setSearching(false);
            add(item);
          }}
          onClose={() => setSearching(false)}
        />
      )}
      {!phrasing && !searching && !showHistory && picking === null && !browse && (
        <BoardPrintSheet board={board} resolve={resolve} />
      )}
    </main>
  );
}

/** Holding a word of the bar this long offers its forms (FormPicker). */
const HOLD_FORMS_MS = 550;
/** A finger moving further than this scrolls the bar instead. */
const HOLD_SLOP_PX = 12;

/**
 * Press-and-hold on a word of the bar calls onHold. So does the context menu: a long press on
 * Android, a right click, the menu key or Shift+F10 — mice and keyboards reach the forms too.
 * The click ending a hold does not speak the sentence.
 */
function useHold(onHold: ((index: number) => void) | undefined) {
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    origin.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);
  return (index: number) =>
    onHold
      ? {
          onPointerDown: (e: PointerEvent) => {
            fired.current = false;
            if (e.button !== 0) return;
            origin.current = { x: e.clientX, y: e.clientY };
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => {
              fired.current = true;
              origin.current = null;
              onHold(index);
            }, HOLD_FORMS_MS);
          },
          onPointerMove: (e: PointerEvent) => {
            const o = origin.current;
            if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > HOLD_SLOP_PX) cancel();
          },
          onPointerUp: cancel,
          onPointerCancel: cancel,
          onPointerLeave: cancel,
          onContextMenu: (e: MouseEvent) => {
            e.preventDefault();
            if (fired.current) return;
            const pressing = origin.current !== null;
            cancel();
            if (pressing) fired.current = true;
            onHold(index);
          },
          onClickCapture: (e: MouseEvent) => {
            if (!fired.current) return;
            fired.current = false;
            e.stopPropagation();
          },
        }
      : {};
}

/**
 * Briefly marks a word whose form a later word changed ("duży" → "duża" after "piłka", F8 G2),
 * so that the change is seen. A colour fading out, no movement.
 */
function useChangedWords(items: SentenceItem[]) {
  const labels = useRef(new Map<number, string>());
  const nodes = useRef(new Map<number, HTMLElement>());
  useEffect(() => {
    const before = labels.current;
    for (const item of items) {
      const was = before.get(item.key);
      if (was === undefined || was === item.label) continue;
      nodes.current
        .get(item.key)
        ?.animate?.([{ backgroundColor: '#fde68a' }, { backgroundColor: 'transparent' }], {
          duration: 900,
          easing: 'ease-out',
        });
    }
    labels.current = new Map(items.map((i) => [i.key, i.label]));
  }, [items]);
  return (key: number) => (node: HTMLElement | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  };
}

function SentenceBar({
  items,
  onSpeak,
  onBackspace,
  onClear,
  onHold,
}: {
  items: SentenceItem[];
  onSpeak: () => void;
  onBackspace: () => void;
  onClear: () => void;
  /** Holding a word offers its forms; undefined while there is no grammar lexicon. */
  onHold: ((index: number) => void) | undefined;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const hint = useId();
  const hold = useHold(onHold);
  const changed = useChangedWords(items);
  useEffect(() => {
    scroller.current?.scrollTo({ left: scroller.current.scrollWidth, behavior: 'smooth' });
  }, [items.length]);
  const empty = items.length === 0;
  return (
    <div className="flex h-24 shrink-0 items-stretch gap-2 [grid-area:bar] sm:h-28 short:h-14">
      {/* A tap anywhere speaks the sentence; the words are buttons of their own (held: forms). */}
      <div
        ref={scroller}
        role="group"
        aria-label={
          empty ? 'Pasek zdania jest pusty' : `Zdanie: ${items.map((i) => i.label).join(' ')}`
        }
        onClick={onSpeak}
        data-testid="sentence"
        className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto rounded-2xl bg-white px-3 shadow-sm ring-1 ring-slate-200"
      >
        {items.map((item, i) => (
          <Fragment key={item.key}>
            {/* Not drawn between flex items; keeps the words apart in the accessible text. */}
            {i > 0 && ' '}
            <button
              type="button"
              {...hold(i)}
              // Apart from the tile of the same word; the visible text leads (WCAG 2.5.3).
              aria-label={`${item.label}, w zdaniu`}
              aria-describedby={onHold ? hint : undefined}
              className="flex h-full max-h-24 shrink-0 select-none flex-col items-center justify-center rounded-lg py-1 [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:outline-brand-600 short:py-0.5"
              data-testid="sentence-item"
            >
              {item.src && (
                <img
                  src={item.src}
                  alt=""
                  draggable={false}
                  className="min-h-0 w-16 flex-1 object-contain short:w-10"
                />
              )}
              <span
                ref={changed(item.key)}
                className="rounded text-base font-bold leading-tight text-slate-800 short:text-sm"
              >
                {item.label}
              </span>
            </button>
          </Fragment>
        ))}
        {onHold && (
          <span id={hint} className="sr-only">
            Przytrzymaj słowo, aby wybrać jego formę.
          </span>
        )}
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

/**
 * Pins the open board (a game, a lesson) on this device: choosing a word comes back to it
 * instead of the home board. On the pinned board it unpins; elsewhere it leads back to it.
 */
function PinButton({
  board,
  pinned,
  onPin,
  onOpen,
}: {
  board: Board;
  pinned: Board | undefined;
  onPin: (boardId: string | null) => void;
  onOpen: (boardId: string) => void;
}) {
  const look = (on: boolean) =>
    `flex size-12 shrink-0 items-center justify-center rounded-xl shadow-sm ${
      on
        ? 'bg-amber-300 text-amber-950 ring-2 ring-amber-600'
        : 'bg-white text-slate-700 ring-1 ring-slate-200'
    }`;
  if (pinned && pinned.id !== board.id) {
    return (
      <button
        type="button"
        aria-label={`Wróć do przypiętej tablicy: ${pinned.name}`}
        onClick={() => onOpen(pinned.id)}
        className={look(true)}
      >
        <PinIcon filled />
      </button>
    );
  }
  // The home board is where everything comes back to anyway.
  if (!pinned && !board.parentId) return null;
  const on = pinned?.id === board.id;
  return (
    <button
      type="button"
      aria-label="Przypnij tablicę"
      aria-pressed={on}
      onClick={() => onPin(on ? null : board.id)}
      className={look(on)}
    >
      <PinIcon filled={on} />
    </button>
  );
}

/** A tool of communication mode next to the board navigation (search, history). */
function ToolButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm ring-1 ring-slate-200"
    >
      {children}
    </button>
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
      className={`flex w-16 shrink-0 items-center justify-center rounded-2xl shadow-sm sm:w-20 short:w-14 disabled:opacity-35 ${
        primary ? 'bg-brand-700 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Opens edit mode. With a PIN on this device one tap asks for it; without one the button must
 * be held for 2 s, so a chance touch of the board does not open the editor.
 */
function EditLock({ onUnlock }: { onUnlock: () => void }) {
  const [device] = useDeviceSettings();
  const [holding, setHolding] = useState(false);
  const [hint, setHint] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const button =
    'relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200';

  if (device.pin) {
    return (
      <div className="relative self-center [grid-area:lock]">
        <button
          type="button"
          aria-label="Tryb edycji (wymaga PIN-u)"
          onClick={onUnlock}
          onContextMenu={(e) => e.preventDefault()}
          className={button}
        >
          <PencilIcon />
        </button>
      </div>
    );
  }

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
    <div className="relative self-center [grid-area:lock]">
      <button
        type="button"
        aria-label="Tryb edycji (przytrzymaj 2 sekundy)"
        data-holding={holding}
        onPointerDown={start}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !e.repeat && start()}
        onKeyUp={stop}
        onContextMenu={(e) => e.preventDefault()}
        className={button}
      >
        <PencilIcon />
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
