import {
  packageTree,
  receivedSharePhotoUrl,
  type Board,
  type Me,
  type ReceivedShare,
} from '@relaacja/shared';
import { useCallback, useMemo, useState } from 'react';
import { formatBytes, formatDate, BOARDS_PL, PHOTOS_PL, TILES_PL } from '../admin/format.ts';
import { ReadOnlyBoards } from '../boards/ReadOnlyBoards.tsx';
import { Dialog } from '../edit/Dialog.tsx';
import { countPl } from '../edit/TileEditor.tsx';
import { ui } from '../edit/ui.ts';
import {
  shareProblem,
  useAcceptShare,
  useReceivedShare,
  useRejectShare,
  useShares,
} from './data.ts';

/** Who sent it, as far as this account may know. */
export function senderLabel(share: ReceivedShare): string {
  if (!share.sender) return 'konto, które już nie istnieje';
  return share.sender.name ? `${share.sender.name} (${share.sender.email})` : share.sender.email;
}

export function shareSize(share: { boards: number; tiles: number; photos: number; bytes: number }) {
  const parts = [countPl(share.boards, BOARDS_PL), countPl(share.tiles, TILES_PL)];
  if (share.photos > 0) {
    parts.push(`${countPl(share.photos, PHOTOS_PL)} (${formatBytes(share.bytes)})`);
  }
  return parts.join(', ');
}

/**
 * Boards other accounts sent (PLAN §2.8): look at them, then add one as a new folder on
 * the board open in the editor, or reject it. Nothing reaches the boards without this.
 */
export function InboxDialog({ me, board, onClose }: { me: Me; board: Board; onClose: () => void }) {
  const shares = useShares();
  const accept = useAcceptShare();
  const [done, setDone] = useState<string | null>(null);
  const received = shares.data?.received ?? [];

  return (
    <Dialog title="Otrzymane tablice" onClose={onClose} wide>
      <p className="mt-2 text-slate-700">
        Przyjęta tablica pojawi się jako nowy folder w pierwszym wolnym polu tablicy „{board.name}”.
        Twoje tablice się nie zmienią, dopóki jej nie przyjmiesz.
      </p>
      {done && (
        <p
          role="status"
          className="mt-3 rounded-xl bg-emerald-50 p-3 text-emerald-900 ring-1 ring-emerald-200"
        >
          {done}
        </p>
      )}
      {accept.isError && (
        <p role="alert" className="mt-3 text-red-700">
          {shareProblem(accept.error)}
        </p>
      )}
      {shares.isPending && (
        <p role="status" className="mt-3 text-slate-600">
          Wczytywanie…
        </p>
      )}
      {shares.isSuccess && received.length === 0 && (
        <p className="mt-3 text-slate-600">Nie ma otrzymanych tablic.</p>
      )}
      <ul className="mt-3 space-y-3">
        {received.map((share) => (
          <InboxItem
            key={share.id}
            me={me}
            share={share}
            board={board}
            busy={accept.isPending}
            onAccept={() => {
              setDone(null);
              accept.mutate(
                { id: share.id, boardId: board.id, rev: board.rev },
                {
                  onSuccess: () =>
                    setDone(`Dodano folder „${share.name}” na tablicy „${board.name}”.`),
                },
              );
            }}
          />
        ))}
      </ul>
      <div className="mt-6 flex justify-end">
        <button type="button" className={ui.primary} onClick={onClose}>
          Zamknij
        </button>
      </div>
    </Dialog>
  );
}

function InboxItem({
  me,
  share,
  board,
  busy,
  onAccept,
}: {
  me: Me;
  share: ReceivedShare;
  board: Board;
  busy: boolean;
  onAccept: () => void;
}) {
  const [preview, setPreview] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const reject = useRejectShare();
  return (
    <li className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200" aria-label={share.name}>
      <p className="text-lg font-bold text-brand-900">{share.name}</p>
      <p className="text-slate-700">Od: {senderLabel(share)}</p>
      <p className="text-sm text-slate-600">
        {shareSize(share)}. Otrzymana {formatDate(share.createdAt)}, czeka do{' '}
        {formatDate(share.expiresAt)}.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button type="button" className={ui.primary} disabled={busy} onClick={onAccept}>
          Dodaj na tablicę „{board.name}”
        </button>
        <button
          type="button"
          className={ui.secondary}
          aria-expanded={preview}
          onClick={() => setPreview((p) => !p)}
        >
          {preview ? 'Ukryj podgląd' : 'Podgląd'}
        </button>
        {!rejecting ? (
          <button type="button" className={ui.danger} onClick={() => setRejecting(true)}>
            Odrzuć
          </button>
        ) : (
          <span className="flex flex-wrap items-center gap-3">
            <span className="text-slate-800">Odrzucić? Nadawca zobaczy, że odrzucono.</span>
            <button
              type="button"
              className={ui.danger}
              disabled={reject.isPending}
              onClick={() => reject.mutate(share.id)}
            >
              Tak, odrzuć
            </button>
            <button type="button" className={ui.secondary} onClick={() => setRejecting(false)}>
              Anuluj
            </button>
          </span>
        )}
      </div>
      {reject.isError && (
        <p role="alert" className="mt-2 text-red-700">
          {shareProblem(reject.error)}
        </p>
      )}
      {preview && <SharePreview me={me} id={share.id} />}
    </li>
  );
}

function SharePreview({ me, id }: { me: Me; id: string }) {
  const view = useReceivedShare(id);
  const ownUrl = useCallback((key: string) => receivedSharePhotoUrl(id, key), [id]);
  const tree = useMemo(() => (view.data ? packageTree(view.data.package) : null), [view.data]);
  if (view.isPending) {
    return (
      <p role="status" className="mt-3 text-slate-600">
        Wczytywanie podglądu…
      </p>
    );
  }
  if (!tree) {
    return (
      <p role="alert" className="mt-3 text-red-700">
        {shareProblem(view.error)}
      </p>
    );
  }
  return <ReadOnlyBoards me={me} tree={tree} ownUrl={ownUrl} empty="Pusta tablica." />;
}
