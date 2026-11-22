import { useEffect } from 'react';

/** Keeps the screen on while the communication grid is shown (where supported). */
export function useWakeLock(): void {
  useEffect(() => {
    if (!('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let disposed = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible' || lock) return;
      try {
        lock = await navigator.wakeLock.request('screen');
        if (disposed) await lock.release();
        else lock.addEventListener('release', () => (lock = null));
      } catch {
        // Denied (battery saver, no permission): the screen simply may dim.
      }
    };
    // Released by the browser whenever the page is hidden; take it again on return.
    const onVisibility = () => void acquire();
    document.addEventListener('visibilitychange', onVisibility);
    void acquire();
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void lock?.release();
    };
  }, []);
}
