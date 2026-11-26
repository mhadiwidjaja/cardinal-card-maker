/** True on a Mac, where every Ctrl shortcut in the app also works with ⌘. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** Shows shortcut text the way the user's keyboard labels it: "Ctrl+Z" stays on Windows and becomes "⌘Z" on a Mac. */
export function keys(text: string, mac = IS_MAC): string {
  if (!mac) return text;
  return text
    .replace(/Ctrl\+Y/g, '⇧⌘Z')
    .replace(/Ctrl[+ ]/g, '⌘')
    .replace(/Alt\+/g, '⌥');
}
