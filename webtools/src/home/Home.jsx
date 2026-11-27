import TileGrid from '../shared/components/TileGrid.jsx';
import NavTile from '../shared/components/NavTile.jsx';
import { KINDS, useMachineKind, chooseMachineKind, unsuitable } from '../shared/machineKind.js';
import { TOOLS } from '../tools.js';

// In a normal browser there is no LinuxCNC to say what the machine is, so the user picks.
function KindPicker({ kind }) {
  const options = [[null, 'All']].concat(Object.keys(KINDS).map((k) => [k, KINDS[k]]));
  return (
    <div className="kind-picker" role="radiogroup" aria-label="Show tools for">
      {options.map(([k, label]) => (
        <button key={label} type="button" role="radio" aria-checked={kind === k}
          className={kind === k ? 'on' : ''} onClick={() => chooseMachineKind(k)}>{label}</button>
      ))}
    </div>
  );
}

// Landing page: one tile per tool that suits the machine (src/tools.js).
export default function Home() {
  const m = useMachineKind();
  const tools = TOOLS.filter((t) => !unsuitable(t, m));
  const hidden = TOOLS.length - tools.length;
  const forWhat = m.kind ? 'the ' + m.kind : 'the mill and lathe';
  return (
    <main className="home">
      <header className="home-head">
        <div>
          <h1>Workshop tools</h1>
          <p>
            G-code generators and calculators for {forWhat}.
            {m.from === 'linuxcnc' && hidden > 0 && ' ' + hidden + (hidden === 1 ? ' tool that does' : ' tools that do') + ' not suit this machine ' + (hidden === 1 ? 'is' : 'are') + ' hidden.'}
          </p>
        </div>
        {m.from !== 'linuxcnc' && <KindPicker kind={m.kind} />}
      </header>
      <TileGrid label="Tools">
        {tools.map((t) => (
          <NavTile key={t.id} title={t.title} description={t.description} icon={t.icon} href={t.href} />
        ))}
        {tools.length === 0 && (
          <NavTile title={'No ' + m.kind + ' tools yet'} badge="Coming soon"
            description={'The tools so far are for the ' + Object.keys(KINDS).filter((k) => k !== m.kind).join(' and ') + '.'} />
        )}
      </TileGrid>
    </main>
  );
}
