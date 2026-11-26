import { joinPath, type FileStore } from '../fs/types';
import type { Game } from '../model/types';

/**
 * Loads and caches images and fonts for one game. Paths in templates are
 * relative to the game's `assets/` folder; if a file isn't there, the
 * workspace's shared `library/` folder is tried.
 */

export interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
}

interface Source {
  file: string | null;
  time: number | null;
}

export class AssetStore {
  private images = new Map<string, Promise<LoadedImage | null>>();
  private sources = new Map<string, Source>();
  private fontMap = new Map<string, string>();
  private fontsLoaded: Promise<string[]> | null = null;
  private objectUrls: string[] = [];

  constructor(
    readonly fs: FileStore,
    public game: Game,
  ) {}

  updateGame(game: Game) {
    if (JSON.stringify(game.def.fonts ?? []) !== JSON.stringify(this.game.def.fonts ?? [])) {
      this.fontsLoaded = null;
      this.fontMap.clear();
    }
    this.game = game;
  }

  candidates(path: string): string[] {
    const clean = path.replace(/^\/+/, '');
    return [joinPath(this.game.path, 'assets', clean), joinPath('library', clean)];
  }

  async findFile(path: string): Promise<string | null> {
    for (const p of this.candidates(path)) if (await this.fs.exists(p)) return p;
    return null;
  }

  private async locate(path: string): Promise<Source> {
    for (const file of this.candidates(path)) {
      const time = await this.fs.modified(file);
      if (time !== null) return { file, time };
    }
    return { file: null, time: null };
  }

  image(path: string): Promise<LoadedImage | null> {
    const key = path.trim();
    let hit = this.images.get(key);
    if (!hit) {
      hit = this.loadImage(key);
      this.images.set(key, hit);
    }
    return hit;
  }

  private async loadImage(path: string): Promise<LoadedImage | null> {
    if (path === '' || path.endsWith('/')) return null;
    const source = await this.locate(path);
    this.sources.set(path, source);
    const file = source.file;
    if (!file) return null;
    try {
      const blob = await this.fs.readBlob(file);
      if (/\.svg$/i.test(file)) return await this.loadSvg(await blob.text());
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height };
    } catch {
      return null;
    }
  }

  private async loadSvg(text: string): Promise<LoadedImage | null> {
    const svg = withIntrinsicSize(text);
    const url = URL.createObjectURL(new Blob([svg.text], { type: 'image/svg+xml' }));
    this.objectUrls.push(url);
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: svg.width ?? img.naturalWidth, height: svg.height ?? img.naturalHeight };
  }

  /**
   * Registers the game's fonts (game.json "fonts"). Fonts are registered
   * under a game-specific name so two games can use different files with the
   * same family name. Returns problems as messages.
   */
  loadFonts(): Promise<string[]> {
    if (!this.fontsLoaded) this.fontsLoaded = this.doLoadFonts();
    return this.fontsLoaded;
  }

  private async doLoadFonts(): Promise<string[]> {
    const problems: string[] = [];
    if (typeof FontFace === 'undefined' || typeof document === 'undefined') return problems;
    for (const def of this.game.def.fonts ?? []) {
      const file = await this.findFile(def.file);
      if (!file) {
        problems.push(`Font file not found: ${def.file}`);
        continue;
      }
      const registered = `cm ${this.game.id} ${def.family}`;
      try {
        const data = await (await this.fs.readBlob(file)).arrayBuffer();
        const face = new FontFace(registered, data, {
          weight: def.weight !== undefined ? String(def.weight) : 'normal',
          style: def.style ?? 'normal',
        });
        await face.load();
        document.fonts.add(face);
        this.fontMap.set(def.family.toLowerCase(), registered);
      } catch (e) {
        problems.push(`Font ${def.file} could not be loaded: ${(e as Error).message}`);
      }
    }
    return problems;
  }

  fontFamily(family: string): string {
    return family
      .split(',')
      .map((f) => {
        const name = f.trim().replace(/^["']|["']$/g, '');
        return this.fontMap.get(name.toLowerCase()) ?? name;
      })
      .join(', ');
  }

  hasFont(family: string): boolean {
    return this.fontMap.has(family.toLowerCase());
  }

  /**
   * Forgets only the cached images whose file changed on disk since it was
   * loaded (or that were missing and now exist, or now resolve to another
   * file). Returns true when anything was forgotten, so callers redraw only then.
   */
  async refreshChanged(): Promise<boolean> {
    let dropped = false;
    for (const [path, before] of [...this.sources]) {
      const now = await this.locate(path);
      if (now.file === before.file && now.time === before.time) continue;
      // Only forget it if it is still the same cache entry (not reloaded meanwhile).
      if (this.sources.get(path) === before) {
        this.images.delete(path);
        this.sources.delete(path);
        dropped = true;
      }
    }
    return dropped;
  }

  clearImages() {
    this.images.clear();
    this.sources.clear();
    for (const u of this.objectUrls) URL.revokeObjectURL(u);
    this.objectUrls = [];
  }
}

/** SVGs with only a viewBox have no reliable size in an <img>; add width/height. */
export function withIntrinsicSize(svg: string): { text: string; width?: number; height?: number } {
  const open = /<svg\b[^>]*>/i.exec(svg);
  if (!open) return { text: svg };
  const tag = open[0];
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']*)["']`, 'i').exec(tag)?.[1];
  const w = parseFloat(attr('width') ?? '');
  const h = parseFloat(attr('height') ?? '');
  if (Number.isFinite(w) && Number.isFinite(h) && !/%/.test(attr('width')! + attr('height'))) return { text: svg, width: w, height: h };
  const vb = attr('viewBox')?.split(/[\s,]+/).map(Number);
  if (!vb || vb.length !== 4 || !vb.every(Number.isFinite)) return { text: svg };
  // Render SVGs at a generous size so they stay sharp when scaled down.
  const scale = 512 / Math.max(vb[2]!, vb[3]!);
  const width = Math.round(vb[2]! * scale);
  const height = Math.round(vb[3]! * scale);
  const cleaned = tag.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '');
  const newTag = cleaned.replace(/^<svg/i, `<svg width="${width}" height="${height}"`);
  return { text: svg.replace(tag, newTag), width, height };
}
