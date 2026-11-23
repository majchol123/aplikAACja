import type { Me } from '@aplikaacja/shared';
import { useState } from 'react';
import { AdminScreen } from './admin/AdminScreen.tsx';
import { useBoardTree } from './boards/data.ts';
import { Communication } from './comm/Communication.tsx';
import { useDeviceSettings } from './device.ts';
import { EditMode } from './edit/EditMode.tsx';
import { PinPad } from './edit/PinPad.tsx';
import { Onboarding } from './Onboarding.tsx';
import { SettingsScreen } from './settings/SettingsScreen.tsx';

type Mode = 'communicate' | 'edit' | 'settings' | 'admin';

/**
 * Opens in communication mode. Edit mode and settings are behind the PIN of this device or,
 * without one, a 2-second hold (PLAN §2.2).
 */
export function App({ me }: { me: Me }) {
  const [mode, setMode] = useState<Mode>('communicate');
  const [unlocking, setUnlocking] = useState<Mode | null>(null);
  // Board on screen, shared by communication and edit mode; null = home.
  const [boardId, setBoardId] = useState<string | null>(null);
  const [device] = useDeviceSettings();
  const tree = useBoardTree();

  const unlock = (target: Mode) => (device.pin ? setUnlocking(target) : setMode(target));
  const pinPad = unlocking && device.pin && (
    <PinPad
      pin={device.pin}
      onCancel={() => setUnlocking(null)}
      onUnlock={() => {
        setMode(unlocking);
        setUnlocking(null);
      }}
    />
  );
  const hasHome = Boolean(tree.data?.homeId);

  if (mode === 'admin') return <AdminScreen me={me} onBack={() => setMode('settings')} />;
  if (mode === 'settings') {
    return (
      <SettingsScreen
        me={me}
        backLabel={hasHome ? 'Wróć do edycji' : 'Wróć'}
        onBack={() => setMode(hasHome ? 'edit' : 'communicate')}
        onAdmin={() => setMode('admin')}
      />
    );
  }
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
  if (!tree.data.homeId) {
    return (
      <>
        <Onboarding onSettings={() => unlock('settings')} />
        {pinPad}
      </>
    );
  }
  if (mode === 'edit') {
    return (
      <EditMode
        me={me}
        tree={tree.data}
        boardId={boardId}
        onBoardChange={setBoardId}
        onSettings={() => setMode('settings')}
        onDone={() => setMode('communicate')}
      />
    );
  }
  return (
    <>
      <Communication
        me={me}
        tree={tree.data}
        boardId={boardId}
        onBoardChange={setBoardId}
        onEditMode={() => unlock('edit')}
      />
      {pinPad}
    </>
  );
}
