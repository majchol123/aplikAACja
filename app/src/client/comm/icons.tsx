/** Inline SVG icons (no icon font: CSP allows only same-origin resources). */
const common = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

export const PlayIcon = ({ className = 'size-8' }) => (
  <svg {...common} className={className}>
    <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
  </svg>
);
export const BackspaceIcon = ({ className = 'size-8' }) => (
  <svg {...common} className={className}>
    <path d="M21 5H9l-6 7 6 7h12z" />
    <path d="m17 9-5 6m0-6 5 6" />
  </svg>
);
export const TrashIcon = ({ className = 'size-8' }) => (
  <svg {...common} className={className}>
    <path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);
export const HomeIcon = ({ className = 'size-7' }) => (
  <svg {...common} className={className}>
    <path d="m3 11 9-7 9 7M5 10v10h14V10" />
  </svg>
);
export const ArrowBackIcon = ({ className = 'size-7' }) => (
  <svg {...common} className={className}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
export const LockIcon = ({ className = 'size-6' }) => (
  <svg {...common} className={className}>
    <rect x="5" y="11" width="14" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
export const FolderIcon = ({ className = 'size-5' }) => (
  <svg {...common} className={className}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);
