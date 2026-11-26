import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

/**
 * Opening Cardinal on the user's screen: in its own window (a browser "app" window
 * with no tabs or address bar) or in a normal browser tab.
 */

/** Where Cardinal keeps its own browser profile and log. */
export function dataDir(): string {
  const home = homedir();
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Cardinal');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Cardinal');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'cardinal');
}

/** Browsers that can open a page as an app window (Chromium based), most likely first. Edge is part of Windows. */
export function appBrowsers(): string[] {
  if (process.platform === 'win32') {
    const roots = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter((r): r is string => !!r);
    return [
      ...roots.map((r) => path.join(r, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
      ...roots.map((r) => path.join(r, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...roots.map((r) => path.join(r, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')),
    ];
  }
  if (process.platform === 'darwin') {
    const apps = ['Google Chrome', 'Microsoft Edge', 'Brave Browser', 'Chromium'];
    const exe: Record<string, string> = { 'Brave Browser': 'Brave Browser' };
    return [homedir() + '/Applications', '/Applications'].flatMap((dir) => apps.map((a) => path.join(dir, `${a}.app`, 'Contents', 'MacOS', exe[a] ?? a)));
  }
  const names = ['google-chrome', 'google-chrome-stable', 'microsoft-edge', 'microsoft-edge-stable', 'chromium', 'chromium-browser', 'brave-browser'];
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  return names.flatMap((n) => dirs.map((d) => path.join(d, n)));
}

function start(cmd: string, args: string[], verbatim = false): boolean {
  try {
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: verbatim });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Opens the page as its own window. A separate browser profile keeps Cardinal apart from the
 * user's own browsing (its own window, settings and storage) and makes the window open even
 * when that browser is already running. Returns false when no suitable browser is installed.
 */
export function openAppWindow(url: string): boolean {
  const exe = appBrowsers().find((p) => existsSync(p));
  if (!exe) return false;
  const profile = path.join(dataDir(), 'browser');
  const first = !existsSync(profile);
  mkdirSync(profile, { recursive: true });
  return start(exe, [`--app=${url}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...(first ? ['--start-maximized'] : [])]);
}

export function openBrowser(url: string): boolean {
  if (process.platform === 'win32') return start('cmd', ['/c', 'start', '""', url], true);
  return start(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
}

/** A message the user can see even without a console window. */
export function showMessage(text: string) {
  console.error(text);
  if (process.platform === 'win32') {
    const quoted = text.replace(/'/g, "''");
    start('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show('${quoted}', 'Cardinal') | Out-Null`]);
  } else if (process.platform === 'darwin') {
    start('osascript', ['-e', `display alert "Cardinal" message ${JSON.stringify(text)}`]);
  }
}
