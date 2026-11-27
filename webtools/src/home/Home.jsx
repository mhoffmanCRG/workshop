import TileGrid from '../shared/components/TileGrid.jsx';
import NavTile from '../shared/components/NavTile.jsx';
import { TOOLS } from '../tools.js';

// Landing page: one tile per tool (src/tools.js).
export default function Home() {
  return (
    <main className="home">
      <header className="home-head">
        <h1>Workshop tools</h1>
        <p>G-code generators and calculators for the mill.</p>
      </header>
      <TileGrid label="Tools">
        {TOOLS.map((t) => (
          <NavTile key={t.id} title={t.title} description={t.description} icon={t.icon} href={t.href} />
        ))}
      </TileGrid>
    </main>
  );
}
