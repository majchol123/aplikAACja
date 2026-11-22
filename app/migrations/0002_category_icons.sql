-- Folder pictures of the category browser chosen by admins (F2 step 6), shared by all
-- accounts. Keyed by the stable category key of the set, so they survive set rebuilds.
-- Who changed what is in admin_audit (action category_icon.set / category_icon.reset).

CREATE TABLE category_icons (
  symbol_set TEXT NOT NULL CHECK (symbol_set IN ('arasaac', 'extra')),
  category_key TEXT NOT NULL CHECK (length(category_key) BETWEEN 1 AND 100),
  symbol_id INTEGER NOT NULL CHECK (symbol_id BETWEEN 0 AND 9999999999),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (symbol_set, category_key)
);
