import type { AppEnv } from './env.ts';
import type { SessionUser } from './auth/session.ts';

export interface AppVariables {
  /** Set by the auth guard; the only source of identity in route handlers. */
  user: SessionUser;
  /** Set by the backup-token guard: what to encrypt for, and who set it up. */
  backup: { recipient: string; createdBy: string };
}

export interface AppContext {
  Bindings: AppEnv;
  Variables: AppVariables;
}
