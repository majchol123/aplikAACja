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
/** Edit mode (the button in communication mode that opens it). */
export const PencilIcon = ({ className = 'size-6' }) => (
  <svg {...common} className={className}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
    <path d="m13.5 6.5 4 4" />
  </svg>
);
/** Pushpin: a board pinned in communication mode (filled while one is). */
export const PinIcon = ({ className = 'size-7', filled = false }) => (
  <svg {...common} className={className}>
    <path d="M9 3h6l-1 6.5 3.5 3.5h-11L10 9.5z" fill={filled ? 'currentColor' : 'none'} />
    <path d="M12 13v8" />
  </svg>
);
export const FolderIcon = ({ className = 'size-5' }) => (
  <svg {...common} className={className}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);
export const PlusIcon = ({ className = 'size-10' }) => (
  <svg {...common} className={className}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const OpenIcon = ({ className = 'size-6' }) => (
  <svg {...common} className={className}>
    <path d="M5 12h13m-5-6 6 6-6 6" />
  </svg>
);
export const GearIcon = ({ className = 'size-6' }) => (
  <svg {...common} className={className}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3m0 14v3M4.9 4.9l2.1 2.1m10 10 2.1 2.1M2 12h3m14 0h3M4.9 19.1 7 17M17 7l2.1-2.1" />
  </svg>
);
export const GridIcon = ({ className = 'size-6' }) => (
  <svg {...common} className={className}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);
/** A keyboard: text typed in becomes symbols (the phrase generator). */
export const KeyboardIcon = ({ className = 'size-7' }) => (
  <svg {...common} className={className}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
  </svg>
);
export const SearchIcon = ({ className = 'size-7' }) => (
  <svg {...common} className={className}>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m15.5 15.5 5 5" />
  </svg>
);
export const ClockIcon = ({ className = 'size-7' }) => (
  <svg {...common} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const StarIcon = ({ className = 'size-5' }) => (
  <svg {...common} className={className}>
    <path
      d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"
      fill="currentColor"
    />
  </svg>
);
export const PrintIcon = ({ className = 'size-6' }) => (
  <svg {...common} className={className}>
    <path d="M6 9V3h12v6" />
    <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
    <rect x="6" y="14" width="12" height="7" rx="1" />
  </svg>
);
