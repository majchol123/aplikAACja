import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { effectiveRole, parseAdminEmails } from '../src/worker/auth/users.ts';
import { hasDuplicateGuardedCookie } from '../src/worker/security/cookies.ts';
import { insertUser, makeApp, sessionCookie } from './helpers.ts';

const storedRole = async (id: string) =>
  (await env.DB.prepare('SELECT role FROM users WHERE id = ?').bind(id).first<{ role: string }>())!
    .role;

describe('superadmin follows ADMIN_EMAILS on every request', () => {
  it('maps roles like the login upsert does', () => {
    const admins = parseAdminEmails('Root@Example.com, other@example.com');
    expect(effectiveRole('user', 'root@example.com', admins)).toBe('superadmin');
    expect(effectiveRole('admin', 'ROOT@example.com', admins)).toBe('superadmin');
    expect(effectiveRole('superadmin', 'gone@example.com', admins)).toBe('user');
    expect(effectiveRole('admin', 'gone@example.com', admins)).toBe('admin');
    expect(effectiveRole('user', 'gone@example.com', admins)).toBe('user');
  });

  it('revokes a delisted superadmin immediately, without a new login', async () => {
    const t = makeApp();
    const root = await insertUser({ role: 'superadmin', email: 'root@example.com' });
    const cookie = await sessionCookie(root.id);
    const admin = () => t.call('/api/admin/users', { headers: { Cookie: cookie } });

    expect((await admin()).status).toBe(200);

    const delisted = { ADMIN_EMAILS: 'second@example.com' };
    const res = await t.call('/api/admin/users', { headers: { Cookie: cookie } }, delisted);
    expect(res.status).toBe(403);
    const me = await t.call('/api/me', { headers: { Cookie: cookie } }, delisted);
    expect(await me.json()).toMatchObject({ role: 'user' });
    expect(await storedRole(root.id)).toBe('user');
  });

  it('a stored superadmin role alone grants nothing', async () => {
    const t = makeApp();
    const forged = await insertUser({ role: 'superadmin', email: 'not-listed@example.com' });
    const res = await t.call('/api/admin/users', {
      headers: { Cookie: await sessionCookie(forged.id) },
    });
    expect(res.status).toBe(403);
  });
});

describe('duplicate __Host- cookies (cookie tossing)', () => {
  it('detects repeats, including whitespace look-alikes', () => {
    expect(hasDuplicateGuardedCookie(undefined)).toBe(false);
    expect(hasDuplicateGuardedCookie('__Host-aplikaacja_sid=a; theme=dark')).toBe(false);
    expect(hasDuplicateGuardedCookie('__Host-aplikaacja_sid=a; __Host-aplikaacja_oauth=b')).toBe(
      false,
    );
    expect(hasDuplicateGuardedCookie('__Host-aplikaacja_sid=a; __Host-aplikaacja_sid=b')).toBe(
      true,
    );
    expect(hasDuplicateGuardedCookie('__Host-aplikaacja_oauth=a;__Host-aplikaacja_oauth=b')).toBe(
      true,
    );
    expect(hasDuplicateGuardedCookie('__Host-aplikaacja_sid=a;  __Host-aplikaacja_sid =b')).toBe(
      true,
    );
  });

  it('rejects API requests carrying a tossed session cookie', async () => {
    const t = makeApp();
    const victim = await insertUser();
    const attacker = await insertUser();
    const victimSid = (await sessionCookie(victim.id)).split('=')[1];
    const attackerSid = (await sessionCookie(attacker.id)).split('=')[1];
    const res = await t.call('/api/me', {
      headers: {
        Cookie: `__Host-aplikaacja_sid=${attackerSid}; __Host-aplikaacja_sid=${victimSid}`,
      },
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'cookie_conflict' });
  });

  it('rejects an OAuth callback with a tossed state cookie', async () => {
    const t = makeApp();
    const res = await t.call('/api/auth/callback?code=x&state=y', {
      headers: { Cookie: '__Host-aplikaacja_oauth=a; __Host-aplikaacja_oauth=b' },
    });
    expect(res.status).toBe(400);
  });
});
