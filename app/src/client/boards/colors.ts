import type { FitzgeraldRole } from '@aplikaacja/shared';

/** Modified Fitzgerald Key (PLAN §3.3); full class names so Tailwind can see them. */
export const ROLE_COLORS: Record<FitzgeraldRole | 'none', { border: string; background: string }> =
  {
    person: { border: 'border-yellow-400', background: 'bg-yellow-200' },
    noun: { border: 'border-orange-400', background: 'bg-orange-200' },
    verb: { border: 'border-green-500', background: 'bg-green-200' },
    descriptor: { border: 'border-sky-500', background: 'bg-sky-200' },
    social: { border: 'border-pink-400', background: 'bg-pink-200' },
    question: { border: 'border-purple-500', background: 'bg-purple-200' },
    negation: { border: 'border-red-500', background: 'bg-red-200' },
    misc: { border: 'border-slate-400', background: 'bg-slate-200' },
    none: { border: 'border-slate-300', background: 'bg-white' },
  };
