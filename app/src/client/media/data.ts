import {
  MEDIA_LIMITS,
  type MediaDeleted,
  type MediaInfo,
  type MediaList,
  type MediaSaved,
} from '@relaacja/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api.ts';
import { applyChanges } from '../boards/data.ts';
import { PREFERRED_KEY } from '../boards/preferred.ts';

export const MEDIA_KEY = ['media'] as const;

export function useMediaList(enabled = true) {
  return useQuery({
    queryKey: MEDIA_KEY,
    queryFn: () => api<MediaList>('/api/media'),
    staleTime: 5 * 60_000,
    enabled,
  });
}

function store(queryClient: QueryClient, saved: MediaSaved): void {
  queryClient.setQueryData<MediaList>(MEDIA_KEY, (list) => {
    if (!list) return list;
    const known = list.items.some((m) => m.id === saved.media.id);
    return {
      items: known
        ? list.items.map((m) => (m.id === saved.media.id ? saved.media : m))
        : [saved.media, ...list.items],
      usage: saved.usage,
    };
  });
}

/** Uploads a cropped, re-encoded photo (media/encode.ts) under a name. */
export function useUploadPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ label, image }: { label: string; image: Blob }) => {
      const form = new FormData();
      form.set('label', label);
      form.set('image', image, 'zdjecie');
      return api<MediaSaved>('/api/media', { method: 'POST', body: form });
    },
    onSuccess: (saved) => store(queryClient, saved),
  });
}

export function useRenamePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) =>
      api<MediaSaved>(`/api/media/${id}`, { method: 'PATCH', json: { label } }),
    onSuccess: (saved) => store(queryClient, saved),
  });
}

/** Tiles that showed the photo come back with their label only. */
export function useDeletePhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photo: MediaInfo) =>
      api<MediaDeleted>(`/api/media/${photo.id}`, { method: 'DELETE' }),
    onSuccess: (deleted, photo) => {
      applyChanges(queryClient, deleted);
      queryClient.setQueryData<MediaList>(
        MEDIA_KEY,
        (list) =>
          list && { items: list.items.filter((m) => m.id !== photo.id), usage: deleted.usage },
      );
      // Preferred variants pointing to the photo were dropped on the server.
      void queryClient.invalidateQueries({ queryKey: PREFERRED_KEY });
    },
  });
}

const PROBLEMS: Record<string, string> = {
  payload_too_large: `Zdjęcie jest za duże (więcej niż ${MEDIA_LIMITS.maxFileBytes / 1024} KB).`,
  unsupported_type: 'Ten format nie jest obsługiwany. Wybierz zdjęcie JPEG, PNG lub WebP.',
  invalid_image: 'Plik jest uszkodzony albo nie jest zdjęciem.',
  too_large: 'Zdjęcie jest większe niż 512 × 512 pikseli.',
  quota_exceeded:
    'Brak miejsca na kolejne zdjęcie (limit: 2000 zdjęć lub 100 MB na konto). Usuń nieużywane zdjęcia w Ustawieniach.',
  rate_limited: 'Za dużo zmian naraz. Odczekaj chwilę i spróbuj ponownie.',
  not_found: 'Tego zdjęcia już nie ma (usunięte na innym urządzeniu?).',
};

export function photoProblem(err: unknown): string {
  if (err instanceof ApiError) return PROBLEMS[err.code] ?? 'Nie udało się zapisać zdjęcia.';
  return 'Brak połączenia. Sprawdź internet i spróbuj ponownie.';
}
