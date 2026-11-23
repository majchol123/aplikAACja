import { PutCategoryIconSchema, type CategoryIcons, type LibrarySet } from '@aplikaacja/shared';
import type { Context } from 'hono';
import type { AppContext } from '../context.ts';
import { auditStatement } from '../lib/audit.ts';

type Ctx = Context<AppContext>;

/** Far more than both sets have folders (590 + 59): a runaway client cannot fill D1. */
export const MAX_CATEGORY_ICONS = 5000;

interface IconRow {
  symbol_set: LibrarySet;
  category_key: string;
  symbol_id: number;
}

/** Every admin's folder picture; those of the extra set only for accounts granted it. */
async function iconsFor(db: D1Database, extraSet: boolean): Promise<CategoryIcons> {
  const { results } = await db
    .prepare(
      'SELECT symbol_set, category_key, symbol_id FROM category_icons ORDER BY symbol_set, category_key',
    )
    .all<IconRow>();
  const arasaac: Record<string, number> = {};
  const extra: Record<string, number> = {};
  for (const row of results) {
    (row.symbol_set === 'arasaac' ? arasaac : extra)[row.category_key] = row.symbol_id;
  }
  return extraSet ? { arasaac, extra } : { arasaac };
}

/** GET /api/symbols/category-icons */
export async function getCategoryIcons(c: Ctx): Promise<Response> {
  return c.json(await iconsFor(c.env.DB, c.get('user').extraSet));
}

/**
 * PUT /api/admin/category-icons — sets (or with `symbol: null` resets) the picture of one
 * folder for every account, with an audit entry. The symbol is not checked against the set
 * index (the Worker never loads it): a symbol the set does not have makes clients fall back
 * to the automatic picture.
 */
export function putCategoryIcon(now: () => number) {
  return async (c: Ctx): Promise<Response> => {
    const input = PutCategoryIconSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ error: 'invalid_request' }, 400);
    const { set, key, symbol } = input.data;
    const user = c.get('user');
    // Same rule as everywhere else: the extra set only with the grant from D1.
    if (set === 'extra' && !user.extraSet) return c.json({ error: 'extra_set_not_enabled' }, 403);

    const db = c.env.DB;
    const at = now();
    const audit = auditStatement(db, {
      at,
      actor: user.userId,
      action: symbol === null ? 'category_icon.reset' : 'category_icon.set',
      details: { set, key, symbol },
    });
    if (symbol === null) {
      await db.batch([
        db
          .prepare('DELETE FROM category_icons WHERE symbol_set = ?1 AND category_key = ?2')
          .bind(set, key),
        audit,
      ]);
    } else {
      const others = await db
        .prepare(
          'SELECT COUNT(*) AS n FROM category_icons WHERE NOT (symbol_set = ?1 AND category_key = ?2)',
        )
        .bind(set, key)
        .first<{ n: number }>();
      if ((others?.n ?? 0) >= MAX_CATEGORY_ICONS) return c.json({ error: 'quota_exceeded' }, 422);
      await db.batch([
        db
          .prepare(
            `INSERT INTO category_icons (symbol_set, category_key, symbol_id, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (symbol_set, category_key)
             DO UPDATE SET symbol_id = excluded.symbol_id, updated_at = excluded.updated_at`,
          )
          .bind(set, key, symbol, at),
        audit,
      ]);
    }
    return c.json(await iconsFor(db, user.extraSet));
  };
}
