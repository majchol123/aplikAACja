import type { Settings, SettingsPatch } from '@aplikaacja/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api.ts';

/** Account-wide settings stored in the vault (shared by every device of the account). */
export function useAccountSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/api/settings') });
}

export function useUpdateAccountSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) =>
      api<Settings>('/api/settings', { method: 'PATCH', json: patch }),
    onSuccess: (data) => queryClient.setQueryData(['settings'], data),
  });
}
