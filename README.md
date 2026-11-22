# relAACja

Bezpłatna aplikacja webowa AAC (komunikacja wspomagająca i alternatywna) dla dzieci z trudnościami w komunikacji werbalnej. Rodzic loguje się kontem Google, układa tablice z piktogramów ARASAAC i własnych zdjęć, a dziecko buduje z symboli zdania odczytywane na głos.

- Architektura, decyzje i etapy: [`docs/PLAN.md`](docs/PLAN.md)
- Backlog: [`TODO.md`](TODO.md)

## Stos

Cloudflare Workers (plan Free) + Static Assets, Durable Objects (SQLite, jeden na użytkownika, jurysdykcja EU), D1, Hono, Zod, React 19, Vite 8, Tailwind CSS 4, TanStack Query. Testy: Vitest w runtime Workers (`@cloudflare/vitest-plugin`), Playwright + axe-core. Narzędzia offline (`tools/`): Python 3.13 + uv, Pillow, pytest, ruff.

| Katalog | Zawartość |
|---|---|
| `app/` | Worker główny (API Hono, `UserVault`, brama `/sym/extra/*`) i SPA |
| `packages/shared/` | schematy Zod, normalizacja tekstu, wyszukiwarka symboli, wspólne wektory testowe |
| `workers/arasaac/` | publiczny mirror ARASAAC (Worker z samymi assetami, Route `/sym/arasaac/*`) |
| `workers/extra/` | prywatny Worker opcjonalnego dodatkowego zestawu (assety poza repozytorium) |
| `tools/` | budowa mirrora ARASAAC i indeksu, słownik odmian z PoliMorf |

## Praca lokalna

Wymagania: Node.js ≥ 22.12, pnpm 12.

```bash
pnpm install
cp app/.dev.vars.example app/.dev.vars   # uzupełnij; DEV_AUTH=1 włącza logowanie testowe na localhost
pnpm --filter @relaacja/app db:migrate:local
pnpm --filter @relaacja/app dev          # http://localhost:5173
```

```bash
pnpm lint && pnpm typecheck && pnpm test   # lint, typy, testy jednostkowe i integracyjne Workera
pnpm --filter @relaacja/app e2e            # Playwright na produkcyjnym buildzie (vite preview)
(cd tools && uv run pytest && uv run ruff check . && uv run ruff format --check .)
```

Zestawy symboli lokalnie (opcjonalnie; bez nich biblioteka jest pusta, a E2E podstawia wektory testowe):

```bash
cd tools
uv run build_arasaac.py --out ../workers/arasaac/dist        # ~12,7 tys. piktogramów, ~185 MB
uv run build_lexicon.py --set-dir ../workers/arasaac/dist/sym/arasaac
```

Mirror w środowiskach serwuje osobny Worker na ścieżce `/sym/arasaac/*` (Route ma pierwszeństwo przed Custom Domain aplikacji). Dodatkowy zestaw działa lokalnie, gdy obok `vite dev` działa `pnpm --filter @relaacja/extra dev` z assetami w `workers/extra/dist/`; bez niego brama odpowiada `503`.

## Konfiguracja wdrożenia

- **Cloudflare** — token API z uprawnieniami: Workers Scripts (Edit), D1 (Edit), Workers Routes (Edit) i Config Rules (Edit) dla strefy z domeną aplikacji; w GitHub Actions jako sekrety środowisk `staging`/`production`/`symbols`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- **Strefa** — Configuration Rule wyłączająca Email Obfuscation dla hostów aplikacji (przepisywanie HTML łamie CSP i linki `mailto:`).
- **Zmienna GitHub** `CONTACT_EMAIL` — adres kontaktowy wstawiany przy buildzie do `/prywatnosc` (build stagingu i produkcji bez niej się nie uda).
- **Google** — klient OAuth typu *Web application*, zakresy `openid email profile`, adres przekierowania `<origin>/api/auth/callback`; aplikacja *External* w produkcji wymaga strony głównej (`/`) i polityki prywatności (`/prywatnosc`).
- **Sekrety Workera** (`wrangler secret bulk --env <staging|production>`, wejście ze `stdin`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_COOKIE_KEY` (32 losowe bajty, base64url), `ADMIN_EMAILS` (adresy superadministratorów).

## Wdrażanie

Push na `main` → CI → staging (`relaacja-staging.jagiellona.one.pl`) → ręczna akceptacja → produkcja (`relaacja.jagiellona.one.pl`). Mirror ARASAAC odświeża `.github/workflows/arasaac-refresh.yml` (2× w tygodniu, przyrostowo; środowisko `symbols`). Prywatny Worker `relaacja-extra` wdraża operator poza CI. Szczegóły w `docs/PLAN.md` §6.

## Licencje

Kod: MIT ([`LICENSE`](LICENSE)). Piktogramy ARASAAC mają osobną licencję CC BY-NC-SA 4.0 i nie są częścią repozytorium; słownik odmian pochodzi z PoliMorf (BSD-2) — patrz [`NOTICE`](NOTICE).
