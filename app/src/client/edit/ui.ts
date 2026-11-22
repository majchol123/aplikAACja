/** Shared class names of the editor and settings forms. */
export const ui = {
  primary:
    'rounded-full bg-brand-700 px-5 py-2.5 font-semibold text-white hover:bg-brand-800 disabled:opacity-50',
  secondary:
    'rounded-full border border-brand-700 bg-white px-5 py-2.5 font-semibold text-brand-800 hover:bg-brand-50 disabled:opacity-50',
  danger:
    'rounded-full border border-red-700 bg-white px-5 py-2.5 font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50',
  field: 'block text-sm font-medium text-slate-700',
  input:
    'mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-lg focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/30',
  /** Segmented choice (radio button styled as a pill). */
  choice:
    'flex min-h-11 cursor-pointer items-center justify-center rounded-xl border-2 border-slate-200 bg-white px-3 py-1.5 text-slate-700 has-checked:border-brand-700 has-checked:bg-brand-50 has-checked:font-semibold has-checked:text-brand-900 has-focus-visible:ring-2 has-focus-visible:ring-brand-600',
} as const;
