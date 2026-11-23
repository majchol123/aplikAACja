import type { AccountStatus, AdminUser, AuditEntry, Role } from '@relaacja/shared';

export const BOARDS_PL = ['tablica', 'tablice', 'tablic'] as const;
export const TILES_PL = ['kafelek', 'kafelki', 'kafelków'] as const;
export const PHOTOS_PL = ['zdjęcie', 'zdjęcia', 'zdjęć'] as const;

export const ROLE_LABEL: Record<Role, string> = {
  user: 'Użytkownik',
  admin: 'Administrator',
  superadmin: 'Superadministrator',
};

export const STATUS_LABEL: Record<AccountStatus, string> = {
  active: 'Aktywne',
  blocked: 'Zablokowane',
  deleting: 'W trakcie usuwania',
};

const ACTION_LABEL: Record<string, string> = {
  'user.block': 'Zablokowanie konta',
  'user.unblock': 'Odblokowanie konta',
  'user.extra_set': 'Dodatkowy zestaw',
  'user.role': 'Zmiana roli',
  'user.delete': 'Usunięcie konta',
  'user.view': 'Podgląd danych konta',
  'user.restore': 'Przywrócenie wcześniejszego stanu konta',
  'category_icon.set': 'Obrazek folderu',
  'category_icon.reset': 'Automatyczny obrazek folderu',
  'catalog.publish': 'Publikacja w katalogu tablic',
  'catalog.edit': 'Zmiana wpisu w katalogu tablic',
  'catalog.update': 'Nowa wersja tablicy w katalogu',
  'catalog.withdraw': 'Wycofanie z katalogu tablic',
  'backup.configure': 'Ustawienie kopii zapasowych',
  'backup.disable': 'Wyłączenie kopii zapasowych',
  'backup.run': 'Kopia zapasowa',
};

export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

/** The changed value of an entry, in words ("włączony", "Administrator"). */
export function actionDetails(entry: AuditEntry): string {
  const d = entry.details;
  switch (entry.action) {
    case 'user.extra_set':
      return d.enabled ? 'włączony' : 'wyłączony';
    case 'user.role':
      return d.role === 'admin' ? ROLE_LABEL.admin : ROLE_LABEL.user;
    case 'category_icon.set':
    case 'category_icon.reset': {
      const set = d.set === 'extra' ? 'dodatkowy zestaw' : 'ARASAAC';
      const symbol = typeof d.symbol === 'number' ? `, symbol ${d.symbol}` : '';
      return `${set}, folder ${String(d.key)}${symbol}`;
    }
    case 'catalog.publish':
    case 'catalog.update':
      return `„${String(d.name)}”${d.photos ? ', ze zdjęciami' : ''}`;
    case 'catalog.edit':
    case 'catalog.withdraw':
      return `„${String(d.name)}”`;
    case 'backup.configure':
      return `klucz ${String(d.recipient)}`;
    case 'user.restore':
      return typeof d.to === 'number' ? `stan z ${formatDateTime(d.to)}` : '';
    case 'backup.run':
      return `kont: ${String(d.accounts)}, wpisów katalogu: ${String(d.catalog)}`;
    default:
      return '';
  }
}

export function formatDate(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toLocaleDateString('pl-PL', { dateStyle: 'medium' });
}

export function formatDateTime(ms: number | null): string {
  if (ms === null) return '—';
  return new Date(ms).toLocaleString('pl-PL', { dateStyle: 'medium', timeStyle: 'short' });
}

const DAY_MS = 24 * 3600 * 1000;
const relative = new Intl.RelativeTimeFormat('pl', { numeric: 'auto' });

/** "dzisiaj", "wczoraj", "3 dni temu", "2 miesiące temu" (calendar days in local time). */
export function formatAgo(ms: number | null, now = Date.now()): string {
  if (ms === null) return '—';
  const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0);
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);
  if (days < 1) return relative.format(0, 'day');
  if (days < 31) return relative.format(-days, 'day');
  if (days < 365) return relative.format(-Math.floor(days / 30), 'month');
  return relative.format(-Math.floor(days / 365), 'year');
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pl-PL', { maximumFractionDigits: 1 })} MB`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('pl-PL');
}

/**
 * Last sign of life: the later of session activity and the last sign-in (a sign-in in a
 * browser that later signed in as someone else leaves no session behind).
 */
export function lastActive(user: AdminUser): number | null {
  const times = [user.lastSeenAt, user.lastLoginAt].filter((t) => t !== null);
  return times.length ? Math.max(...times) : null;
}

export interface AdminStats {
  accounts: number;
  active: number;
  blocked: number;
  activeWeek: number;
  activeMonth: number;
  newMonth: number;
  extraSet: number;
  boards: number;
  tiles: number;
  media: number;
  storageBytes: number;
}

/** Statistics v1 (PLAN §2.6): computed from the account list, nothing else is collected. */
export function adminStats(users: readonly AdminUser[], now = Date.now()): AdminStats {
  const since = (days: number) => now - days * DAY_MS;
  const stats: AdminStats = {
    accounts: users.length,
    active: 0,
    blocked: 0,
    activeWeek: 0,
    activeMonth: 0,
    newMonth: 0,
    extraSet: 0,
    boards: 0,
    tiles: 0,
    media: 0,
    storageBytes: 0,
  };
  for (const user of users) {
    if (user.status === 'active') stats.active++;
    if (user.status === 'blocked') stats.blocked++;
    const seen = lastActive(user) ?? 0;
    if (seen >= since(7)) stats.activeWeek++;
    if (seen >= since(30)) stats.activeMonth++;
    if (user.createdAt >= since(30)) stats.newMonth++;
    if (user.extraSet) stats.extraSet++;
    stats.boards += user.boards;
    stats.tiles += user.tiles;
    stats.media += user.media;
    stats.storageBytes += user.storageBytes;
  }
  return stats;
}
