import { Children } from 'react';
import './TileGrid.css';

/**
 * A responsive grid of tiles (usually NavTile), as many per row as fit at `min` px wide or more.
 * Rendered as a list so screen readers announce how many entries there are; `label` names it.
 */
export default function TileGrid({ label, min = 180, children }) {
  return (
    <ul className="tile-grid" aria-label={label} style={{ '--tile-min': min + 'px' }}>
      {Children.map(children, (child) => child && <li>{child}</li>)}
    </ul>
  );
}
