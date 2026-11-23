import {
  adminMediaUrl,
  type AdminUser,
  type BoardTree,
  type MediaList,
  type Me,
  type Settings,
  type SymbolSet,
} from '@relaacja/shared';
import { useCallback, useState } from 'react';
import { ReadOnlyBoards } from '../boards/ReadOnlyBoards.tsx';
import { countPl } from '../edit/TileEditor.tsx';
import { PRESET_LABELS } from '../settings/DevicePanel.tsx';
import { useAdminUserData } from './data.ts';
import { formatBytes, formatDate, PHOTOS_PL } from './format.ts';

type Part = 'boards' | 'photos' | 'settings';
const PARTS: { id: Part; label: string }[] = [
  { id: 'boards', label: 'Tablice' },
  { id: 'photos', label: 'Zdjęcia' },
  { id: 'settings', label: 'Ustawienia' },
];

/**
 * Read-only view of another account (PLAN §2.6): its boards as it sees them (folders open,
 * nothing speaks or changes), its photos and settings. Loading it is an audited opening.
 */
export function DataPreview({ me, user }: { me: Me; user: AdminUser }) {
  const data = useAdminUserData(user.id);
  const [part, setPart] = useState<Part>('boards');

  if (data.isPending) {
    return (
      <p role="status" className="mt-3 text-slate-600">
        Wczytywanie danych konta…
      </p>
    );
  }
  if (data.isError) {
    return (
      <p role="alert" className="mt-3 text-red-700">
        Nie udało się wczytać danych konta.
      </p>
    );
  }
  return (
    <div className="mt-3" data-testid="data-preview">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Część danych">
        {PARTS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={part === p.id}
            onClick={() => setPart(p.id)}
            className="rounded-full border-2 border-slate-200 px-4 py-1.5 text-sm font-semibold text-slate-700 aria-pressed:border-brand-700 aria-pressed:bg-brand-50 aria-pressed:text-brand-900"
          >
            {p.label}
          </button>
        ))}
      </div>
      {part === 'boards' && <BoardsPreview me={me} userId={user.id} tree={data.data.tree} />}
      {part === 'photos' && <PhotosPreview userId={user.id} media={data.data.media} />}
      {part === 'settings' && <SettingsPreview settings={data.data.settings} />}
    </div>
  );
}

function BoardsPreview({ me, userId, tree }: { me: Me; userId: string; tree: BoardTree }) {
  const ownUrl = useCallback((id: string) => adminMediaUrl(userId, id), [userId]);
  return (
    <ReadOnlyBoards me={me} tree={tree} ownUrl={ownUrl} empty="To konto nie ma jeszcze tablic." />
  );
}

function PhotosPreview({ userId, media }: { userId: string; media: MediaList }) {
  if (media.items.length === 0) {
    return <p className="mt-3 text-slate-600">To konto nie ma własnych zdjęć.</p>;
  }
  return (
    <div className="mt-3">
      <p className="text-sm text-slate-600">
        {countPl(media.usage.count, PHOTOS_PL)}, razem {formatBytes(media.usage.bytes)}.
        Przeglądarka nie zachowuje tych zdjęć po zamknięciu podglądu.
      </p>
      <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
        {media.items.map((item) => (
          <li key={item.id} className="rounded-xl bg-slate-50 p-2 ring-1 ring-slate-200">
            <img
              src={adminMediaUrl(userId, item.id)}
              alt={item.label}
              width={item.width}
              height={item.height}
              loading="lazy"
              className="aspect-square w-full rounded-lg bg-white object-contain"
            />
            <p className="mt-1 truncate text-sm font-semibold text-slate-800">{item.label}</p>
            <p className="text-xs text-slate-600">
              {formatDate(item.createdAt)}, {formatBytes(item.bytes)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SET_LABEL: Record<SymbolSet, string> = {
  arasaac: 'ARASAAC',
  extra: 'Dodatkowy zestaw',
  own: 'Własne zdjęcia',
};

const SOURCES: Record<Settings['searchSources'], string> = {
  tiles: 'kafelki',
  library: 'biblioteka symboli',
  both: 'kafelki i biblioteka symboli',
};

const factor = (n: number) => `${n.toLocaleString('pl-PL', { maximumFractionDigits: 2 })}×`;

function SettingsPreview({ settings }: { settings: Settings }) {
  const hidden = [
    settings.contentFilter.hideSexual && 'seksualność',
    settings.contentFilter.hideViolence && 'przemoc',
  ].filter(Boolean);
  const rows: [string, string][] = [
    ['Zestawy symboli (kolejność)', settings.activeSets.map((s) => SET_LABEL[s]).join(', ')],
    ['Ukryte w bibliotece', hidden.length ? hidden.join(', ') : 'nic'],
    [
      'Głos',
      `${PRESET_LABELS[settings.speech.preset]}, tempo ${factor(settings.speech.rate)}, wysokość ${factor(settings.speech.pitch)}`,
    ],
    ['Wielkie litery na kafelkach', settings.uppercaseLabels ? 'tak' : 'nie'],
    ['Przycisk „Wszystkie symbole”', settings.showAllSymbols ? 'tak' : 'nie'],
    ['Po wybraniu słowa w folderze wraca na pulpit', settings.returnToHome ? 'tak' : 'nie'],
    ['Wyszukiwanie', SOURCES[settings.searchSources]],
  ];
  return (
    <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="font-medium text-slate-600">{term}</dt>
          <dd className="text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
