export function RailIcon({ name }: { name: 'cards' | 'templates' | 'playtest' | 'stats' | 'export' | 'game' }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  return (
    <svg className="rail-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden>
      {name === 'cards' && (
        <g {...p}>
          <rect x="7" y="3.5" width="12" height="16" rx="1.5" />
          <path d="M5 6.5v13a1.5 1.5 0 0 0 1.5 1.5H15" />
          <path d="M10 8h6M10 11h6M10 14h3.5" />
        </g>
      )}
      {name === 'templates' && (
        <g {...p}>
          <rect x="5" y="3.5" width="14" height="17" rx="1.5" />
          <path d="M5 13h14M8 6.5h8v4H8z" />
          <path d="M3 8h2M3 16h2M19 8h2M19 16h2" />
        </g>
      )}
      {name === 'playtest' && (
        <g {...p}>
          <rect x="3.5" y="7" width="8" height="11" rx="1.2" transform="rotate(-10 7.5 12.5)" />
          <rect x="12.5" y="6" width="8" height="11" rx="1.2" transform="rotate(8 16.5 11.5)" />
        </g>
      )}
      {name === 'stats' && (
        <g {...p}>
          <path d="M4 20h16" />
          <path d="M7 20v-6M11 20V8M15 20v-9M19 20v-4" />
        </g>
      )}
      {name === 'export' && (
        <g {...p}>
          <path d="M7 9V4h10v5" />
          <rect x="4" y="9" width="16" height="7" rx="1.5" />
          <path d="M7 14h10v6H7z" />
        </g>
      )}
      {name === 'game' && (
        <g {...p}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
        </g>
      )}
    </svg>
  );
}
