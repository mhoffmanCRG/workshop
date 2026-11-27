import { useLayoutEffect, useRef } from 'react';

/** Minutes as "12 min" or "1 h 5 min". */
export function duration(minutes) {
  const m = Math.round(minutes);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}

// Shrink each tile line that overflows, a half pixel at a time, down to MIN_SCALE of its normal
// size; past that the CSS ellipsis cuts it short (the full text is in the tooltip).
const MIN_SCALE = 0.8;
function fit(box) {
  box.querySelectorAll('.tile-label, .tile-value').forEach((line) => {
    line.style.fontSize = '';
    if (line.scrollWidth <= line.clientWidth) return;
    const full = parseFloat(getComputedStyle(line).fontSize), min = full * MIN_SCALE;
    let size = full;
    while (line.scrollWidth > line.clientWidth && size - 0.5 >= min) {
      size -= 0.5;
      line.style.fontSize = size + 'px';
    }
  });
}

/**
 * A block of summary tiles (value buttons). Click one to select it; onSelect(id) decides what that does.
 * items: [{ id, label, value, unit, key, pressed, controls }], or null while there is nothing to show.
 *   key      true marks the tile the job starts from (accent border)
 *   pressed  overrides the selected state (e.g. a tile that opens a panel)
 *   controls id of the element the tile opens
 */
export default function Tiles({ items, selected, onSelect }) {
  const box = useRef(null);
  // refit when the values change and when the tiles get narrower or wider (side column folded, window resized)
  useLayoutEffect(() => { fit(box.current); });
  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => fit(box.current));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  if (!items) return <div className="tiles" ref={box} />;
  return (
    <div className="tiles" ref={box}>
      {items.map(({ id, label, value, unit, key, pressed, controls }) => (
        <button key={id} type="button" className={'tile' + (key ? ' key-tile' : '')} data-tile={id}
          aria-pressed={pressed !== undefined ? pressed : selected === id}
          aria-controls={controls}
          title={label + ': ' + value + (unit ? ' ' + unit : '')}
          onClick={() => onSelect(id)}>
          <span className="tile-label">{label}</span>
          <span className="tile-value">{value}{unit ? <small>{unit}</small> : null}</span>
        </button>
      ))}
    </div>
  );
}
