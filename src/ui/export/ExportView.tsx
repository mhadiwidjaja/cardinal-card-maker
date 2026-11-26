import { gameKey } from '../store';
import { markProgress } from '../GettingStarted';
import { zipSync } from 'fflate';
import { useEffect, useMemo, useRef, useState } from 'react';
import { iccConverter, iccGamutDelta, IccError, simpleConverter, type CmykConverter } from '../../export/cmyk';
import { exportPdf, exportPngs, exportTts, quantityOf, type ExportFile, type ExportItem, type ExportWarning, type Progress } from '../../export/exporters';
import { exportGallery, galleryFields } from '../../export/gallery';
import { cardPage, orientPage, PAGE_SIZES, pageLayout, type BacksMode, type PageOrientation } from '../../export/layout';
import { exportTestSheet } from '../../export/testSheet';
import type { FileStore } from '../../fs/types';
import { joinPath } from '../../fs/types';
import { filterCards } from '../../model/cardOps';
import type { Game } from '../../model/types';
import type { AssetStore } from '../../render/assets';
import { download, slug } from '../download';
import { uploadFiles } from '../upload';
import { PrintCheck } from './PrintCheck';
import { CostPlanner } from './CostPlanner';
import { useCommands } from '../commands';
import { changedSince, listTags, loadTag, type PlaytestTag } from '../../model/playtestTags';
import { readStored, writeStored } from '../stored';

/**
 * Default export resolution. Card text is drawn into the picture rather than
 * kept as vector text, so it benefits from more than the usual 300 for photos
 * (see docs/decisions.md).
 */
const DEFAULT_DPI = 600;

/** Options saved before v2 used the old 300 DPI default; move those to the new default once. */
function upgradeDpi(stored: Record<string, unknown>): Record<string, unknown> {
  if (stored.v === 2) return stored;
  return { ...stored, v: 2, dpi: stored.dpi === 300 || stored.dpi === undefined ? DEFAULT_DPI : stored.dpi };
}

interface Props {
  game: Game;
  assets: AssetStore;
  fs: FileStore;
  active?: boolean;
}

type Kind = 'png' | 'pdf' | 'tts' | 'gallery';

function useStored<T>(key: string, initial: T, upgrade: (stored: Record<string, unknown>) => Record<string, unknown> = (x) => x): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    const s = readStored<Record<string, unknown> | null>(key, null);
    return s ? { ...initial, ...(upgrade(s) as T) } : initial;
  });
  return [
    v,
    (next: T) => {
      setV(next);
      writeStored(key, next);
    },
  ];
}

export function ExportView({ game, assets, fs, active = true }: Props) {
  const k = `card-maker:export:${game.def.name}:`;
  const [kind, setKind] = useState<Kind>('pdf');
  const [setId, setSetId] = useState('*');
  const [query, setQuery] = useState('');
  const [toFolder, setToFolder] = useState(fs.writable);
  const [png, setPng] = useStored(k + 'png', { v: 2, dpi: DEFAULT_DPI, bleed: false, back: false, pattern: '{pad(card.number, 3)} {name}' }, upgradeDpi);
  const [pdf, setPdf] = useStored(k + 'pdf', {
    layout: 'sheets' as 'sheets' | 'perCard',
    v: 2,
    page: 'A4',
    orientation: 'auto' as PageOrientation,
    marginMm: 5,
    gapMm: 0,
    bleed: false,
    cropMarks: true,
    backs: 'none' as BacksMode,
    backOffsetX: 0,
    backOffsetY: 0,
    colour: 'rgb' as 'rgb' | 'cmyk',
    /** File in the game's assets/profiles folder; '' = built-in conversion. */
    profile: '',
    intent: 0 as 0 | 1,
    inkLimit: 300,
    pureBlack: true,
    useQuantity: true,
    dpi: DEFAULT_DPI,
    imageFormat: 'jpeg' as 'jpeg' | 'png',
  }, upgradeDpi);
  const [tts, setTts] = useStored(k + 'tts', { useQuantity: true, maxSheetPx: 4096 });
  const [gallery, setGallery] = useStored(k + 'gallery', { widthPx: 400, feedback: true });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<{ message: string; warnings: ExportWarning[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const profilesDir = joinPath(game.path, 'assets', 'profiles');
  const [profiles, setProfiles] = useState<string[]>([]);
  const [memProfiles, setMemProfiles] = useState<Record<string, Uint8Array>>({});
  const [profileState, setProfileState] = useState<{ conv: CmykConverter | null; error: string | null }>({ conv: null, error: null });
  const [profilesVersion, setProfilesVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      const onDisk = (await fs.exists(profilesDir)) ? (await fs.list(profilesDir)).filter((e) => e.kind === 'file' && /\.(icc|icm)$/i.test(e.name)).map((e) => e.name) : [];
      if (alive) setProfiles([...new Set([...onDisk, ...Object.keys(memProfiles)])]);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [fs, profilesDir, memProfiles, profilesVersion]);
  useEffect(() => {
    if (pdf.colour !== 'cmyk' || !pdf.profile) return setProfileState({ conv: null, error: null });
    let alive = true;
    (async () => {
      const bytes = memProfiles[pdf.profile] ?? new Uint8Array(await (await fs.readBlob(joinPath(profilesDir, pdf.profile))).arrayBuffer());
      const conv = iccConverter(bytes, { intent: pdf.intent, pureBlack: pdf.pureBlack });
      if (alive) setProfileState({ conv, error: null });
    })().catch((e: Error) => alive && setProfileState({ conv: null, error: e instanceof IccError ? e.message : `Could not read ${pdf.profile}: ${e.message}` }));
    return () => {
      alive = false;
    };
  }, [fs, profilesDir, pdf.colour, pdf.profile, pdf.intent, pdf.pureBlack, memProfiles]);

  async function addProfile(file: File | undefined) {
    if (!file) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      iccConverter(bytes);
    } catch (e) {
      setError(e instanceof IccError ? e.message : (e as Error).message);
      return;
    }
    const name = file.name.replace(/[\\/:*?"<>|]/g, '_');
    if (fs.writable) {
      // Asks before replacing a profile of the same name (the old one is kept as .bak).
      const { written } = await uploadFiles(fs, profilesDir, [{ name, data: new Blob([bytes as BlobPart]) }]);
      setProfilesVersion((v) => v + 1);
      if (!written.length) return;
    } else {
      setMemProfiles((m) => ({ ...m, [name]: bytes }));
    }
    setError(null);
    setPdf({ ...pdf, colour: 'cmyk', profile: name });
  }

  const cmykConv: CmykConverter | null =
    pdf.colour !== 'cmyk' ? null : pdf.profile ? profileState.conv : simpleConverter({ inkLimit: pdf.inkLimit, pureBlack: pdf.pureBlack });
  const cmykBlocked = pdf.colour === 'cmyk' && !cmykConv;
  // The print check's colour test needs the shop's profile (a profile without a CMYK → colour table can't be used).
  const gamutProfile = pdf.colour === 'cmyk' && pdf.profile ? (profileState.conv?.profile ?? null) : null;
  const gamut = useMemo(() => {
    if (!gamutProfile) return null;
    try {
      return iccGamutDelta(gamutProfile);
    } catch {
      return null;
    }
  }, [gamutProfile]);

  const [tags, setTags] = useState<PlaytestTag[]>([]);
  const [changedKeys, setChangedKeys] = useState<Set<string> | null>(null);
  useEffect(() => {
    listTags(fs, game).then(setTags, () => setTags([]));
  }, [fs, game]);
  useEffect(() => {
    if (!setId.startsWith('tag:')) return setChangedKeys(null);
    let alive = true;
    setChangedKeys(new Set());
    loadTag(fs, game, setId.slice(4))
      .then((then) => alive && setChangedKeys(new Set(changedSince(then, game).filter((c) => c.kind !== 'removed').map((c) => `${c.setId}/${c.cardId}`))))
      .catch((e: Error) => alive && setError(`Could not open the snapshot: ${e.message}`));
    return () => {
      alive = false;
    };
  }, [fs, game, setId]);

  const { items, filterError } = useMemo(() => {
    const out: ExportItem[] = [];
    let err: string | null = null;
    const sets = setId === '*' || setId.startsWith('tag:') ? game.sets : game.sets.filter((s) => s.id === setId);
    for (const set of sets) {
      const r = filterCards(game, set, query);
      if (r.error) err = r.error;
      for (const i of r.indices) {
        const card = set.cards[i]!;
        if (changedKeys && !changedKeys.has(`${set.id}/${card.id}`)) continue;
        out.push({ set, card });
      }
    }
    return { items: out, filterError: err };
  }, [game, setId, query, changedKeys]);

  const copies = useMemo(() => items.reduce((s, it) => s + quantityOf(game, it), 0), [items, game]);
  const hasQuantity = game.def.fields.some((f) => f.role === 'quantity');
  const c = game.def.card;
  const sheetLayout = (pageWidthMm: number, pageHeightMm: number) =>
    pageLayout(c.widthMm, c.heightMm, c.bleedMm, { pageWidthMm, pageHeightMm, marginMm: pdf.marginMm, gapMm: pdf.gapMm, bleed: pdf.bleed, cropMarks: pdf.cropMarks });
  const pageSize = PAGE_SIZES[pdf.page] ?? PAGE_SIZES.A4!;
  const fitCount = (w: number, h: number) => sheetLayout(w, h).perPage;
  const oriented = orientPage(pageSize, pdf.orientation, fitCount);
  const autoLandscape = orientPage(pageSize, 'auto', fitCount).landscape;
  const { pageW: pw, pageH: ph } = oriented;
  const layout = sheetLayout(pw, ph);
  const otherPerPage = sheetLayout(ph, pw).perPage;
  const printCount = pdf.useQuantity ? copies : items.length;
  const perCard = pdf.layout === 'perCard';
  const onePage = cardPage(c.widthMm, c.heightMm, c.bleedMm, pdf.bleed);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{4})$/, '$1-$2');
  const exportDir = joinPath(game.path, 'export');

  async function run(job: (signal: AbortSignal) => Promise<{ message: string; warnings: ExportWarning[] }>) {
    setError(null);
    setResult(null);
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      setResult(await job(ctl.signal));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      else setError('Export cancelled.');
    } finally {
      setProgress(null);
      abort.current = null;
    }
  }

  async function deliver(files: ExportFile[], sub: string, zipName: string): Promise<string> {
    if (toFolder) {
      for (const f of files) await fs.writeBlob(joinPath(exportDir, sub, f.path), new Blob([f.data as BlobPart]));
      return `${files.length} files saved in ${joinPath(exportDir, sub)}`;
    }
    const zip: Record<string, [Uint8Array, { level: 0 }]> = {};
    for (const f of files) zip[f.path] = [f.data, { level: 0 }];
    download(zipName, zipSync(zip), 'application/zip');
    return `${files.length} files downloaded as ${zipName}`;
  }

  const startPng = () =>
    run(async (signal) => {
      const files: ExportFile[] = [];
      const sub = `png-${stamp}`;
      const res = await exportPngs(
        game,
        items,
        { faces: png.back ? ['front', 'back'] : ['front'], dpi: png.dpi, bleed: png.bleed, pattern: png.pattern },
        assets,
        async (f) => {
          if (toFolder) await fs.writeBlob(joinPath(exportDir, sub, f.path), new Blob([f.data as BlobPart]));
          else files.push(f);
        },
        setProgress,
        signal,
      );
      const where = toFolder ? `saved in ${joinPath(exportDir, sub)}` : await deliver(files, sub, `${slug(game.def.name)}-png.zip`).then((m) => m.replace(/^\d+ files /, ''));
      return { message: `${res.files} images ${where}`, warnings: res.warnings };
    });

  const startPdf = () =>
    run(async (signal) => {
      const res = await exportPdf(
        game,
        items,
        {
          layout: pdf.layout,
          pageWidthMm: pw,
          pageHeightMm: ph,
          marginMm: pdf.marginMm,
          gapMm: pdf.gapMm,
          bleed: pdf.bleed,
          cropMarks: pdf.cropMarks,
          backs: pdf.backs,
          backOffsetMm: [pdf.backOffsetX, pdf.backOffsetY],
          useQuantity: pdf.useQuantity,
          dpi: pdf.dpi,
          imageFormat: pdf.imageFormat,
          cmyk: cmykConv,
        },
        assets,
        setProgress,
        signal,
      );
      const name = `${slug(game.def.name)}-print-${stamp}.pdf`;
      const pdfs: [string, Uint8Array][] = [[name, res.data]];
      if (res.backData) pdfs.push([name.replace(/\.pdf$/, '-backs.pdf'), res.backData]);
      let where: string;
      if (toFolder) {
        for (const [n, data] of pdfs) await fs.writeBlob(joinPath(exportDir, n), new Blob([data as BlobPart], { type: 'application/pdf' }));
        where = `saved as ${pdfs.map(([n]) => joinPath(exportDir, n)).join(' and ')}`;
      } else {
        for (const [n, data] of pdfs) download(n, data, 'application/pdf');
        where = `downloaded as ${pdfs.map(([n]) => n).join(' and ')}`;
      }
      markProgress(gameKey(game), 'export');
      const colour = cmykConv ? ` CMYK (${cmykConv.name}).` : '';
      return { message: `${res.cards} cards on ${res.pages} pages, ${where}.${colour} Print at 100% / “actual size”.`, warnings: res.warnings };
    });

  const startTestSheet = () =>
    run(async () => {
      const res = await exportTestSheet(
        game,
        items[0]!,
        { pageWidthMm: Math.min(...pageSize), pageHeightMm: Math.max(...pageSize), pageName: pdf.page, dpi: pdf.dpi, imageFormat: pdf.imageFormat, cmyk: cmykConv },
        assets,
      );
      const name = `${slug(game.def.name)}-test-print-${stamp}.pdf`;
      let where: string;
      if (toFolder) {
        await fs.writeBlob(joinPath(exportDir, name), new Blob([res.data as BlobPart], { type: 'application/pdf' }));
        where = `saved as ${joinPath(exportDir, name)}`;
      } else {
        download(name, res.data, 'application/pdf');
        where = `downloaded as ${name}`;
      }
      return { message: `Test print sheet ${where}. Print it at 100% / “actual size” and go through the checks at the bottom of the page.`, warnings: res.warnings };
    });

  const startTts = () =>
    run(async (signal) => {
      const res = await exportTts(game, items, tts, assets, setProgress, signal);
      const msg = await deliver(res.files, `tts-${stamp}`, `${slug(game.def.name)}-tts.zip`);
      return { message: `${res.sheets.length} sheet(s): ${msg}. See README.txt for the Tabletop Simulator settings.`, warnings: res.warnings };
    });

  const startGallery = () =>
    run(async (signal) => {
      const res = await exportGallery(game, items, { widthPx: gallery.widthPx, fields: galleryFields(game), feedback: gallery.feedback }, assets, setProgress, signal);
      const name = `${slug(game.def.name)}-gallery-${stamp}.html`;
      const data = new TextEncoder().encode(res.html);
      const mb = (data.length / 1048576).toFixed(1);
      if (toFolder) {
        await fs.writeBlob(joinPath(exportDir, name), new Blob([data as BlobPart], { type: 'text/html' }));
        return { message: `Gallery of ${res.cards} cards (${mb} MB) saved as ${joinPath(exportDir, name)}. Open it in any browser, or send the file.`, warnings: res.warnings };
      }
      download(name, data, 'text/html');
      return { message: `Gallery of ${res.cards} cards (${mb} MB) downloaded as ${name}.`, warnings: res.warnings };
    });

  const busy = progress !== null;
  const KIND_LABELS: Record<Kind, string> = { pdf: 'Print PDF', png: 'Images', tts: 'Tabletop Simulator', gallery: 'Gallery page' };
  const startCurrent = { pdf: startPdf, png: startPng, tts: startTts, gallery: startGallery }[kind];
  useCommands(
    'export',
    [
      ...(Object.keys(KIND_LABELS) as Kind[]).map((k) => ({ id: `exp-${k}`, group: 'Export', label: `Choose: ${KIND_LABELS[k]}`, run: () => setKind(k) })),
      { id: 'exp-go', group: 'Export', label: `Create ${KIND_LABELS[kind]} now (${items.length} cards)`, run: () => void startCurrent(), disabled: busy || !items.length || (kind === 'pdf' && cmykBlocked) },
      { id: 'exp-test', group: 'Export', label: 'Test print sheet (one page: ruler, real-size card, colours)', run: () => void startTestSheet(), disabled: busy || !items.length || cmykBlocked },
      { id: 'exp-preset', group: 'Export', label: 'Print shop preset (one card per page, bleed, 600 DPI)', run: () => (setKind('pdf'), setPdf({ ...pdf, layout: 'perCard', bleed: true, dpi: DEFAULT_DPI, cropMarks: false })) },
      { id: 'exp-check', group: 'Export', label: 'Print check: find print problems…', run: () => document.querySelector<HTMLButtonElement>('.print-check button')?.click(), disabled: !items.length, keywords: 'preflight ppi gamut safe zone' },
    ],
    active,
  );

  return (
    <div className="export-view">
      <div className="stats-filters">
        <label>
          Cards from
          <select value={setId} onChange={(e) => setSetId(e.target.value)}>
            <option value="*">All sets</option>
            {game.sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.def.name}
              </option>
            ))}
            {tags.map((t) => (
              <option key={t.slug} value={`tag:${t.slug}`}>
                Changed since {t.name}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          className={'filter' + (filterError ? ' bad' : '')}
          placeholder="Filter…   (or = rarity == 'Rare')"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          title={filterError ?? 'Words match any cell. Start with = to use an expression.'}
        />
        <span className="muted small">
          {items.length} cards{hasQuantity ? ` · ${copies} copies` : ''}
        </span>
      </div>

      <div className="export-kinds">
        {(
          [
            ['pdf', 'Print PDF', 'Sheets of cards to print and cut, with crop marks and optional backs'],
            ['png', 'Images', 'One PNG per card, e.g. for sharing or print-on-demand services'],
            ['tts', 'Tabletop Simulator', 'Deck sheets (10 × 7) to import as a custom deck'],
            ['gallery', 'Gallery page', 'One web page with every card and a search box, to send to playtesters'],
          ] as [Kind, string, string][]
        ).map(([id, title, sub]) => (
          <button key={id} className={'export-kind' + (kind === id ? ' active' : '')} onClick={() => setKind(id)}>
            <strong>{title}</strong>
            <span>{sub}</span>
          </button>
        ))}
      </div>

      <section className="export-options">
        {kind === 'pdf' && (
          <>
            <Row label="Layout">
              <select
                value={pdf.layout}
                onChange={(e) => {
                  const next = e.target.value as 'sheets' | 'perCard';
                  setPdf({ ...pdf, layout: next, backs: next === 'sheets' && pdf.backs === 'separate' ? 'none' : pdf.backs });
                }}
              >
                <option value="sheets">Sheets: many cards per page, with crop marks (home printing)</option>
                <option value="perCard">One card per page: card size plus bleed (print shops)</option>
              </select>
              <button
                onClick={() => setPdf({ ...pdf, layout: 'perCard', bleed: true, dpi: DEFAULT_DPI, cropMarks: false })}
                title="One card per page, bleed on, 600 DPI, no crop marks. Colour stays as it is. You can still change everything afterwards."
              >
                Print shop preset
              </button>
            </Row>
            {perCard ? (
              <Row label="Page">
                <span className="muted small">
                  Each page is one card: {fmtMm(onePage.pageW)} × {fmtMm(onePage.pageH)} mm
                  {pdf.bleed ? ` (${c.widthMm} × ${c.heightMm} mm trim plus ${c.bleedMm} mm bleed)` : ' (no bleed)'} · {printCount} pages
                  {pdf.backs === 'duplex' ? ' (+ a back page after each)' : pdf.backs === 'separate' ? ' (+ the same number in the backs file)' : ''}
                </span>
              </Row>
            ) : (
              <>
                <Row label="Page">
                  <select value={pdf.page} onChange={(e) => setPdf({ ...pdf, page: e.target.value })}>
                    {Object.keys(PAGE_SIZES).map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                  <select
                    value={pdf.orientation}
                    onChange={(e) => setPdf({ ...pdf, orientation: e.target.value as PageOrientation })}
                    title="Landscape often fits more cards when bleed is printed"
                  >
                    <option value="auto">Best fit ({autoLandscape ? 'landscape' : 'portrait'})</option>
                    <option value="portrait">Portrait</option>
                    <option value="landscape">Landscape</option>
                  </select>
                  <span className="muted small">
                    {layout.cols} × {layout.rows} = {layout.perPage} cards per page
                    {otherPerPage !== layout.perPage ? ` (${oriented.landscape ? 'portrait' : 'landscape'}: ${otherPerPage})` : ''} · {layout.perPage ? Math.ceil(printCount / layout.perPage) : 0} pages
                    {pdf.backs === 'duplex' ? ' (+ back pages)' : ''}
                  </span>
                </Row>
                <Row label="Margin / gap (mm)">
                  <Num value={pdf.marginMm} onChange={(v) => setPdf({ ...pdf, marginMm: v })} />
                  <Num value={pdf.gapMm} onChange={(v) => setPdf({ ...pdf, gapMm: v })} />
                  <span className="muted small">gap 0 = cards touch, one cut between neighbours</span>
                </Row>
              </>
            )}
            <Row label="Options">
              {!perCard && <Check label="Crop marks" value={pdf.cropMarks} onChange={(v) => setPdf({ ...pdf, cropMarks: v })} />}
              <Check label={`Print bleed (${c.bleedMm} mm)`} value={pdf.bleed} onChange={(v) => setPdf({ ...pdf, bleed: v })} />
              {hasQuantity && <Check label="Use quantities" value={pdf.useQuantity} onChange={(v) => setPdf({ ...pdf, useQuantity: v })} />}
            </Row>
            <Row label="Backs">
              <select value={pdf.backs} onChange={(e) => setPdf({ ...pdf, backs: e.target.value as BacksMode })}>
                <option value="none">No backs</option>
                {perCard ? (
                  <>
                    <option value="duplex">After each front (front, back, front, back…)</option>
                    <option value="separate">In a separate file (…-backs.pdf, same order)</option>
                  </>
                ) : (
                  <option value="duplex">Double-sided (back page after each front page, flip on {oriented.landscape ? 'short' : 'long'} edge)</option>
                )}
              </select>
            </Row>
            {!perCard && pdf.backs === 'duplex' && (
              <Row label="Back offset (mm)">
                x <Num value={pdf.backOffsetX} step={0.1} onChange={(v) => setPdf({ ...pdf, backOffsetX: v })} />
                y <Num value={pdf.backOffsetY} step={0.1} onChange={(v) => setPdf({ ...pdf, backOffsetY: v })} />
                <span className="muted small">to correct a printer that doesn’t line up both sides</span>
              </Row>
            )}
            <Row label="Colour">
              <select value={pdf.colour} onChange={(e) => setPdf({ ...pdf, colour: e.target.value as 'rgb' | 'cmyk' })}>
                <option value="rgb">RGB: home and office printers</option>
                <option value="cmyk">CMYK: professional print shop</option>
              </select>
            </Row>
            {pdf.colour === 'cmyk' && (
              <>
                <Row label="Conversion">
                  <select value={pdf.profile} onChange={(e) => setPdf({ ...pdf, profile: e.target.value })} title="Ask your print shop for their ICC profile; it gives the most accurate colours">
                    <option value="">Built-in (no profile)</option>
                    {profiles.map((p) => (
                      <option key={p} value={p}>
                        Profile: {p}
                      </option>
                    ))}
                  </select>
                  <label className="file-button" title="An .icc or .icm CMYK profile from your print shop (e.g. FOGRA39, GRACoL, SWOP)">
                    Add print shop profile…
                    <input type="file" accept=".icc,.icm" onChange={(e) => void addProfile(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
                  </label>
                </Row>
                {pdf.profile ? (
                  <Row label="Rendering">
                    <select value={pdf.intent} onChange={(e) => setPdf({ ...pdf, intent: Number(e.target.value) as 0 | 1 })}>
                      <option value={0}>Perceptual (best for art and photos)</option>
                      <option value={1}>Relative colorimetric (exact colours where possible)</option>
                    </select>
                    {profileState.conv && <span className="muted small">{profileState.conv.name} · embedded in the PDF</span>}
                    {profileState.error && <span className="error small">{profileState.error}</span>}
                  </Row>
                ) : (
                  <Row label="Ink limit">
                    <Num value={pdf.inkLimit} step={10} onChange={(v) => setPdf({ ...pdf, inkLimit: v })} /> %
                    <span className="muted small">total of C+M+Y+K; ask the print shop (often 300%, 260% for uncoated paper)</span>
                  </Row>
                )}
                <Row label="Black">
                  <Check label="Black text and greys on black ink only" value={pdf.pureBlack} onChange={(v) => setPdf({ ...pdf, pureBlack: v })} />
                  <span className="muted small">sharper small text; no colour fringes if the plates shift</span>
                </Row>
              </>
            )}
            <Row label="Quality">
              <Num value={pdf.dpi} step={50} onChange={(v) => setPdf({ ...pdf, dpi: v })} /> DPI
              {pdf.colour === 'rgb' ? (
                <select value={pdf.imageFormat} onChange={(e) => setPdf({ ...pdf, imageFormat: e.target.value as 'jpeg' | 'png' })}>
                  <option value="jpeg">JPEG (smaller file)</option>
                  <option value="png">PNG (lossless, large)</option>
                </select>
              ) : (
                <span className="muted small">CMYK images are lossless, so the PDF is larger (about 1–2 MB per card at 300 DPI, roughly four times that at 600)</span>
              )}
            </Row>
          </>
        )}
        {kind === 'png' && (
          <>
            <Row label="Resolution">
              <Num value={png.dpi} step={50} onChange={(v) => setPng({ ...png, dpi: v })} /> DPI
            </Row>
            <Row label="Options">
              <Check label={`Include bleed (${c.bleedMm} mm)`} value={png.bleed} onChange={(v) => setPng({ ...png, bleed: v })} />
              <Check label="Also export backs" value={png.back} onChange={(v) => setPng({ ...png, back: v })} />
            </Row>
            <Row label="File names">
              <input type="text" value={png.pattern} onChange={(e) => setPng({ ...png, pattern: e.target.value })} style={{ width: 280 }} />
              <span className="muted small">uses {'{fields}'} like templates do</span>
            </Row>
          </>
        )}
        {kind === 'tts' && (
          <>
            <Row label="Options">
              {hasQuantity && <Check label="Use quantities (one slot per copy)" value={tts.useQuantity} onChange={(v) => setTts({ ...tts, useQuantity: v })} />}
            </Row>
            <Row label="Max sheet size">
              <select value={tts.maxSheetPx} onChange={(e) => setTts({ ...tts, maxSheetPx: Number(e.target.value) })}>
                <option value={4096}>4096 px (recommended)</option>
                <option value={8192}>8192 px (sharper, larger)</option>
              </select>
            </Row>
          </>
        )}
        {kind === 'gallery' && (
          <Row label="Picture width">
            <select value={gallery.widthPx} onChange={(e) => setGallery({ ...gallery, widthPx: Number(e.target.value) })}>
              <option value={300}>300 px (small file)</option>
              <option value={400}>400 px (recommended)</option>
              <option value={600}>600 px (sharp when enlarged, larger file)</option>
            </select>
            <span className="muted small">one HTML file with the pictures inside; it opens in any browser without Cardinal</span>
          </Row>
        )}
        {kind === 'gallery' && (
          <Row label="Feedback">
            <Check label="Let playtesters rate cards and send their ratings back" value={gallery.feedback} onChange={(v) => setGallery({ ...gallery, feedback: v })} />
            <span className="muted small">read their files under Playtest → Feedback…</span>
          </Row>
        )}
        <Row label="Save to">
          <label title={fs.writable ? '' : 'The demo is read-only, so files are downloaded.'}>
            <input type="radio" name="export-dest" checked={toFolder} disabled={!fs.writable} onChange={() => setToFolder(true)} /> the game’s <code>export/</code> folder
          </label>
          <label>
            <input type="radio" name="export-dest" checked={!toFolder} onChange={() => setToFolder(false)} /> Downloads
          </label>
        </Row>
        <div>
          {kind === 'pdf' && (
            <button className="primary big" disabled={busy || !items.length || (!perCard && !layout.perPage) || cmykBlocked} onClick={startPdf} title={cmykBlocked ? 'The colour profile could not be used; see the message above' : undefined}>
              Create PDF
            </button>
          )}
          {kind === 'pdf' && (
            <button className="big" disabled={busy || !items.length || cmykBlocked} onClick={startTestSheet} title="One page to print before a big order: ruler, a card at real size with its cut line, colour swatches, smallest text and lines">
              Test print sheet
            </button>
          )}
          {kind === 'png' && (
            <button className="primary big" disabled={busy || !items.length} onClick={startPng}>
              Export images
            </button>
          )}
          {kind === 'gallery' && (
            <button className="primary big" disabled={busy || !items.length} onClick={startGallery}>
              Create gallery
            </button>
          )}
          {kind === 'tts' && (
            <button className="primary big" disabled={busy || !items.length} onClick={startTts}>
              Create deck sheets
            </button>
          )}
        </div>
      </section>

      {kind === 'pdf' && (
        <CostPlanner
          storageKey={k + 'prices'}
          input={{ cardWmm: c.widthMm, cardHmm: c.heightMm, bleedMm: c.bleedMm, copies: printCount, backs: pdf.backs !== 'none', bleed: pdf.bleed, marginMm: pdf.marginMm }}
        />
      )}
      <PrintCheck game={game} items={items} assets={assets} gamut={gamut} profileName={gamut ? (profileState.conv?.name ?? null) : null} />

      {progress && (
        <div className="export-progress">
          <progress value={progress.done} max={Math.max(1, progress.total)} />
          <span>
            {progress.done}/{progress.total} · {progress.label}
          </span>
          <button onClick={() => abort.current?.abort()}>Cancel</button>
        </div>
      )}
      {error && <p className="banner error">{error}</p>}
      {result && (
        <div className="export-result">
          <p>✓ {result.message}</p>
          {result.warnings.length > 0 && (
            <details open={result.warnings.length < 15}>
              <summary className="warn-inline">{result.warnings.length} warning(s)</summary>
              <ul className="warnings">
                {result.warnings.map((w, i) => (
                  <li key={i}>
                    <strong>{w.card}</strong>
                    {w.layer && <code> {w.layer}</code>}: {w.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

const fmtMm = (mm: number) => String(Math.round(mm * 10) / 10);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="export-row">
      <label>{label}</label>
      <div className="inline">{children}</div>
    </div>
  );
}

function Num({ value, onChange, step = 1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return <input type="number" className="num" value={value} step={step} onChange={(e) => Number.isFinite(e.target.valueAsNumber) && onChange(e.target.valueAsNumber)} />;
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}
