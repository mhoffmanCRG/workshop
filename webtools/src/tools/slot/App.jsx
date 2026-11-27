import SLOT from './lib/slot.js';
import ToolPage from '../../shared/toolpath/ToolPage.jsx';
import { makeParams } from '../../shared/toolpath/params.js';
import { CutterSection, ProgramSection } from '../../shared/toolpath/fields.jsx';
import { Num, Sel, Check, Section } from '../../shared/components/tool/Fields.jsx';
import { duration } from '../../shared/components/tool/Tiles.jsx';

const params = makeParams(SLOT.DEFAULTS, 'slot-settings');
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const ENTRY = { helix: 'Helix', ramp: 'Ramp', plunge: 'Plunge' };

function tiles(r, timeShown) {
  const p = r.params, g = r.geom, s = r.stats;
  return [
    { id: 'width', label: 'Slot width', value: f2(p.width), unit: 'mm', key: true },
    { id: 'length', label: 'Between end centres', value: f2(g.L), unit: 'mm' },
    { id: 'overall', label: 'Overall length', value: f2(g.L + p.width), unit: 'mm' },
    { id: 'depth', label: 'Depth', value: f2(p.depth), unit: 'mm' },
    { id: 'levels', label: 'Levels', value: String(s.levels) + ' × ' + f2(p.depth / s.levels), unit: 'mm' },
    { id: 'entry', label: 'Way in', value: ENTRY[g.plan.entry] + (g.exact ? ', full width' : '') },
    { id: 'angle', label: 'Direction', value: f2(g.rot * 180 / Math.PI) + '°' },
    { id: 'feed', label: 'Feed', value: String(p.feed), unit: 'mm/min' },
    { id: 'rpm', label: 'Spindle', value: String(p.rpm), unit: 'rpm' },
    { id: 'time', label: 'Estimated run time', value: duration(s.minutes), pressed: timeShown, controls: 'timecalc' }
  ];
}

const setup = (
  <>
    <ol>
      <li>Clamp the part clear of the slot. If it goes right through, put a spoil board under it.</li>
      <li>Set X and Y zero so the end centres land where &ldquo;First end&rdquo; and the second end (or the length and angle) say.</li>
      <li>Set Z zero to match &ldquo;Top of part&rdquo;, with the end of the cutter as the length reference.</li>
      <li>For a true width, use a cutter a little narrower than the slot and keep the finish pass: a cutter the slot&rsquo;s width cuts it a touch wide and with a rougher wall.</li>
      <li>Run it in air first with Z zero raised.</li>
    </ol>
    <p>The cutter ramps down back and forth along the middle of the slot, so it never plunges. A wider slot is then opened out in loops and finished round the wall at full depth.</p>
  </>
);

export default function App() {
  return (
    <ToolPage op={SLOT} params={params} id="slot" shapeKey="ends"
      heading={(values, edit) => (
        <>
          <select name="ends" className="title-select" aria-label="Slot given by" title="Slot given by"
            value={values.ends} onChange={(e) => edit('ends', e.target.value)}>
            {Object.keys(SLOT.ENDS).map((k) => <option key={k} value={k}>{SLOT.ENDS[k]}</option>)}
          </select>
        </>
      )}
      about="Cuts a straight slot with round ends at any angle: ramping along it level by level, opened out in loops when it is wider than the cutter, and finished round the wall."
      setup={setup}
      fields={(ctx) => (
        <>
          <Section title="Slot" names={['x1', 'y1', 'x2', 'y2', 'length', 'angle', 'width', 'depth', 'zTop', 'thickness']}>
            <Num name="width" label="Width" unit="mm" min="0" step="0.5" />
            <Num name="depth" label="Depth" unit="mm" min="0" step="0.5" />
            <Num name="x1" label="First end centre X" unit="mm" step="1" />
            <Num name="y1" label="First end centre Y" unit="mm" step="1" />
            <Num name="x2" label="Second end centre X" unit="mm" shape="points" step="1" />
            <Num name="y2" label="Second end centre Y" unit="mm" shape="points" step="1" />
            <Num name="length" label="Length between end centres" unit="mm" shape="length" min="0" step="1" />
            <Num name="angle" label="Direction" unit="deg from +X" shape="length" step="5" />
            <Num name="zTop" label="Top of part" unit="Z mm" step="0.5" />
            <Num name="thickness" label="Part thickness" unit="mm, 0 = not given" min="0" step="1" />
            <p className="hint">The overall length is the distance between the end centres plus the width.</p>
          </Section>
          <Section title="Cutting" names={['stepdown', 'entry', 'rampAngle', 'stepover', 'finish', 'allowance', 'milling', 'retract', 'clearance']}>
            <Num name="stepdown" label="Depth per level" unit="mm" min="0" step="0.25" />
            <Sel name="entry" label="Way in" options={[['ramp', 'Ramp along the slot'], ['helix', 'Helix'], ['plunge', 'Plunge']]} />
            <Num name="rampAngle" label="Ramp angle" unit="deg" min="0.5" max="30" step="0.5" />
            <Num name="stepover" label="Stepover (wide slots)" unit="% of cutter" min="5" max="70" step="5" />
            <Check name="finish">Finish pass round the wall</Check>
            <Num name="allowance" label="Left for the finish pass" unit="mm" min="0" step="0.05" />
            <Sel name="milling" label="Milling" options={[['climb', 'Climb'], ['conventional', 'Conventional']]} />
            <Num name="retract" label="Start height above top" unit="mm" min="0" step="0.5" />
            <Num name="clearance" label="Clearance above top" unit="mm" min="0" step="1" />
          </Section>
          <CutterSection ctx={ctx} />
          <ProgramSection />
        </>
      )}
      tiles={tiles}
      sectionCaption="Section across the middle of the slot, cut as deep as it is so far"
      timeRows={[['entry', 'Ramping down'], ['rough', 'Along the slot and loops'], ['finish', 'Finish pass'], ['move', 'Lifts and moves at feed']]}
    />
  );
}
