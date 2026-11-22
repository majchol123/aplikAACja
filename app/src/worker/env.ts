import type { Catalog } from './catalog/catalog.ts';
import type { UserVault } from './vault/user-vault.ts';

/** Bindings, vars and secrets of the main Worker (secrets via `wrangler secret put`). */
export interface AppEnv {
  DB: D1Database;
  USER_VAULT: DurableObjectNamespace<UserVault>;
  /** The catalogue of public boards: one object (catalog/catalog.ts). */
  CATALOG: DurableObjectNamespace<Catalog>;
  ASSETS: Fetcher;
  /** Private assets Worker with the extra symbol set; absent locally unless it runs too. */
  EXTRA_SET?: Fetcher;
  /** "eu" in deployed environments; unset locally (workerd has no jurisdictions). */
  DO_JURISDICTION?: string;
  /** Exact public origin of this deployment, e.g. https://relaacja.jagiellona.one.pl */
  APP_ORIGIN: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** base64url-encoded 32-byte AES-GCM key for the short-lived OAuth state cookie. */
  OAUTH_COOKIE_KEY: string;
  /** Superadmin e-mail addresses separated by newlines, commas or spaces. */
  ADMIN_EMAILS: string;
  /** "1" enables the fake login used by E2E tests; honoured only on localhost (.dev.vars only). */
  DEV_AUTH?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cloudflare {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env extends AppEnv {}
  }
}
