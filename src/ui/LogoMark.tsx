/**
 * Cardinal's mark: a tilted red card with a printed border and a cardinal cut out of it.
 * The same drawing is docs/images/cardinal.svg (README, program icons) and the page icon in index.html.
 */
export const BIRD = 'M64 27 L52 20 C50 13 44 9 38 7 C34 5 30 3 25 0 C29 6 31 11 30 16 C27 24 20 32 12 42 C8 47 4 53 1 61 C9 57 18 52 27 47 C35 52 46 51 52 45 C58 39 60 33 54 30 Z';

export function LogoMark({ className = 'logo-mark', title }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <g transform="rotate(-8 32 32)">
        <rect x="12" y="3" width="40" height="58" rx="6" fill="var(--logo-card)" />
        <rect x="15.5" y="6.5" width="33" height="51" rx="3.5" fill="none" stroke="var(--logo-paper)" strokeOpacity="0.55" strokeWidth="1.3" />
        <g transform="translate(16 17.5) scale(0.5)">
          <path fill="var(--logo-paper)" d={BIRD} />
          <circle cx="48.5" cy="21" r="2" fill="var(--logo-card)" />
        </g>
      </g>
    </svg>
  );
}
