# aplikAACja

Bezpłatna aplikacja webowa AAC (komunikacja wspomagająca i alternatywna) dla osób, które przy mówieniu wspomagają się symbolami — dzieci, młodzieży i dorosłych. Po zalogowaniu kontem Google tablice z symboli ARASAAC i własnych zdjęć układa się w trybie edycji, a w trybie komunikacji buduje się z nich zdania odczytywane na głos.

## Stos

Cloudflare Workers (plan Free) + Static Assets, Durable Objects (SQLite, jeden na użytkownika, jurysdykcja EU), D1, Hono, Zod, React 19, Vite 8, Tailwind CSS 4, TanStack Query, dnd-kit. Testy: Vitest w runtime Workers (`@cloudflare/vitest-plugin`), Playwright + axe-core. Narzędzia offline (`tools/`): Python 3.13 + uv, Pillow, pytest, ruff.

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
pnpm --filter @aplikaacja/app db:migrate:local
pnpm --filter @aplikaacja/app dev          # http://localhost:5173
```

```bash
pnpm lint && pnpm typecheck && pnpm test   # lint, typy, testy jednostkowe i integracyjne Workera
pnpm --filter @aplikaacja/app e2e            # Playwright na produkcyjnym buildzie (vite preview)
(cd tools && uv run pytest && uv run ruff check . && uv run ruff format --check .)
```

Zestawy symboli lokalnie (opcjonalnie; bez nich biblioteka jest pusta, a E2E podstawia wektory testowe):

```bash
cd tools
uv run build_arasaac.py --out ../workers/arasaac/dist        # ~12,7 tys. symboli, ~185 MB
uv run build_lexicon.py --set-dir ../workers/arasaac/dist/sym/arasaac
# Starter board: spec tools/template/starter.toml → templates/starter.json + HTML preview
uv run build_template.py --spec template/starter.toml --set-dir ../workers/arasaac/dist/sym/arasaac \
  --out ../templates/starter.json --preview /tmp/starter-preview.html
```

Mirror w środowiskach serwuje osobny Worker na ścieżce `/sym/arasaac/*` (Route ma pierwszeństwo przed Custom Domain aplikacji). Dodatkowy zestaw działa lokalnie, gdy obok `vite dev` działa `pnpm --filter @aplikaacja/extra dev` z assetami w `workers/extra/dist/`; bez niego brama odpowiada `503`.

## Konfiguracja wdrożenia

- **Cloudflare** — token API z uprawnieniami: Workers Scripts (Edit), D1 (Edit), Workers Routes (Edit), Zone Settings (Edit) i Zone (Read) dla strefy z domeną aplikacji; w GitHub Actions jako sekrety środowisk `staging`/`production`/`symbols`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.
- **Strefa** (tylko dla aplikacji) — Email Obfuscation wyłączone (przepisywanie HTML łamie CSP i linki `mailto:`), reguła rate limiting dla `/api/auth/`.
- **Zmienna GitHub** `CONTACT_EMAIL` — adres kontaktowy wstawiany przy buildzie do `/prywatnosc` (build stagingu i produkcji bez niej się nie uda).
- **Google** — klient OAuth typu *Web application*, zakresy `openid email profile`, adres przekierowania `<origin>/api/auth/callback`; aplikacja *External* w produkcji wymaga strony głównej (`/`) i polityki prywatności (`/prywatnosc`).
- **Sekrety Workera** (`wrangler secret bulk --env <staging|production>`, wejście ze `stdin`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `OAUTH_COOKIE_KEY` (32 losowe bajty, base64url), `ADMIN_EMAILS` (adresy superadministratorów).

## Wdrażanie

Push na `main` → CI → staging (`staging.aplikaacja.one.pl`) → ręczna akceptacja → produkcja (`aplikaacja.one.pl`). Mirror ARASAAC odświeża `.github/workflows/arasaac-refresh.yml` (2× w tygodniu, przyrostowo; środowisko `symbols`). Prywatny Worker `aplikaacja-extra` wdraża operator poza CI.

## Kopie zapasowe

Dane kont są w Durable Objects i D1 Cloudflare; kopia trafia poza Cloudflare, zaszyfrowana [age](https://age-encryption.org). Artefakty GitHub Actions w publicznym repo są publiczne, więc kopie nigdy tam nie trafiają.

1. Klucz: `age-keygen -o key.txt` — klucz prywatny przechowuj **poza** maszyną, na której działa zadanie kopii (tylko nim da się ją odczytać).
2. Superadministrator: panel administratora → „Kopie zapasowe” → klucz publiczny (`age-keygen -y key.txt`) → „Włącz kopie zapasowe”. Klucz dostępu zadania pokazuje się raz; nowy klucz publiczny unieważnia poprzedni klucz dostępu.
3. Zadanie (np. codziennie z crona): `APLIKAACJA_BACKUP_TOKEN=… uv run --project tools tools/backup.py --origin https://<host> --out <katalog> --keep 30`. Serwer szyfruje każdy plik w Durable Objects, więc klucz dostępu daje wyłącznie szyfrogramy; zadanie odrzuca wszystko, co nie jest plikiem age. Zdjęcia pobierają się raz (są niezmienne). Migawki spoza ostatnich `--keep` i starsze niż `--max-age-days` (domyślnie 30, obietnica polityki prywatności) znikają razem ze zdjęciami, których już nie używają — limit wieku działa także wtedy, gdy przebieg się nie uda.
4. Odczyt: `age -d -i key.txt snapshots/<czas>/users/<id>.json.age` — tabele SQLite sejfu (kolumny i wiersze), D1 (`d1.json.age`: konta, dziennik zdarzeń, obrazki folderów; bez sesji) i katalog tablic.
5. Odtworzenie tablic konta: `node --experimental-strip-types app/scripts/restore-obz.ts --backup <katalog> --user <id> --identity key.txt --out tablice.obz` (opcjonalnie `--snapshot`, `--board`), potem w aplikacji tryb edycji → „Dodaj tablicę” → z pliku: całe drzewo jako folder, ze zdjęciami, przez zwykłą walidację i limity importu.
6. Szybkie cofnięcie bez kopii (PITR Cloudflare): superadministrator → panel administratora → konto → „Wcześniejszy stan konta” cofa cały sejf (tablice, zdjęcia, ustawienia, ulubione, historia) do wybranej minuty z ostatnich 30 dni; konto w D1 (rola, sesje) zostaje, wpis `user.restore` w dzienniku. Pomyłkę cofa przywrócenie stanu sprzed tej operacji. Lokalnie Cloudflare nie przechowuje historii (odpowiedź 503). Bazę D1 (konta, sesje, dziennik — wszystkie konta naraz) cofa `wrangler d1 time-travel restore aplikaacja-core --timestamp=<unix>` (7 dni na planie Free).

## Licencje

Kod: MIT ([`LICENSE`](LICENSE)). Symbole ARASAAC mają osobną licencję CC BY-NC-SA 4.0 i nie są częścią repozytorium; słownik odmian pochodzi z PoliMorf (BSD-2) — patrz [`NOTICE`](NOTICE).
