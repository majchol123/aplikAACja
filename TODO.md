# TODO — relAACja

Architektura i decyzje: [`docs/PLAN.md`](docs/PLAN.md).

## F0 Fundamenty
- [x] Monorepo pnpm: `app/`, `packages/shared/`, ESLint/Prettier, `tsc --strict` (TS 6.0 — `typescript-eslint` nie obsługuje jeszcze TS 7)
- [x] `.gitignore`, `NOTICE` (licencje ARASAAC), `README.md`
- [x] `wrangler.jsonc`: środowiska staging/production, Custom Domains, `workers_dev=false`, `preview_urls=false`, D1, DO `UserVault` (`new_sqlite_classes`), `observability`
- [x] D1 `relaacja-core-staging` i `relaacja-core` w jurysdykcji EU + migracja `0001` (zastosowana na stagingu)
- [x] DO `UserVault`: runner migracji, schemat v1, jurysdykcja EU (`DO_JURISDICTION=eu`, zweryfikowane na stagingu), limit zapisów per użytkownik
- [x] Google OIDC (PKCE, `state`/`nonce` w zaszyfrowanym cookie, weryfikacja `id_token` przez JWKS)
- [x] Sesje `__Host-relaacja_sid`, blokada, „wyloguj wszystkie”, rotacja tokenu, bootstrap `superadmin` z `ADMIN_EMAILS`
- [x] Nagłówki bezpieczeństwa + CSP (`_headers` generowany przy buildzie), CSRF (dokładny `Origin` + `Sec-Fetch-Site` + `X-Relaacja`)
- [x] Rejestr tras + macierz autoryzacji (test pada przy trasie bez wpisu)
- [x] Strony publiczne `/` (działa bez JS) i `/prywatnosc`
- [x] Testy: 79 Vitest (runtime Workers) + 10 Playwright (2 profile, axe-core, brak błędów konsoli/CSP)
- [x] Staging wdrożony: https://relaacja-staging.jagiellona.one.pl (smoke test OK)
- [x] Workflowy: `ci.yml`, `deploy.yml` (staging → akceptacja → produkcja), `codeql.yml`, Dependabot; akcje przypięte do SHA
- [x] Środowiska GitHub `staging`/`production` (wymagany recenzent, tylko `main`) + sekrety środowisk
- [x] Publiczne repo bez danych prywatnych (zestawy spoza repo, konfiguracja operatora)
- [x] Pierwszy push na GitHub (`ebb110c`): CI, CodeQL i deploy stagingu zielone; alerty Dependabot, secret scanning i push protection włączone
- [x] Sekrety produkcji ustawione
- [x] Produkcja wdrożona: https://relaacja.jagiellona.one.pl (migracja D1, smoke test OK; smoke czeka teraz do 3 min na DNS/certyfikat nowej domeny)
- [x] Logowanie Google zweryfikowane na stagingu (konto superadmina)
- [ ] Strefa: Configuration Rule (Email Obfuscation off dla `relaacja*`)
- [ ] Service binding `EXTRA_SET` — przeniesione do F1 (Worker docelowy musi istnieć przed deployem)

### Utwardzenie z przeglądu bezpieczeństwa (2026-11-22, 0 podatności ≥ 8/10)
- [x] `deploy.yml` bez `workflow_run` (semgrep `workflow-run-target-code-checkout`): push na `main` → `ci.yml` (`workflow_call`) → staging → produkcja
- [x] Rola `superadmin` sprawdzana z `ADMIN_EMAILS` przy każdym żądaniu (odebranie działa natychmiast)
- [x] Decyzja: superadmini bez przypinania do Google `sub`
- [x] CI: `CLOUDFLARE_API_TOKEN` tylko w krokach `wrangler`; sekrety środowisk `staging`/`production` z regułą gałęzi `main`; ochrona `production` i zatwierdzanie PR-ów z zewnątrz ustawione przed pierwszym pushem
- [x] Odrzucanie żądań z powtórzonym cookie `__Host-relaacja_*` (`400 cookie_conflict`)
- [x] `/prywatnosc`: adres IP i metadane żądań, logi 3 dni, przetwarzanie przez Cloudflare poza UE (SCC/DPF)
- [ ] F1: brama `/sym/extra/*` autoryzuje z D1 (`extra_set_enabled`), nigdy z zapisanych `activeSets`

## F1 Zestawy symboli
- [ ] Wspólna normalizacja TS + Python ze wspólnymi wektorami testowymi
- [ ] `tools/build_arasaac.py`: katalog `pl`, pobieranie (throttling), WebP, indeks, `_headers`
- [ ] Worker `relaacja-arasaac` (Route `/sym/arasaac/*` na hostach aplikacji) + `arasaac-refresh.yml` (cron miesięczny, przyrostowo)
- [ ] Worker `relaacja-extra` (prywatny, tylko service binding; zawartość i deploy poza repo)
- [ ] Brama `/sym/extra/*` (sesja + flaga + walidacja ścieżki) + testy traversal
- [ ] `tools/build_lexicon.py`: PoliMorf → `forms.json.gz` (≤ 2 MB)
- [ ] Wyszukiwanie w kliencie (zestawy aktywne, odmiana, bez polskich znaków, filtr `sex`/`violence`)

## F2 Tablice
- [ ] Tryb komunikacji: siatka, pasek zdaniowy (⌫, 🗑, ▶), foldery, okruszki, powrót na pulpit
- [ ] TTS: Web Speech API, presety (Kobieta/Mężczyzna/Dziewczynka/Chłopiec), przypisanie głosu per urządzenie, test głosu
- [ ] Motoryka: aktywacja przy puszczeniu, debounce, minimalny czas przytrzymania, ignorowanie dodatkowych palców, Wake Lock
- [ ] Tryb rodzica: blokada (przytrzymanie 2 s + opcjonalny PIN)
- [ ] Edytor: kafelki słowo/folder, drag & drop, siatka, przenoszenie między tablicami
- [ ] Wybór symbolu: warianty obok siebie, preferowany wariant słowa
- [ ] Edycja kafelka: etykieta, położenie góra/dół, czcionka S–XL, Fitzgerald tło/ramka
- [ ] Własne symbole: galeria/aparat, kadrowanie, WebP ≤ 512 px, walidacja serwera, kwoty
- [ ] Ustawienia: zestawy + kolejność, głos, zachowanie, motoryka, filtr treści
- [ ] `tools/template/` + `templates/starter.json` + podgląd HTML; tworzenie przy pierwszym logowaniu
- [ ] Manifest PWA + Service Worker (powłoka aplikacji i obrazki)
- [ ] Atrybucja ARASAAC: „O aplikacji”, ekran logowania, stopka biblioteki

## F3 Wyszukiwarka, historia, ulubione
- [ ] Wyszukiwarka w trybie dziecka: kafelki (ścieżka + podświetlenie) i biblioteka (do paska)
- [ ] Historia 50 wypowiedzi, ulubione frazy

## F4 Panel admina
- [ ] Lista kont, blokada/odblokowanie, twarde usunięcie (idempotentne), dodatkowy zestaw, role admin
- [ ] Podgląd danych użytkownika (tylko odczyt) + audyt

## F5 Generator fraz (AraWrite)
- [ ] Tokenizacja, dopasowanie wielowyrazowe, lematyzacja, ranking kandydatów
- [ ] Edycja piktogramów, wygląd, eksport PNG, druk ze stopką ARASAAC, zapis do paska/ulubionych/tablicy
- [ ] Opcjonalnie dyktowanie (Web Speech Recognition)

## F6 OBF
- [ ] Codec OBF/OBZ w `packages/shared` + rozszerzenia `ext_relaacja_*`
- [ ] Eksport (konto/tablica), import partiami, round-trip w E2E

## F7 Utwardzenie i v1.0
- [ ] OWASP ZAP baseline na stagingu, test nagłówków
- [ ] Testy na urządzeniach: tablet z Androidem, iPad
- [ ] Pomoc dla rodziców (instalacja PWA, kiosk systemowy, głosy)
- [ ] Kopie zapasowe (eksport superadmina, kopia szyfrowana `age` poza Cloudflare)
- [ ] Opcjonalnie: raport zużycia limitów planu Free

## Backlog
- [ ] Skanowanie przełącznikami, motyw wysokiego kontrastu
- [ ] Nagrania głosu rodzica, ukrywanie kafelków, tekst mówiony ≠ etykieta
- [ ] Usuwanie konta przez użytkownika, własna domena, wiele profili dzieci
