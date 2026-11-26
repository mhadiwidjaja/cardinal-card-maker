import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { keys } from './keys';

const EDGE = 8;

export function menuPosition(button: { left: number; right: number; bottom: number }, menuWidth: number, windowWidth: number): { left: number; top: number } {
  const wanted = button.right - menuWidth;
  const left = Math.max(EDGE, Math.min(wanted, windowWidth - menuWidth - EDGE));
  return { left, top: button.bottom + 4 };
}

export type MenuItem = { label: string; onClick: () => void; disabled?: boolean; hint?: string } | { heading: string } | { separator: true };

export function MenuButton({ label, title, items, className }: { label: ReactNode; title?: string; items: MenuItem[]; className?: string }) {
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    // The menu is placed against the window, so it would drift if the page moved under it.
    const close = () => setOpen(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [open]);

  // Measure after the menu is drawn (hidden), then place it. A fixed position
  // escapes panels that scroll or clip their content.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return;
    const pos = menuPosition(buttonRef.current.getBoundingClientRect(), menuRef.current.offsetWidth, window.innerWidth);
    setStyle({ position: 'fixed', left: pos.left, top: pos.top, right: 'auto' });
  }, [open]);

  return (
    <div className="ws-menu" ref={ref}>
      <button
        ref={buttonRef}
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => {
          setStyle({ visibility: 'hidden' });
          setOpen((o) => !o);
        }}
      >
        {label} <span aria-hidden>▾</span>
      </button>
      {open && (
        <div className="ws-dropdown" role="menu" ref={menuRef} style={style}>
          {items.map((it, i) =>
            'separator' in it ? (
              <hr key={i} />
            ) : 'heading' in it ? (
              <div key={i} className="menu-head" role="presentation">
                {it.heading}
              </div>
            ) : (
              <button
                key={it.label}
                role="menuitem"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick();
                }}
              >
                <span>{it.label}</span>
                {it.hint && <span className="menu-hint">{keys(it.hint)}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
