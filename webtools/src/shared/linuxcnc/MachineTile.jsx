import NavTile from '../components/NavTile.jsx';
import { MachineIcon } from '../icons.jsx';
import { useMachine } from './react.js';
import { stateLabel, droEntries } from './machine.js';
import './MachineTile.css';

/**
 * Square LinuxCNC status tile, sized to sit in a TileGrid next to NavTiles: machine state and
 * the position readout, live. Outside the AXIS Tools tab it is a dimmed "Not connected" tile.
 */
export default function MachineTile() {
  const available = useMachine((m) => m.available);
  const st = useMachine((m) => m.status);

  if (!available) {
    return <NavTile title="LinuxCNC" icon={MachineIcon} badge="Not connected"
      description="Machine status shows here in the AXIS Tools tab" />;
  }
  const [text, cls] = st ? stateLabel(st) : ['Waiting for status…', ''];
  const dro = droEntries(st);
  return (
    <section className="nav-tile machine-tile" aria-label="LinuxCNC machine status">
      <span className="machine-tile-head">
        <MachineIcon className="machine-tile-icon" />
        <span className="nav-tile-title">LinuxCNC</span>
      </span>
      <span className={'machine-state ' + cls} title={text}>{text}</span>
      {dro.length > 0 && (
        <dl className="machine-dro">
          {dro.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
          ))}
        </dl>
      )}
    </section>
  );
}
