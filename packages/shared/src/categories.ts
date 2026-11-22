import type { SymbolHit } from './search.ts';
import {
  isFiltered,
  SET_BASE,
  type CategoryFile,
  type FitzgeraldRole,
  type LibrarySet,
  type SymbolFilter,
  type SymbolIndex,
} from './symbols.ts';

export interface CategoryFolder {
  id: number;
  /** Stable key (survives rebuilds); null for sets built without one. */
  key: string | null;
  name: string;
  /** Same-origin picture URL; null when no visible symbol can stand for the folder. */
  icon: string | null;
  /** The icon is the set's own folder picture (drawn as a folder already), not a symbol. */
  ownIcon: boolean;
  /** The icon is the symbol an admin chose for the folder. */
  custom: boolean;
  /** Visible symbols in the folder and its subfolders, each counted once. */
  count: number;
}

/** Folder pictures chosen by admins: category key → symbol id (CategoryIcons of the set). */
export type FolderIcons = ReadonlyMap<string, number>;
const NO_ICONS: FolderIcons = new Map();

export interface CategoryView {
  set: LibrarySet;
  /** Null for the top level. */
  id: number | null;
  /** From the top-level folder down to this one; empty at the top level. */
  path: { id: number; name: string }[];
  /** The open folder itself (null at the top level). */
  folder: CategoryFolder | null;
  /** Subfolders with at least one visible symbol, in the order of the set. */
  folders: CategoryFolder[];
  /** Visible symbols listed in this folder itself, alphabetically. */
  symbols: SymbolHit[];
}

interface Item {
  id: number;
  src: string;
  label: string;
  role: FitzgeraldRole;
  flags: number;
}

interface Node {
  id: number;
  key: string | null;
  name: string;
  parent: number | null;
  icon: number | null;
  file: string | null;
  children: number[];
  /** Positions in `items`, index order until sorted for a view. */
  items: number[];
  sorted: boolean;
}

interface Visible {
  count: number;
  /** Lowest index position of a visible symbol in the subtree. */
  first: number | null;
}

const collator = new Intl.Collator('pl', { sensitivity: 'base', numeric: true });

/**
 * Read-only browser over a set's category folders (PLAN §3.3, F2 step 6). Folders are
 * virtual: they are not boards of the account, so 600 of them cost no quota. The content
 * filter hides symbols, and with them every folder that is left empty.
 */
export class CategoryTree {
  readonly set: LibrarySet;
  private readonly nodes = new Map<number, Node>();
  private readonly roots: number[] = [];
  private readonly items: Item[];
  private readonly byId = new Map<number, number>();
  private readonly visibility = new Map<string, Map<number, Visible>>();

  constructor(file: CategoryFile, index: SymbolIndex) {
    if (file.set !== index.set) throw new Error(`categories of ${file.set} for ${index.set}`);
    this.set = index.set;
    for (const raw of file.nodes) {
      if (this.nodes.has(raw.id)) throw new Error(`category ${raw.id} is repeated`);
      const parent = raw.p ?? null;
      const above = parent === null ? null : this.nodes.get(parent);
      if (above === undefined) throw new Error(`category ${raw.id} comes before its parent`);
      this.nodes.set(raw.id, {
        id: raw.id,
        key: raw.k ?? null,
        name: raw.n,
        parent,
        icon: raw.i ?? null,
        file: raw.f ?? null,
        children: [],
        items: [],
        sorted: false,
      });
      (above ? above.children : this.roots).push(raw.id);
    }
    const base = SET_BASE[index.set];
    this.items = index.items.map((raw, position) => {
      this.byId.set(raw.id, position);
      // Unknown folder ids (a newer index with an older tree) are skipped.
      for (const id of new Set(raw.g ?? [])) this.nodes.get(id)?.items.push(position);
      return {
        id: raw.id,
        src: base + raw.f,
        label: raw.k[0] ?? '',
        role: raw.r,
        flags: raw.x ?? 0,
      };
    });
  }

  has(id: number): boolean {
    return this.nodes.has(id);
  }

  /** The top level (id null) or one folder; null for an id the tree does not know. */
  view(
    id: number | null,
    filter: SymbolFilter,
    icons: FolderIcons = NO_ICONS,
  ): CategoryView | null {
    const node = id === null ? null : this.nodes.get(id);
    if (node === undefined) return null;
    const visible = this.visible(filter);
    const summary = (folder: Node): CategoryFolder | null => {
      const stats = visible.get(folder.id);
      if (!stats) return null;
      return {
        id: folder.id,
        key: folder.key,
        name: folder.name,
        ...this.icon(folder, stats, filter, icons),
        count: stats.count,
      };
    };
    const folders = (node ? node.children : this.roots).flatMap((childId) => {
      const child = this.nodes.get(childId);
      const folder = child ? summary(child) : null;
      return folder?.count ? [folder] : [];
    });

    const path: CategoryView['path'] = [];
    for (let at = node; at; at = at.parent === null ? null : (this.nodes.get(at.parent) ?? null)) {
      path.unshift({ id: at.id, name: at.name });
    }

    let symbols: SymbolHit[] = [];
    if (node) {
      if (!node.sorted) {
        node.items.sort((a, b) => this.compare(a, b));
        node.sorted = true;
      }
      symbols = node.items.flatMap((position) => {
        const item = this.items[position];
        return item && !isFiltered(item.flags, filter)
          ? [{ set: this.set, ...item, score: 0 }]
          : [];
      });
    }
    return {
      set: this.set,
      id: node ? node.id : null,
      path,
      folder: node ? summary(node) : null,
      folders,
      symbols,
    };
  }

  private compare(a: number, b: number): number {
    const x = this.items[a];
    const y = this.items[b];
    return x && y ? collator.compare(x.label, y.label) || x.id - y.id : 0;
  }

  private icon(
    node: Node,
    stats: Visible,
    filter: SymbolFilter,
    icons: FolderIcons,
  ): Pick<CategoryFolder, 'icon' | 'ownIcon' | 'custom'> {
    const visibleSrc = (symbolId: number | null | undefined) => {
      const position = symbolId == null ? undefined : this.byId.get(symbolId);
      const item = position === undefined ? undefined : this.items[position];
      return item && !isFiltered(item.flags, filter) ? item.src : null;
    };
    // An admin's choice first, unless the content filter hides it or the set lost it.
    const chosen = visibleSrc(node.key === null ? null : icons.get(node.key));
    if (chosen) return { icon: chosen, ownIcon: false, custom: true };
    if (node.file) return { icon: SET_BASE[this.set] + node.file, ownIcon: true, custom: false };
    const icon =
      visibleSrc(node.icon) ??
      (stats.first === null ? null : (this.items[stats.first]?.src ?? null));
    return { icon, ownIcon: false, custom: false };
  }

  /** Visible symbols of every subtree (distinct, so a symbol in two subfolders counts once). */
  private visible(filter: SymbolFilter): Map<number, Visible> {
    const key = `${Number(filter.hideSexual)}${Number(filter.hideViolence)}`;
    const cached = this.visibility.get(key);
    if (cached) return cached;
    const out = new Map<number, Visible>();
    const walk = (id: number): Set<number> => {
      const node = this.nodes.get(id);
      const found = new Set<number>();
      if (!node) return found;
      for (const position of node.items) {
        const item = this.items[position];
        if (item && !isFiltered(item.flags, filter)) found.add(position);
      }
      for (const child of node.children) for (const position of walk(child)) found.add(position);
      let first: number | null = null;
      for (const position of found) if (first === null || position < first) first = position;
      out.set(id, { count: found.size, first });
      return found;
    };
    for (const root of this.roots) walk(root);
    this.visibility.set(key, out);
    return out;
  }
}
