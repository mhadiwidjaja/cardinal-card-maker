import { playtestConfig, type PlaytestConfig } from '../../playtest/table';
import { useEffect, useState, type ReactNode } from 'react';
import { compile } from '../../expr/expr';
import { joinPath, type FileStore } from '../../fs/types';
import { CARD_PRESETS, scaleTemplate } from '../../model/gameOps';
import type { Field, FieldType, FontDef, GameDef, IconDef, Keyword, Game } from '../../model/types';
import type { AssetStore } from '../../render/assets';
import { gameKey, type Project } from '../store';
import { uploadFiles } from '../upload';
import { useCommands } from '../commands';
import { colourClashes, VISION_LABELS, CLASH_DELTA_E } from '../../model/colourVision';

interface Props {
  game: Game;
  fs: FileStore;
  assets: AssetStore;
  project: Project;
  onAssetsChanged: () => void;
  active?: boolean;
}

const TYPES: FieldType[] = ['text', 'richtext', 'number', 'boolean', 'choice', 'multi', 'image', 'color'];
const TYPE_HELP: Record<FieldType, string> = {
  text: 'one line of text',
  richtext: 'card text with [icons], *bold*, _italic_ and keywords',
  number: 'a number (cost, attack…)',
  boolean: 'yes / no',
  choice: 'one value from a list',
  multi: 'several values from a list, e.g. "Fire, Water"',
  image: 'a file name in assets/art',
  color: 'a colour',
};
const ID_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function GameView({ game, fs, assets, project, onAssetsChanged, active = true }: Props) {
  const key = gameKey(game);
  const def = game.def;
  const editable = fs.writable;
  // Always applied to the latest settings, so edits made while a file upload is running aren't lost.
  const update = (fn: (d: GameDef) => GameDef) => project.updateGameDef(key, fn);
  const [files, setFiles] = useState<Record<string, string[]>>({});
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const pt = playtestConfig(def.playtest);
  const setPt = (patch: Partial<PlaytestConfig>) => update((d) => ({ ...d, playtest: { ...playtestConfig(d.playtest), ...patch } }));

  useEffect(() => {
    let alive = true;
    (async () => {
      const out: Record<string, string[]> = {};
      for (const dir of ['frames', 'art', 'icons', 'fonts']) {
        const p = joinPath(game.path, 'assets', dir);
        out[dir] = (await fs.exists(p)) ? (await fs.list(p)).filter((e) => e.kind === 'file' && !e.name.endsWith('.bak')).map((e) => e.name) : [];
      }
      if (alive) setFiles(out);
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [fs, game.path, refresh]);

  async function addFiles(dir: string, list: FileList | null): Promise<string[]> {
    if (!list || !editable) return [];
    const { written, kept } = await uploadFiles(
      fs,
      joinPath(game.path, 'assets', dir),
      Array.from(list).map((f) => ({ name: f.name, data: f })),
    );
    assets.clearImages();
    onAssetsChanged();
    setRefresh((n) => n + 1);
    setNotice(`Copied ${written.length} file(s) into assets/${dir}.` + (kept.length ? ` Kept the existing ${kept.join(', ')}.` : ''));
    return written;
  }

  const c = def.card;
  const setCard = (patch: Partial<GameDef['card']>) => {
    if (patch.dpi && patch.dpi !== c.dpi && Object.keys(game.templates).length) {
      const f = patch.dpi / c.dpi;
      if (window.confirm(`Scale all templates by ${f.toFixed(3)} so they keep the same size on the card?\n\n(Recommended. Choose Cancel to keep the pixel positions as they are.)`)) {
        const scaled = Object.fromEntries(Object.entries(game.templates).map(([id, t]) => [id, scaleTemplate(t, f)]));
        project.setTemplates(key, scaled, Object.keys(scaled));
      }
    }
    update((d) => ({ ...d, card: { ...d.card, ...patch } }));
  };
  const preset = CARD_PRESETS.find((p) => p.w === c.widthMm && p.h === c.heightMm);

  const icons = Object.entries(def.icons ?? {}).filter(([k, v]) => k !== 'aliases' && v && typeof (v as IconDef).file === 'string') as [string, IconDef][];
  const aliases = (def.icons?.aliases ?? {}) as Record<string, string>;
  const setIcons = (list: [string, IconDef][], al: Record<string, string> = aliases) =>
    update((d) => ({ ...d, icons: { ...Object.fromEntries(list), aliases: al } as GameDef['icons'] }));
  const iconsOf = (d: GameDef) =>
    Object.entries(d.icons ?? {}).filter(([k, v]) => k !== 'aliases' && v && typeof (v as IconDef).file === 'string') as [string, IconDef][];

  useCommands(
    'game',
    SECTIONS.map((title) => ({
      id: `gs-${sectionId(title)}`,
      group: 'Settings',
      label: title,
      run: () => document.getElementById(`gs-${sectionId(title)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
    })),
    active,
  );

  return (
    <div className="game-view">
      <nav className="game-nav" aria-label="Sections">
        {SECTIONS.map((t) => (
          <a key={t} href={`#gs-${sectionId(t)}`} onClick={(e) => {
            e.preventDefault();
            document.getElementById(`gs-${sectionId(t)}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}>
            {t}
          </a>
        ))}
      </nav>
      {!editable && <p className="banner error">The demo is read-only. Use “Copy demo to a folder…” (top of the window) to change game settings.</p>}
      {notice && (
        <p className="banner ok">
          {notice} <button onClick={() => setNotice(null)}>✕</button>
        </p>
      )}
      <fieldset disabled={!editable} className="game-fields">
        <Section title="Game">
          <Row label="Name">
            <input type="text" value={def.name} onChange={(e) => update((d) => ({ ...d, name: e.target.value }))} />
          </Row>
          <Row label="Card size">
            <select
              value={preset ? `${preset.w}x${preset.h}` : 'custom'}
              onChange={(e) => {
                const p = CARD_PRESETS.find((x) => `${x.w}x${x.h}` === e.target.value);
                if (p) setCard({ widthMm: p.w, heightMm: p.h });
              }}
            >
              {CARD_PRESETS.map((p) => (
                <option key={p.name} value={`${p.w}x${p.h}`}>
                  {p.name}
                </option>
              ))}
              <option value="custom">Custom</option>
            </select>
            <Num value={c.widthMm} step={0.5} onChange={(v) => setCard({ widthMm: v })} /> ×
            <Num value={c.heightMm} step={0.5} onChange={(v) => setCard({ heightMm: v })} /> mm
          </Row>
          <Row label="Bleed / safe (mm)">
            <Num value={c.bleedMm} step={0.5} onChange={(v) => setCard({ bleedMm: v })} />
            <Num value={c.safeMm} step={0.5} onChange={(v) => setCard({ safeMm: v })} />
            <span className="muted small">bleed is cut off; keep text inside the safe zone</span>
          </Row>
          <Row label="Design DPI">
            <Num value={c.dpi} step={50} onChange={(v) => v > 0 && setCard({ dpi: v })} />
            <span className="muted small">template units are pixels at this resolution</span>
          </Row>
          <Row label="Corner radius (mm)">
            <Num value={c.cornerRadiusMm ?? 0} step={0.5} onChange={(v) => setCard({ cornerRadiusMm: v })} />
          </Row>
          <Row label="Card text">
            <label title="Straight quotes become curly quotes, -- an en dash, --- an em dash and ... an ellipsis. Icon codes like [fire] are not changed.">
              <input
                type="checkbox"
                checked={!!def.text?.smartPunctuation}
                onChange={(e) => update((d) => ({ ...d, text: { ...d.text, smartPunctuation: e.target.checked } }))}
              />{' '}
              Typographic punctuation (“curly quotes”, – and — dashes, …)
            </label>
          </Row>
        </Section>

        <Section title="Fields" hint="The columns every card has. Templates use them as {field}.">
          <FieldsEditor def={def} update={update} />
        </Section>

        <Section title="Colour check" hint="Values told apart by colour (elements, factions) should still look different to colour-blind players.">
          <ColourCheck def={def} />
        </Section>
        <Section title="Icons" hint="Type [name] in card text. Files live in assets/icons.">
          <table className="kv">
            <thead>
              <tr>
                <th />
                <th>Name</th>
                <th>File</th>
                <th>Size</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {icons.map(([name, ic], i) => (
                <tr key={name}>
                  <td>
                    <IconThumb fs={fs} assets={assets} file={ic.file} />
                  </td>
                  <td>
                    <code>[{name}]</code>
                  </td>
                  <td>
                    <select value={ic.file} onChange={(e) => setIcons(icons.map((x, j) => (j === i ? [name, { ...ic, file: e.target.value }] : x)))}>
                      {!files.icons?.includes(ic.file.replace(/^icons\//, '')) && <option value={ic.file}>{ic.file} (missing)</option>}
                      {(files.icons ?? []).map((f) => (
                        <option key={f} value={`icons/${f}`}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <Num value={ic.scale ?? 1} step={0.05} onChange={(v) => setIcons(icons.map((x, j) => (j === i ? [name, { ...ic, scale: v === 1 ? undefined : v }] : x)))} />
                  </td>
                  <td>
                    <button onClick={() => setIcons(icons.filter((_, j) => j !== i))}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="inline">
            <FileButton
              label="Add icon files…"
              accept=".svg,.png,.webp"
              onFiles={async (fl) => {
                const names = await addFiles('icons', fl);
                update((d) => {
                  const list = iconsOf(d);
                  for (const n of names) {
                    const id = n.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
                    if (!list.some(([k]) => k === id)) list.push([id, { file: `icons/${n}` }]);
                  }
                  return { ...d, icons: { ...Object.fromEntries(list), aliases: d.icons?.aliases ?? {} } as GameDef['icons'] };
                });
              }}
            />
            <span className="muted small">Each file becomes an icon named after it (fire.svg → [fire]).</span>
          </div>
          <Row label="Aliases">
            <TextCommit
              value={Object.entries(aliases)
                .map(([a, t]) => `${a}=${t}`)
                .join(', ')}
              placeholder="f=fire, w=water"
              onCommit={(v) => {
                const al: Record<string, string> = {};
                for (const part of v.split(',')) {
                  const [a, t] = part.split('=').map((s) => s.trim());
                  if (a && t) al[a] = t;
                }
                setIcons(icons, al);
              }}
            />
          </Row>
        </Section>

        <Section title="Keywords" hint="On a line that only lists keywords (“Swift, Shield 2”), reminder text is added. Use {n:number}, {x:word} or {t:text} as parameters.">
          <table className="kv">
            <thead>
              <tr>
                <th>Name</th>
                <th>Matches</th>
                <th>Reminder text</th>
                <th>When</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(def.keywords ?? []).map((k, i) => {
                const set = (patch: Partial<Keyword>) => update((d) => ({ ...d, keywords: (d.keywords ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
                return (
                  <tr key={i}>
                    <td>
                      <input type="text" value={k.name} onChange={(e) => set({ name: e.target.value })} />
                    </td>
                    <td>
                      <input type="text" value={k.match} onChange={(e) => set({ match: e.target.value })} />
                    </td>
                    <td>
                      <input type="text" className="wide" value={k.reminder ?? ''} onChange={(e) => set({ reminder: e.target.value })} />
                    </td>
                    <td>
                      <select value={k.auto ?? 'always'} onChange={(e) => set({ auto: e.target.value as Keyword['auto'] })}>
                        <option value="always">always</option>
                        <option value="firstUse">first use</option>
                        <option value="never">never</option>
                      </select>
                    </td>
                    <td>
                      <button onClick={() => update((d) => ({ ...d, keywords: (d.keywords ?? []).filter((_, j) => j !== i) }))}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button onClick={() => update((d) => ({ ...d, keywords: [...(d.keywords ?? []), { name: 'Keyword', match: 'Keyword', reminder: '(What it does.)', auto: 'firstUse' }] }))}>
            + Keyword
          </button>
        </Section>

        <Section title="Fonts" hint="Font files in assets/fonts (TTF, OTF, WOFF). Use the family name in text layers.">
          <table className="kv">
            <thead>
              <tr>
                <th>Family</th>
                <th>File</th>
                <th>Weight</th>
                <th>Italic</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(def.fonts ?? []).map((f, i) => {
                const set = (patch: Partial<FontDef>) => update((d) => ({ ...d, fonts: (d.fonts ?? []).map((x, j) => (j === i ? { ...x, ...patch } : x)) }));
                return (
                  <tr key={i}>
                    <td>
                      <input type="text" value={f.family} onChange={(e) => set({ family: e.target.value })} />
                    </td>
                    <td>
                      <code>{f.file}</code>
                    </td>
                    <td>
                      <select value={f.weight ?? 400} onChange={(e) => set({ weight: Number(e.target.value) })}>
                        {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((w) => (
                          <option key={w} value={w}>
                            {w}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input type="checkbox" checked={f.style === 'italic'} onChange={(e) => set({ style: e.target.checked ? 'italic' : 'normal' })} />
                    </td>
                    <td>
                      <button onClick={() => update((d) => ({ ...d, fonts: (d.fonts ?? []).filter((_, j) => j !== i) }))}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <FileButton
            label="Add font files…"
            accept=".ttf,.otf,.woff,.woff2"
            onFiles={async (fl) => {
              const names = await addFiles('fonts', fl);
              update((d) => ({ ...d, fonts: [...(d.fonts ?? []), ...names.filter((n) => !(d.fonts ?? []).some((f) => f.file === `fonts/${n}`)).map(guessFont)] }));
            }}
          />
          <p className="hint">Check the font’s license allows embedding if you print through a print shop.</p>
        </Section>

        <Section title="Artwork files" hint="Images used by templates. Card art goes in art/ (the art column holds the file name); frames in frames/.">
          {(['art', 'frames'] as const).map((dir) => (
            <Row key={dir} label={`assets/${dir}`}>
              <span className="muted small">{files[dir]?.length ?? 0} files</span>
              <FileButton label="Add files…" accept="image/*" onFiles={(fl) => addFiles(dir, fl)} />
              <span className="file-list small muted">{(files[dir] ?? []).slice(0, 12).join(', ')}{(files[dir]?.length ?? 0) > 12 ? ' …' : ''}</span>
            </Row>
          ))}
        </Section>

        <Section title="Playtest table" hint="Starting values for the Playtest tab. Counters are things like life or resources.">
          <Row label="Opening hand">
            <Num value={pt.handSize} onChange={(v) => setPt({ handSize: Math.max(0, Math.round(v)) })} /> cards
          </Row>
          <Row label="Draw each turn">
            <Num value={pt.drawPerTurn} onChange={(v) => setPt({ drawPerTurn: Math.max(0, Math.round(v)) })} /> cards
          </Row>
          <Row label="Counters">
            <div className="pt-counters-edit">
              {pt.counters.map((c, i) => (
                <span key={i} className="inline">
                  <input type="text" aria-label="Counter name" value={c.name} onChange={(e) => setPt({ counters: pt.counters.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                  <span className="muted small">starts at</span>
                  <Num value={c.start} onChange={(v) => setPt({ counters: pt.counters.map((x, j) => (j === i ? { ...x, start: v } : x)) })} />
                  <button aria-label={`Remove counter ${c.name}`} title="Remove" onClick={() => setPt({ counters: pt.counters.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </span>
              ))}
              <button onClick={() => setPt({ counters: [...pt.counters, { name: 'Counter', start: 0 }] })}>+ Counter</button>
            </div>
          </Row>
        </Section>

        <Section title="Variables" hint="Game-wide values for templates: {var.name}.">
          <TextCommit
            value={Object.entries(def.variables ?? {})
              .map(([a, b]) => `${a}=${b}`)
              .join('\n')}
            multiline
            placeholder={'edition=First\nyear=2026'}
            onCommit={(v) => {
              const vars: Record<string, string> = {};
              for (const line of v.split('\n')) {
                const i = line.indexOf('=');
                if (i > 0) vars[line.slice(0, i).trim()] = line.slice(i + 1).trim();
              }
              update((d) => ({ ...d, variables: Object.keys(vars).length ? vars : undefined }));
            }}
          />
        </Section>
      </fieldset>
    </div>
  );
}

function FieldsEditor({ def, update }: { def: GameDef; update: (fn: (d: GameDef) => GameDef) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const setField = (i: number, patch: Partial<Field>) =>
    update((d) => ({
      ...d,
      fields: d.fields.map((f, j) => {
        if (j !== i) return f;
        const n = { ...f, ...patch } as Record<string, unknown>;
        for (const k of Object.keys(patch)) if ((patch as Record<string, unknown>)[k] === undefined) delete n[k];
        return n as unknown as Field;
      }),
    }));
  const move = (i: number, dir: -1 | 1) =>
    update((d) => {
      const f = [...d.fields];
      const j = i + dir;
      if (j < 0 || j >= f.length) return d;
      [f[i], f[j]] = [f[j]!, f[i]!];
      return { ...d, fields: f };
    });

  return (
    <div className="fields-editor">
      {def.fields.map((f, i) => {
        let exprErr: string | null = null;
        if (f.computed) {
          try {
            compile(f.computed);
          } catch (e) {
            exprErr = (e as Error).message;
          }
        }
        return (
          <div key={f.id} className={'field-row' + (open === f.id ? ' open' : '')}>
            <div className="field-head">
              <code className="fid">{f.id}</code>
              <input type="text" placeholder="label" value={f.label ?? ''} onChange={(e) => setField(i, { label: e.target.value || undefined })} />
              <select value={f.type} onChange={(e) => setField(i, { type: e.target.value as FieldType })} title={TYPE_HELP[f.type]}>
                {TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <span className="muted small grow">
                {f.source === 'templates' ? 'picks the template' : TYPE_HELP[f.type]}
                {f.role === 'quantity' ? ' · quantity' : ''}
                {f.identifying ? ' · card name' : ''}
                {f.computed ? ' · computed' : ''}
              </span>
              <button onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? 'Close' : 'Details'}</button>
              <button onClick={() => move(i, -1)} title="Move up">
                ↑
              </button>
              <button onClick={() => move(i, 1)} title="Move down">
                ↓
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Remove the field "${f.id}"? Values already in cards.csv are kept as an extra column.`)) update((d) => ({ ...d, fields: d.fields.filter((_, j) => j !== i) }));
                }}
                title="Remove field"
              >
                ✕
              </button>
            </div>
            {open === f.id && (
              <div className="field-details">
                {(f.type === 'choice' || f.type === 'multi') && f.source !== 'templates' && (
                  <>
                    <Row label="Choices">
                      <TextCommit value={(f.choices ?? []).join(', ')} placeholder="Common, Uncommon, Rare" onCommit={(v) => setField(i, { choices: v.split(',').map((s) => s.trim()).filter(Boolean) })} />
                    </Row>
                    <Row label="Colours">
                      {(f.choices ?? []).map((ch) => (
                        <label key={ch} className="inline small">
                          <input
                            type="color"
                            value={f.colors?.[ch] ?? '#888888'}
                            onChange={(e) => setField(i, { colors: { ...(f.colors ?? {}), [ch]: e.target.value } })}
                          />
                          {ch}
                        </label>
                      ))}
                      <span className="muted small">used by statistics and {'{color.' + f.id + '}'}</span>
                    </Row>
                  </>
                )}
                {f.type === 'number' && (
                  <Row label="Min / max">
                    <Num value={f.min ?? 0} onChange={(v) => setField(i, { min: v })} />
                    <Num value={f.max ?? 0} onChange={(v) => setField(i, { max: v || undefined })} />
                    <span className="muted small">max 0 = no limit</span>
                  </Row>
                )}
                <Row label="Default">
                  <input type="text" value={f.default === undefined ? '' : String(f.default)} onChange={(e) => setField(i, { default: e.target.value === '' ? undefined : e.target.value })} />
                </Row>
                <Row label="Special">
                  <label className="inline small">
                    <input type="checkbox" checked={!!f.identifying} onChange={(e) => setField(i, { identifying: e.target.checked || undefined })} /> card name
                  </label>
                  {f.type === 'number' && (
                    <label className="inline small">
                      <input type="checkbox" checked={f.role === 'quantity'} onChange={(e) => setField(i, { role: e.target.checked ? 'quantity' : undefined })} /> quantity (copies to print)
                    </label>
                  )}
                  <label className="inline small">
                    <input type="checkbox" checked={!!f.stats?.hidden} onChange={(e) => setField(i, { stats: { ...(f.stats ?? {}), hidden: e.target.checked || undefined } })} /> hide in statistics
                  </label>
                </Row>
                <Row label="Computed">
                  <div className="expr">
                    <input
                      type="text"
                      className={exprErr ? 'bad' : ''}
                      value={f.computed ?? ''}
                      placeholder="e.g. attack + health  (leave empty for a normal field)"
                      onChange={(e) => setField(i, { computed: e.target.value || undefined })}
                    />
                    {exprErr && <div className="err">{exprErr}</div>}
                  </div>
                </Row>
              </div>
            )}
          </div>
        );
      })}
      <button
        onClick={() => {
          const id = window.prompt('Id of the new field (letters, digits, - or _; it becomes the CSV column name):', 'newField');
          if (!id) return;
          if (!ID_RE.test(id)) return window.alert('Start with a letter; use letters, digits, - or _.');
          if (def.fields.some((f) => f.id.toLowerCase() === id.toLowerCase())) return window.alert(`There is already a field "${id}".`);
          update((d) => ({ ...d, fields: [...d.fields, { id, type: 'text' }] }));
        }}
      >
        + Field
      </button>
      <p className="hint">Field ids can’t be renamed here because cards.csv and templates refer to them. Add a new field, copy the column, then remove the old one.</p>
    </div>
  );
}

function guessFont(file: string): FontDef {
  const base = file.replace(/\.[^.]+$/, '');
  const weight = /black|heavy/i.test(base) ? 900 : /extrabold|ultrabold/i.test(base) ? 800 : /semibold|demibold/i.test(base) ? 600 : /bold/i.test(base) ? 700 : /medium/i.test(base) ? 500 : /light/i.test(base) ? 300 : 400;
  const style = /italic|oblique/i.test(base) ? 'italic' : 'normal';
  const family = base
    .replace(/[-_ ]?(regular|bold|italic|oblique|black|heavy|light|medium|semibold|demibold|extrabold|ultrabold|thin)+$/gi, '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
  return { family: family || base, file: `fonts/${file}`, weight, style };
}

function IconThumb({ fs, assets, file }: { fs: FileStore; assets: AssetStore; file: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    assets
      .findFile(file)
      .then((p) => (p ? fs.readBlob(p) : null))
      .then((b) => {
        if (!b) return;
        u = URL.createObjectURL(/\.svg$/i.test(file) ? new Blob([b], { type: 'image/svg+xml' }) : b);
        setUrl(u);
      })
      .catch(() => {});
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [fs, assets, file]);
  return url ? <img src={url} alt="" className="icon-thumb" /> : <span className="icon-thumb missing">?</span>;
}

const SECTIONS = ['Game', 'Fields', 'Colour check', 'Icons', 'Keywords', 'Fonts', 'Artwork files', 'Playtest table', 'Variables'];
const sectionId = (t: string) => t.toLowerCase().replace(/\W+/g, '-');

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="game-section" id={`gs-${sectionId(title)}`}>
      <h3>{title}</h3>
      {hint && <p className="hint">{hint}</p>}
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="export-row">
      <label>{label}</label>
      <div className="inline">{children}</div>
    </div>
  );
}

function Num({ value, onChange, step = 1 }: { value: number; onChange: (v: number) => void; step?: number }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <input
      type="number"
      className="num"
      value={text}
      step={step}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value !== '' && Number.isFinite(e.target.valueAsNumber)) onChange(e.target.valueAsNumber);
      }}
    />
  );
}

function TextCommit({ value, onCommit, placeholder, multiline }: { value: string; onCommit: (v: string) => void; placeholder?: string; multiline?: boolean }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const props = {
    value: text,
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: () => text !== value && onCommit(text),
  };
  return multiline ? <textarea rows={3} {...props} /> : <input type="text" className="wide" {...props} />;
}

function FileButton({ label, accept, onFiles }: { label: string; accept: string; onFiles: (f: FileList | null) => unknown }) {
  return (
    <label className="file-button">
      {label}
      <input
        type="file"
        multiple
        accept={accept}
        onChange={(e) => {
          void onFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </label>
  );
}

function ColourCheck({ def }: { def: GameDef }) {
  const clashes = colourClashes({ def } as Game);
  const fields = def.fields.filter((f) => Object.keys(f.colors ?? {}).length >= 2);
  if (!fields.length) return <p className="muted small">No field has colours per value yet (fields → colours, e.g. one per element).</p>;
  if (!clashes.length) return <p>✓ Every pair of colours stays clearly different, also for colour-blind players and in greyscale.</p>;
  const pairs = new Map<string, typeof clashes>();
  for (const c of clashes) {
    const k = `${c.field}:${c.a}:${c.b}`;
    pairs.set(k, [...(pairs.get(k) ?? []), c]);
  }
  return (
    <>
      <ul className="colour-clashes">
        {[...pairs.values()].map((list) => (
          <li key={`${list[0]!.field}:${list[0]!.a}:${list[0]!.b}`}>
            <b>
              {list[0]!.a} and {list[0]!.b}
            </b>{' '}
            <span className="muted">({list[0]!.field})</span> look alike:
            {list.map((c) => (
              <span key={c.vision} className="clash">
                <span className="swatch" style={{ background: c.seenA }} />
                <span className="swatch" style={{ background: c.seenB }} /> {VISION_LABELS[c.vision]} (difference {Math.round(c.deltaE)})
              </span>
            ))}
          </li>
        ))}
      </ul>
      <p className="muted small">
        A difference under {CLASH_DELTA_E} is hard to see on a small icon or a frame across the table. Fix it by making one colour clearly lighter or darker, or by
        always showing an icon or a word next to the colour.
      </p>
    </>
  );
}
