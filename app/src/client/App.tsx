import type { Me } from '@relaacja/shared';
import { useState } from 'react';
import { useBoardTree } from './boards/data.ts';
import { Communication } from './comm/Communication.tsx';
import { Onboarding } from './Onboarding.tsx';
import { ParentPanel } from './parent/ParentPanel.tsx';

/** Opens in communication mode; parent mode is behind a 2-second hold (PLAN §2.5). */
export function App({ me }: { me: Me }) {
  const [mode, setMode] = useState<'child' | 'parent'>('child');
  const tree = useBoardTree();

  if (mode === 'parent') return <ParentPanel me={me} onExit={() => setMode('child')} />;
  if (tree.isPending) {
    return (
      <p
        className="flex min-h-dvh items-center justify-center text-lg text-slate-600"
        role="status"
      >
        Wczytywanie tablic…
      </p>
    );
  }
  if (tree.isError || !tree.data) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p role="alert" className="text-lg text-red-700">
          Nie udało się wczytać tablic. Sprawdź połączenie z internetem.
        </p>
        <button
          type="button"
          onClick={() => void tree.refetch()}
          className="rounded-full bg-brand-700 px-5 py-2.5 font-semibold text-white"
        >
          Spróbuj ponownie
        </button>
      </div>
    );
  }
  if (!tree.data.homeId) return <Onboarding onParentMode={() => setMode('parent')} />;
  return <Communication me={me} tree={tree.data} onParentMode={() => setMode('parent')} />;
}
