import type {
  AdminUser,
  AdminUserData,
  AdminUserList,
  AuditPage,
  SetExtraSet,
  SetRole,
} from '@relaacja/shared';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api.ts';

export const ADMIN_USERS_KEY = ['admin', 'users'] as const;
const AUDIT_KEY = ['admin', 'audit'] as const;

export function useAdminUsers() {
  return useQuery({
    queryKey: ADMIN_USERS_KEY,
    queryFn: () => api<AdminUserList>('/api/admin/users'),
    staleTime: 30_000,
  });
}

/**
 * One account's boards, photos and settings. Every fetch is an audited opening (user.view),
 * so it is never refetched in the background and not kept after the view closes.
 */
export function useAdminUserData(id: string) {
  return useQuery({
    queryKey: ['admin', 'data', id],
    queryFn: () => api<AdminUserData>(`/api/admin/users/${id}/data`),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** Audit log, newest first; `target` narrows it to one account. */
export function useAuditLog(target?: string) {
  return useInfiniteQuery({
    queryKey: [...AUDIT_KEY, target ?? null],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (pageParam !== null) params.set('before', String(pageParam));
      if (target) params.set('target', target);
      const query = params.toString();
      return api<AuditPage>(`/api/admin/audit${query ? `?${query}` : ''}`);
    },
    initialPageParam: null as number | null,
    getNextPageParam: (page) => page.next,
    staleTime: 10_000,
  });
}

export type AdminAction =
  | { kind: 'block' | 'unblock'; id: string }
  | { kind: 'extra-set'; id: string; body: SetExtraSet }
  | { kind: 'role'; id: string; body: SetRole };

/** Changes of one account; the list is patched with the answer, the log refetched. */
export function useAdminAction() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (action: AdminAction) =>
      api<AdminUser>(`/api/admin/users/${action.id}/${action.kind}`, {
        method: 'POST',
        ...('body' in action ? { json: action.body } : {}),
      }),
    onSuccess: (user) => {
      queryClient.setQueryData<AdminUserList>(ADMIN_USERS_KEY, (list) =>
        list ? { ...list, users: list.users.map((u) => (u.id === user.id ? user : u)) } : list,
      );
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: AUDIT_KEY }),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, email }: { id: string; email: string }) => {
      try {
        await api(`/api/admin/users/${id}`, { method: 'DELETE', json: { email } });
      } catch (err) {
        // Already gone (a repeated or concurrent deletion): the outcome is the same.
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      }
      return id;
    },
    onSuccess: (id) => {
      queryClient.setQueryData<AdminUserList>(ADMIN_USERS_KEY, (list) =>
        list ? { ...list, users: list.users.filter((u) => u.id !== id) } : list,
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ADMIN_USERS_KEY });
      void queryClient.invalidateQueries({ queryKey: AUDIT_KEY });
    },
  });
}

/** Message for a refused admin action. */
export function adminProblem(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Brak połączenia z serwerem. Spróbuj ponownie.';
  switch (err.code) {
    case 'confirmation_mismatch':
      return 'Wpisany adres nie zgadza się z adresem konta.';
    case 'forbidden':
      return 'Nie masz uprawnień do tej zmiany.';
    case 'conflict':
      return 'Konto jest właśnie usuwane. Dokończ usuwanie.';
    case 'not_found':
      return 'To konto już nie istnieje.';
    default:
      return 'Nie udało się. Spróbuj ponownie.';
  }
}
