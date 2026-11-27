import POCKET from './lib/pocket.js';
import ToolPage from '../../shared/toolpath/ToolPage.jsx';
import { makeParams } from '../../shared/toolpath/params.js';
import { CutterSection, ProgramSection } from '../../shared/toolpath/fields.jsx';
import { Num, Sel, Check, Section } from '../../shared/components/tool/Fields.jsx';
import { duration } from '../../shared/components/tool/Tiles.jsx';

const params = makeParams(POCKET.DEFAULTS, 'pocket-settings');
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const ENTRY = { helix: 'Helix', ramp: 'Ramp', plunge: 'Plunge' };

function tiles(r, timeShown) {
  const p = r.params, g = r.geom, s = r.stats, round = p.shape === 'circle';
  return [
    { id: 'size', label: round ? 'Pocket diameter' : 'Pocket size', value: round ? 'Ø' + f2(p.dia) : f2(p.width) + ' × ' + f2(p.length), unit: 'mm', key: true },
    { id: 'depth', label: 'Depth', value: f2(p.depth), unit: 'mm' },
    { id: 'levels', label: 'Levels', value: String(s.levels) + ' × ' + f2(p.depth / s.levels), unit: 'mm' },
    { id: 'loops', label: 'Loops per level', value: String(s.loops) },
    { id: 'entry', label: 'Way in', value: ENTRY[g.entry] + (g.entry === 'helix' ? ' Ø' + f2(2 * g.plan.rh + p.toolDia) : '') },
    { id: 'corner', label: round ? 'Stepover' : 'Corners', value: round ? f2(s.step) : 'R' + f2(Math.max(p.cornerR, p.toolDia / 2)), unit: 'mm' },
    { id: 'volume', label: 'Metal removed', value: s.volume.toFixed(1), unit: 'cm³' },
    { id: 'feed', label: 'Feed', value: String(p.feed), unit: 'mm/min' },
    { id: 'rpm', label: 'Spindle', value: String(p.rpm), unit: 'rpm' },
    { id: 'time', label: 'Estimated run time', value: duration(s.minutes), pressed: timeShown, controls: 'timecalc' }
  ];
}

const setup = (
  <>
    <ol>
      <li>Clamp the part clear of the pocket. If it goes right through, put a spoil board under it.</li>
      <li>Set X and Y zero so the pocket centre lands where &ldquo;Centre X / Y&rdquo; says: zero on the centre, or on a corner of the part and give the centre from there.</li>
      <li>Set Z zero to match &ldquo;Top of part&rdquo;, with the end of the cutter as the length reference.</li>
      <li>Helix and ramp entries are gentle on the cutter. Plunging straight down needs a centre-cutting end mill.</li>
      <li>Run it in air first with Z zero raised. Measure the pocket after the finish pass and adjust the cutter diameter setting if it comes out off size.</li>
    </ol>
    <p>Each level starts in the middle and works out in loops to the wall, leaving the allowance. The finish pass then goes once round the wall at full depth, climb milling unless you choose conventional.</p>
  </>
);

export default function App() {
  return (
    <ToolPage op={POCKET} params={params} id="pocket" shapeKey="shape"
      heading={(values, edit) => (
        <>
          <select name="shape" className="title-select" aria-label="Shape" title="Shape"
            value={values.shape} onChange={(e) => edit('shape', e.target.value)}>
            {Object.keys(POCKET.SHAPES).map((k) => <option key={k} value={k}>{POCKET.SHAPES[k]}</option>)}
          </select> G-code
        </>
      )}
      about="Clears a rectangular or round pocket: in at the middle by helix, ramp or plunge, out to the wall in loops, level by level, then a finish pass round the wall at full depth."
      setup={setup}
      fields={(ctx) => (
        <>
          <Section title="Pocket" names={['cx', 'cy', 'width', 'length', 'cornerR', 'angle', 'dia', 'depth', 'zTop', 'thickness']}>
            <Num name="width" label="Width (X)" unit="mm" shape="rect" min="0" step="1" />
            <Num name="length" label="Length (Y)" unit="mm" shape="rect" min="0" step="1" />
            <Num name="cornerR" label="Corner radius" unit="mm" shape="rect" min="0" step="0.5" />
            <Num name="angle" label="Turned by" unit="deg" shape="rect" step="5" />
            <Num name="dia" label="Diameter" unit="mm" shape="circle" min="0" step="1" />
            <Num name="depth" label="Depth" unit="mm" min="0" step="0.5" />
            <Num name="cx" label="Centre X" unit="mm" step="1" />
            <Num name="cy" label="Centre Y" unit="mm" step="1" />
            <Num name="zTop" label="Top of part" unit="Z mm" step="0.5" />
            <Num name="thickness" label="Part thickness" unit="mm, 0 = not given" min="0" step="1" />
          </Section>
          <Section title="Clearing" names={['stepdown', 'stepover', 'entry', 'rampAngle', 'allowance', 'finish', 'milling', 'retract', 'clearance']}>
            <Num name="stepdown" label="Depth per level" unit="mm" min="0" step="0.5" />
            <Num name="stepover" label="Stepover" unit="% of cutter" min="5" max="70" step="5" />
            <Sel name="entry" label="Way in" options={[['helix', 'Helix'], ['ramp', 'Ramp along the middle'], ['plunge', 'Plunge']]} />
            <Num name="rampAngle" label="Helix / ramp angle" unit="deg" min="0.5" max="30" step="0.5" />
            <Check name="finish">Finish pass round the wall</Check>
            <Num name="allowance" label="Left for the finish pass" unit="mm" min="0" step="0.05" />
            <Sel name="milling" label="Milling" options={[['climb', 'Climb'], ['conventional', 'Conventional']]} />
            <Num name="retract" label="Start height above top" unit="mm" min="0" step="0.5" />
            <Num name="clearance" label="Clearance above top" unit="mm" min="0" step="1" />
            <p className="hint">2 to 3° suits steel, up to 5 to 8° aluminium. When there is no room for the way in chosen, the next best is used and the warnings say so.</p>
          </Section>
          <CutterSection ctx={ctx} />
          <ProgramSection />
        </>
      )}
      tiles={tiles}
      sectionCaption="Section through the pocket centre along X, cut as deep as it is so far"
      timeRows={[['entry', 'Helix or ramp in'], ['rough', 'Clearing loops'], ['finish', 'Finish pass'], ['move', 'Lifts and moves at feed']]}
    />
  );
}
