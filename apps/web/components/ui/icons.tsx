/**
 * Inline stroke icons — no library, no external request (CSP-safe). They use
 * `currentColor`, so a button's hover colour flows straight into the glyph.
 */
type IconProps = { size?: number; className?: string };

const base = (size: number, className: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className,
});

export function EditIcon({ size = 15, className = '' }: IconProps) {
  return (
    <svg {...base(size, className)} aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

export function TrashIcon({ size = 15, className = '' }: IconProps) {
  return (
    <svg {...base(size, className)} aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

export function ArchiveIcon({ size = 15, className = '' }: IconProps) {
  return (
    <svg {...base(size, className)} aria-hidden>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </svg>
  );
}

export function PlusIcon({ size = 15, className = '' }: IconProps) {
  return (
    <svg {...base(size, className)} aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function BellIcon({ size = 18, className = '' }: IconProps) {
  return (
    <svg {...base(size, className)} aria-hidden>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

const NAV_GLYPHS = {
  brand: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.2v9.6M14.4 9.6a2.6 2.6 0 0 0-4.6 1.5c0 2.6 4.8 1.4 4.8 4a2.6 2.6 0 0 1-4.8 1.1" />
    </>
  ),
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="2" />
      <rect x="14" y="3" width="7" height="5" rx="2" />
      <rect x="14" y="12" width="7" height="9" rx="2" />
      <rect x="3" y="16" width="7" height="5" rx="2" />
    </>
  ),
  transactions: <path d="M17 3l4 4-4 4M21 7H8M7 21l-4-4 4-4M3 17h13" />,
  accounts: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="3" />
      <path d="M2 10h20" />
    </>
  ),
  planning: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  invoices: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <path d="M3 9h18" />
    </>
  ),
  planned: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  categories: <path d="M4 6h16M4 12h16M4 18h11" />,
  data: <path d="M12 3v12M8 11l4 4 4-4M4 19h16" />,
  prefs: (
    <>
      <path d="M5 21v-7M5 10V3M12 21v-10M12 7V3M19 21v-4M19 13V3" />
      <path d="M2.5 14h5M9.5 7h5M16.5 17h5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
} as const;

export type NavIconName = keyof typeof NAV_GLYPHS;

export function NavIcon({ name, size = 15, className = '' }: IconProps & { name: NavIconName }) {
  return (
    <svg {...base(size, className)} strokeWidth={1.9} aria-hidden>
      {NAV_GLYPHS[name]}
    </svg>
  );
}
