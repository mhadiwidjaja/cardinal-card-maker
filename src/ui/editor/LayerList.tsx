import type { Layer, LayerType } from '../../model/types';

interface Props {
  layers: Layer[];
  selected: string | null;
  inherited: Set<string>;
  hiddenOnCard: Set<string>;
  onSelect: (id: string) => void;
  onToggle: (id: string, prop: 'hidden' | 'locked') => void;
  onMove: (id: string, dir: 1 | -1) => void;
  onDelete: (id: string) => void;
  onAdd: (type: LayerType) => void;
}

const ICON: Record<LayerType, string> = { shape: '◆', image: '▣', text: 'T', icons: '★', group: '▤' };

export function LayerList({ layers, selected, inherited, hiddenOnCard, onSelect, onToggle, onMove, onDelete, onAdd }: Props) {
  const rows: { layer: Layer; depth: number }[] = [];
  const walk = (ls: Layer[], depth: number) => {
    for (let i = ls.length - 1; i >= 0; i--) {
      const l = ls[i]!;
      rows.push({ layer: l, depth });
      if (l.type === 'group') walk(l.layers, depth + 1);
    }
  };
  walk(layers, 0);

  return (
    <div className="layer-list">
      <div className="panel-head">
        <strong>Layers</strong>
        <span className="spacer" />
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onAdd(e.target.value as LayerType);
            e.target.value = '';
          }}
          title="Add a layer above the selected one"
        >
          <option value="">+ Add…</option>
          <option value="text">Text</option>
          <option value="image">Image</option>
          <option value="shape">Shape</option>
          <option value="icons">Icon row</option>
          <option value="group">Group</option>
        </select>
      </div>
      <ul>
        {rows.map(({ layer, depth }) => (
          <li
            key={layer.id}
            className={(layer.id === selected ? 'sel ' : '') + (hiddenOnCard.has(layer.id) ? 'off ' : '') + (layer.hidden ? 'hid' : '')}
            style={{ paddingLeft: 6 + depth * 14 }}
            onClick={() => onSelect(layer.id)}
            title={hiddenOnCard.has(layer.id) ? 'Not shown on this sample card (showIf)' : undefined}
          >
            <span className="ltype">{ICON[layer.type]}</span>
            <span className="lname">
              {layer.name || layer.id}
              {inherited.has(layer.id) && <span className="inh"> inherited</span>}
            </span>
            <span className="lbtns" onClick={(e) => e.stopPropagation()}>
              <button title="Move towards the front" onClick={() => onMove(layer.id, 1)}>
                ↑
              </button>
              <button title="Move towards the back" onClick={() => onMove(layer.id, -1)}>
                ↓
              </button>
              <button title={layer.hidden ? 'Show' : 'Hide'} className={layer.hidden ? 'on' : ''} onClick={() => onToggle(layer.id, 'hidden')}>
                {layer.hidden ? '◌' : '●'}
              </button>
              <button title={layer.locked ? 'Unlock' : 'Lock (stops dragging on the canvas)'} className={layer.locked ? 'on' : ''} onClick={() => onToggle(layer.id, 'locked')}>
                {layer.locked ? '🔒' : '🔓'}
              </button>
              <button title="Delete" onClick={() => onDelete(layer.id)}>
                ✕
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
