import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { loadSession } from './api.ts';
import './styles.css';

const LOGIN_ERRORS: Record<string, string> = {
  logowanie: 'Logowanie nie powiodło się. Spróbuj ponownie.',
  anulowano: 'Logowanie zostało anulowane.',
  zablokowane: 'To konto zostało zablokowane przez administratora. Dane konta są zachowane.',
  offline:
    'Brak połączenia z internetem. relAACja działa tylko online — sprawdź Wi-Fi i odśwież stronę.',
  unavailable: 'Serwer chwilowo nie odpowiada. Spróbuj ponownie za chwilę.',
};

function showLanding(errorKey: string | null): void {
  const message = errorKey ? LOGIN_ERRORS[errorKey] : undefined;
  const box = document.getElementById('login-error');
  if (box && message) {
    box.textContent = message;
    box.classList.remove('hidden');
  }
  document.documentElement.dataset.state = 'anon';
}

/** Caches only public files (src/sw/routes.ts); production builds only, dev uses HMR. */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker
    .register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .catch(() => undefined); // the app works the same without it
}

async function boot(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const error = params.get('blad');
  if (error) history.replaceState(null, '', location.pathname);

  registerServiceWorker();
  const session = await loadSession();
  if (session.kind !== 'user') {
    showLanding(
      session.kind === 'blocked' ? 'zablokowane' : session.kind === 'anon' ? error : session.kind,
    );
    return;
  }
  document.getElementById('landing')?.remove();
  document.documentElement.dataset.state = 'user';
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
  });
  const container = document.getElementById('app');
  if (!container) throw new Error('#app container missing');
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App me={session.me} />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void boot();
