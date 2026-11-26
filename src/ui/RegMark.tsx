export function RegMark({ className = 'reg-mark', title }: { className?: string; title?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <circle cx="12" cy="12" r="6.5" />
      <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
      <path d="M12 1.5v21M1.5 12h21" />
    </svg>
  );
}
