import { useLayoutEffect, useRef } from 'react';

const stack: number[] = [];
let next = 1;

/** Escape closes the newest open dialog only. */
export function useEscape(onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  // Registered before the browser paints the dialog, so an Escape pressed as soon as it appears already reaches it.
  useLayoutEffect(() => {
    const id = next++;
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || stack[stack.length - 1] !== id) return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const at = stack.indexOf(id);
      if (at >= 0) stack.splice(at, 1);
    };
  }, []);
}
