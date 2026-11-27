import { useState } from 'react';
import DRILL from './lib/drill.js';
import PCD from '../pcd/lib/pcd.js';
import ToolPage from '../../shared/toolpath/ToolPage.jsx';
import { makeParams } from '../../shared/toolpath/params.js';
import { ProgramSection } from '../../shared/toolpath/fields.jsx';
import { Num, Sel, Check, Text, Section } from '../../shared/components/tool/Fields.jsx';
import { duration } from '../../shared/components/tool/Tiles.jsx';

const params = makeParams(DRILL.DEFAULTS, 'drill-settings');
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const f3 = (v) => v.toFixed(3).replace(/\.?0+$/, '') || '0';
const CYCLE_OPTIONS = Object.keys(DRILL.CYCLES).map((k) => [k, DRILL.CYCLES[k].label]);
const MATERIAL_OPTIONS = Object.keys(PCD.MATERIALS).map((k) => [k, PCD.MATERIALS[k].label]);
const DRILLING = 'drill spot dwell peck chipbreak deep';

// A new cycle brings a tool and depth that suit it (as on the PCD page).
function applyEdit(values, name, value) {
  const prev = values, next = { ...values, [name]: value };
  const num = (k) => Number(next[k]);
  if (name === 'cycle' && value !== prev.cycle) {
    const hole = num('holeDia');
    if (value === 'spot') {
      next.pointAngle = '90';
      next.depth = String(Math.round((hole / 2 + 0.3) * 100) / 100);
      next.depthTo = 'tip';
      if (num('toolDia') < hole + 0.6) next.toolDia = String([6, 8, 10, 12, 16, 20].find((d) => d >= hole + 0.6) || 20);
    } else if (value === 'tap') {
      const t = PCD.TAPS.reduce((b, s) => (Math.abs(s[0] - s[1] - hole) < Math.abs(b[0] - b[1] - hole) ? s : b));
      next.toolDia = String(t[0]);
      next.tapPitch = String(t[1]);
      next.rpm = String(Math.min(num('rpm') || 300, 300));
      if (prev.cycle === 'spot') next.depth = String(DRILL.DEFAULTS.depth);
    } else if (prev.cycle === 'spot' || prev.cycle === 'tap') {
      next.pointAngle = String(DRILL.DEFAULTS.pointAngle);
      next.depthTo = 'full';
      next.toolDia = String(hole);
      if (prev.cycle === 'spot') next.depth = String(DRILL.DEFAULTS.depth);
      if (prev.cycle === 'tap') next.rpm = String(DRILL.DEFAULTS.rpm);
    }
  }
  // a drill that was the hole size stays the hole size
  if (name === 'holeDia' && DRILLING.split(' ').indexOf(next.cycle) >= 0 && next.cycle !== 'spot' && Number(prev.toolDia) === Number(prev.holeDia)) next.toolDia = value;
  return next;
}

const OP = { ...DRILL, applyEdit };

const CYCLE_HINTS = {
  drill: 'Straight down to depth in one go and straight back out. Fine for holes up to about 3 to 4 diameters deep.',
  spot: 'A short, stiff spot drill marks each hole so the drill starts true, and chamfers its edge.',
  dwell: 'Waits at the bottom so the floor is cut flat: for counterbores and spot faces.',
  chipbreak: 'G73 pecks down by Q and backs off 0.25 mm after each peck to snap the chip, without leaving the hole. Quick; for holes up to about 5 diameters, and stringy metals like aluminium and mild steel.',
  peck: 'G83 pulls right out to the R plane after every peck, so the chips come out and coolant gets in. For deep holes and metals that pack the flutes.',
  deep: 'Pecks start at the first peck and get shorter as the hole deepens, where chips pack worst. Between full retracts the drill backs off 0.25 mm to break the chip. Written out as G0 / G1 moves, since no canned cycle does this.',
  tap: 'G33.1 feeds the tap down in step with the spindle, reverses it at the bottom and brings it back out to the R plane.'
};

function feedInfo(r) {
  if (!r || !r.gcode) return '';
  const p = r.params, g = r.geom, s = r.stats;
  if (g.tap) return 'A tap feeds one pitch per turn: ' + p.rpm + ' rpm × ' + p.tapPitch + ' mm = ' + Math.round(s.tapFeed) + ' mm/min, kept in step with the spindle by G33.1.';
  return (p.feedAuto ? g.materialLabel + ': ' + g.materialRev.toFixed(3) + ' mm per turn gives ' + p.feed + ' mm/min at ' + p.rpm + ' rpm. '
    : 'Feed per turn: ' + (p.feed / p.rpm).toFixed(3) + ' mm (typical for ' + g.materialLabel.toLowerCase() + ': ' + g.materialRev.toFixed(3) + '). ') +
    'A usual spindle speed for a ' + p.toolDia + ' mm HSS drill in ' + g.materialLabel.toLowerCase() + ' is about ' + (Math.round(Math.min(g.sugRpm, 5000) / 50) * 50).toLocaleString() + ' rpm.';
}

function cycleTile(r) {
  const p = r.params, g = r.geom, s = r.stats;
  if (p.cycle === 'peck' || p.cycle === 'chipbreak' || p.cycle === 'deep') return { id: 'cycle', label: 'Pecks per hole', value: String(g.peckLevels.length) };
  if (p.cycle === 'spot') return { id: 'cycle', label: 'Spot diameter', value: g.spotDia.toFixed(2), unit: 'mm' };
  if (p.cycle === 'dwell') return { id: 'cycle', label: 'Dwell at bottom', value: String(p.holeDwell), unit: 's' };
  if (p.cycle === 'tap') return { id: 'cycle', label: 'Tap feed (synced)', value: String(Math.round(s.tapFeed)), unit: 'mm/min' };
  return { id: 'cycle', label: 'Cycle', value: DRILL.CYCLES[p.cycle].code };
}

function tiles(r, timeShown) {
  const p = r.params, g = r.geom, s = r.stats, first = g.list[0];
  return [
    { id: 'holes', label: 'Holes to drill', value: g.list.length + (g.list.length < g.all.length ? ' of ' + g.all.length : ''), key: true },
    { id: 'dia', label: 'Hole diameter', value: 'Ø' + f2(p.holeDia), unit: 'mm' },
    { id: 'spacing', label: 'Closest spacing', value: g.all.length > 1 ? f3(g.closest) : '–', unit: g.all.length > 1 ? 'mm' : '' },
    { id: 'wall', label: 'Wall between', value: g.all.length > 1 ? g.wall.toFixed(2) : '–', unit: g.all.length > 1 ? 'mm' : '' },
    { id: 'first', label: 'Hole ' + first.n + ' at', value: 'X' + f3(first.x) + ' Y' + f3(first.y) },
    { id: 'depth', label: g.tap ? 'Thread depth' : g.tipLen > 0 && !g.spot ? 'Depth to tip' : 'Depth', value: s.holeDepth.toFixed(2), unit: 'mm' },
    cycleTile(r),
    ...(g.tap ? [] : [{ id: 'feed', label: 'Feed', value: String(p.feed), unit: 'mm/min' }]),
    { id: 'rpm', label: 'Spindle', value: String(p.rpm), unit: 'rpm' },
    { id: 'time', label: 'Estimated run time', value: duration(s.minutes), pressed: timeShown, controls: 'timecalc' }
  ];
}

// Hole positions for the table (and for copying as text).
function HoleTable({ r }) {
  const [label, setLabel] = useState('Copy');
  if (!r || !r.gcode) return null;
  const rows = r.geom.all;
  const text = 'Hole\tX\tY\n' + rows.filter((h) => !h.skip).map((h) => h.n + '\t' + h.x.toFixed(4) + '\t' + h.y.toFixed(4)).join('\n') + '\n';
  function copy() {
    const done = (good) => { setLabel(good ? 'Copied' : 'Copy failed'); setTimeout(() => setLabel('Copy'), 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    else done(false);
  }
  return (
    <section className="panel coords-panel">
      <div className="toolbar">
        <h2>Hole positions</h2>
        <button type="button" className="quiet" onClick={copy}>{label}</button>
      </div>
      <div className="coords-wrap">
        <table className="time-table coords-table">
          <thead><tr><th>Hole</th><th>X</th><th>Y</th></tr></thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.n} className={h.skip ? 'skipped' : ''}>
                <td>{h.n}{h.skip ? ' (skipped)' : ''}</td><td>{h.x.toFixed(4)}</td><td>{h.y.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Work coordinates, in drilling order. Copy gives a tab-separated list of the holes drilled.</p>
    </section>
  );
}

const setup = (
  <>
    <ol>
      <li>Clamp the part clear of the holes, with something under it if the drill goes through: the warnings say when the tip passes the bottom.</li>
      <li>Set X and Y zero so the first hole lands at &ldquo;First hole X / Y&rdquo; (or the listed positions are right). Check the hole table against the drawing.</li>
      <li>Set Z zero to match &ldquo;Top of part&rdquo;, with the drill tip as the tool length reference.</li>
      <li>For holes bigger than about 6 mm, spot them first (cycle &ldquo;Spot drilling&rdquo; with a 90° spot drill), then drill with the same pattern. Tapped holes are drilled to the tap drill size first, deeper than the thread.</li>
      <li>Run the program in air with Z zero raised first.</li>
      <li>Rigid tapping (G33.1) only works with a spindle encoder set up in LinuxCNC. Without one, tap by hand or with a floating tapping head.</li>
    </ol>
    <p>A grid is drilled row by row, back and forth unless you choose every row the same way. Between holes the tool goes back to the R plane (G99), just above the part; pick &ldquo;Clearance height&rdquo; (G98) when clamps stand higher.</p>
  </>
);

export default function App() {
  return (
    <ToolPage op={OP} params={params} id="drill" shapeKey="pattern"
      heading={(values, edit) => (
        <>
          <select name="cycle" className="title-select" aria-label="Cycle" title="Cycle"
            value={values.cycle} onChange={(e) => edit('cycle', e.target.value)}>
            {CYCLE_OPTIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select> holes
        </>
      )}
      about="Drills, spots or taps holes in a grid, along a line or at listed positions, with LinuxCNC canned cycles (G81, G82, G83, G73) or rigid tapping (G33.1). For holes round a circle use PCD."
      setup={setup}
      fields={(ctx) => {
        const v = ctx.values, tap = v.cycle === 'tap', locked = !!(ctx.result && ctx.result.params.feedAuto);
        return (
          <>
            <Section title="Pattern" names={['pattern', 'x0', 'y0', 'cols', 'rows', 'dx', 'dy', 'count', 'pitch', 'angle', 'order', 'centres', 'skip']}>
              <Sel name="pattern" label="Holes" options={Object.keys(DRILL.PATTERNS).map((k) => [k, DRILL.PATTERNS[k]])} />
              <Num name="cols" label="Holes per row" shape="grid" min="1" step="1" />
              <Num name="rows" label="Rows" shape="grid" min="1" step="1" />
              <Num name="dx" label="Spacing along the rows (X)" unit="mm" shape="grid" min="0" step="1" />
              <Num name="dy" label="Row spacing (Y)" unit="mm" shape="grid" min="0" step="1" />
              <Sel name="order" label="Order" shape="grid" options={[['zigzag', 'Back and forth'], ['rows', 'Every row the same way']]} />
              <Num name="count" label="Number of holes" shape="line" min="1" step="1" />
              <Num name="pitch" label="Spacing" unit="mm" shape="line" min="0" step="1" />
              <Num name="x0" label="First hole X" unit="mm" shape="grid line" step="1" />
              <Num name="y0" label="First hole Y" unit="mm" shape="grid line" step="1" />
              <Num name="angle" label="Turned by" unit="deg" shape="grid line" step="5" />
              <Text name="centres" label="Hole positions (x,y; x,y ...)" shape="list" placeholder="0,0; 20,0" />
              <Text name="skip" label="Holes to leave out (e.g. 2, 5-6)" placeholder="none" />
            </Section>

            <Section title="Hole" names={['holeDia', 'depth', 'depthTo', 'pointAngle', 'zTop', 'thickness', 'retract', 'clearance', 'retractMode', 'peck', 'peckMin', 'peckReduce', 'fullEvery', 'holeDwell', 'tapPitch']}>
              <Num name="holeDia" label={tap ? 'Tap drill hole' : 'Hole diameter'} unit="mm" min="0" step="0.1" />
              <Num name="depth" label={tap ? 'Thread depth' : v.cycle === 'spot' ? 'Spot depth (to tip)' : 'Hole depth'} unit="mm" min="0" step="0.5" />
              {v.cycle !== 'spot' && !tap && <Sel name="depthTo" label="Depth is" options={[['full', 'To full diameter'], ['tip', 'To the tip']]} />}
              {!tap && <Num name="pointAngle" label="Point angle" unit="deg" min="60" max="180" step="1" />}
              {(v.cycle === 'peck' || v.cycle === 'chipbreak') && <Num name="peck" label="Peck depth (Q)" unit="mm" min="0" step="0.5" />}
              {v.cycle === 'deep' && <>
                <Num name="peck" label="First peck" unit="mm" min="0" step="0.5" />
                <Num name="peckReduce" label="Each peck shorter by" unit="%" min="0" max="90" step="5" />
                <Num name="peckMin" label="Smallest peck" unit="mm" min="0" step="0.1" />
                <Num name="fullEvery" label="Full retract every" unit="pecks, 1 = every peck" min="1" max="50" step="1" />
              </>}
              {v.cycle === 'dwell' && <Num name="holeDwell" label="Dwell at bottom (P)" unit="s" min="0" step="0.1" />}
              {tap && <Num name="tapPitch" label="Thread pitch (K)" unit="mm" min="0" step="0.05" />}
              <Num name="zTop" label="Top of part" unit="Z mm" step="0.5" />
              <Num name="thickness" label="Part thickness" unit="mm, 0 = not given" min="0" step="1" />
              <Num name="retract" label="R plane above top" unit="mm" min="0" step="0.5" />
              <Num name="clearance" label="Clearance above top" unit="mm" min="0" step="1" />
              <Sel name="retractMode" label="Between holes" options={[['r', 'R plane (G99)'], ['clear', 'Clearance (G98)']]} />
              <p className="hint">{CYCLE_HINTS[v.cycle]}</p>
            </Section>

            <Section title="Tool" names={['toolDia', 'material', 'rpm', 'feedAuto', 'feed']}>
              <Num name="toolDia" label={tap ? 'Tap size' : v.cycle === 'spot' ? 'Spot drill diameter' : 'Drill diameter'} unit="mm" min="0" step="0.1" />
              <Sel name="material" label="Material" options={MATERIAL_OPTIONS} />
              <Num name="rpm" label="Spindle speed" unit="rpm" min="0" step="50" />
              {!tap && <Check name="feedAuto">Set the feed from the material</Check>}
              {!tap && <Num name="feed" label="Feed" unit="mm/min" min="0" step="5" disabled={locked} />}
              <p className="hint">{feedInfo(ctx.ok ? ctx.result : ctx.last)}</p>
            </Section>

            <ProgramSection />
          </>
        );
      }}
      tiles={tiles}
      sectionCaption="Section through the first hole's row along X, with the R plane, clearance and peck depths"
      timeRows={[['cut', 'Drilling (or tapping in)'], ['out', 'Tapping out (spindle reversed)'], ['pause', 'Dwell at the bottom'], ['move', 'Moves at feed']]}
      timeNote="Canned cycles are timed as LinuxCNC runs them, peck by peck."
      extra={(r) => <HoleTable r={r} />}
    />
  );
}
