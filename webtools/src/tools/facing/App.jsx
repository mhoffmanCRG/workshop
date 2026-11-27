import FACING from './lib/facing.js';
import ToolPage from '../../shared/toolpath/ToolPage.jsx';
import { makeParams } from '../../shared/toolpath/params.js';
import { CutterSection, ProgramSection } from '../../shared/toolpath/fields.jsx';
import { Num, Sel, Section } from '../../shared/components/tool/Fields.jsx';
import { duration } from '../../shared/components/tool/Tiles.jsx';

const params = makeParams(FACING.DEFAULTS, 'facing-settings');
const f2 = (v) => (Math.round(v * 100) / 100).toString();

function tiles(r, timeShown) {
  const p = r.params, g = r.geom, s = r.stats;
  return [
    { id: 'area', label: 'Area faced', value: f2(p.x1 - p.x0) + ' × ' + f2(p.y1 - p.y0), unit: 'mm', key: true },
    { id: 'depth', label: 'Taken off', value: f2(p.depth), unit: 'mm' },
    { id: 'face', label: 'Faced to', value: 'Z' + f2(g.zFinal) },
    { id: 'levels', label: 'Levels', value: String(s.levels) },
    { id: 'stepover', label: 'Passes per level', value: String(s.passes) + (s.passes > 1 ? ', ' + f2(s.pitch) + ' apart' : '') },
    { id: 'volume', label: 'Metal removed', value: s.volume.toFixed(1), unit: 'cm³' },
    { id: 'feed', label: 'Feed', value: String(p.feed), unit: 'mm/min' },
    { id: 'rpm', label: 'Spindle', value: String(p.rpm), unit: 'rpm' },
    { id: 'path', label: 'Cutting distance', value: Math.round((s.dist.rough || 0) + (s.dist.finish || 0)).toLocaleString(), unit: 'mm' },
    { id: 'time', label: 'Estimated run time', value: duration(s.minutes), pressed: timeShown, controls: 'timecalc' }
  ];
}

const setup = (
  <>
    <ol>
      <li>Hold the stock low in the vise or clamped flat, with nothing standing above its top within the cutter&rsquo;s reach plus the run-past distance.</li>
      <li>Set X and Y zero so the stock lies within &ldquo;X from / to&rdquo; and &ldquo;Y from / to&rdquo;: zero on the front left corner and give the stock size, for example.</li>
      <li>Touch the cutter on the highest point of the stock and set Z zero to &ldquo;Top of stock&rdquo;.</li>
      <li>Run it in air first with Z zero raised, then take a first light skim to see how much comes off.</li>
    </ol>
    <p>Zig-zag cuts both ways and is quickest. One way climbs every pass and goes back over the stock between them, which leaves a more even finish on a light machine.</p>
  </>
);

export default function App() {
  return (
    <ToolPage op={FACING} params={params} id="facing" shapeKey="pattern"
      heading={(values, edit) => (
        <>
          <select name="pattern" className="title-select" aria-label="Pattern" title="Pattern"
            value={values.pattern} onChange={(e) => edit('pattern', e.target.value)}>
            {Object.keys(FACING.PATTERNS).map((k) => <option key={k} value={k}>{FACING.PATTERNS[k]}</option>)}
          </select> G-code
        </>
      )}
      about="Faces the top of a block flat: passes side by side across the stock, running past both ends, in depth steps with a light finishing pass at the end."
      setup={setup}
      fields={(ctx) => (
        <>
          <Section title="Stock" names={['x0', 'x1', 'y0', 'y1', 'zTop', 'thickness']}>
            <Num name="x0" label="X from" unit="mm" step="1" />
            <Num name="x1" label="X to" unit="mm" step="1" />
            <Num name="y0" label="Y from" unit="mm" step="1" />
            <Num name="y1" label="Y to" unit="mm" step="1" />
            <Num name="zTop" label="Top of stock" unit="Z mm" step="0.5" />
            <Num name="thickness" label="Stock thickness" unit="mm, 0 = not given" min="0" step="1" />
          </Section>
          <Section title="Cut" names={['depth', 'stepdown', 'finishDepth', 'stepover', 'along', 'overrun', 'clearance']}>
            <Num name="depth" label="Depth to take off" unit="mm" min="0" step="0.1" />
            <Num name="stepdown" label="Depth per pass" unit="mm" min="0" step="0.1" />
            <Num name="finishDepth" label="Finishing pass" unit="mm, 0 = none" min="0" step="0.05" />
            <Num name="stepover" label="Stepover" unit="% of cutter" min="5" max="95" step="5" />
            <Sel name="along" label="Passes run along" options={[['x', 'X'], ['y', 'Y']]} />
            <Num name="overrun" label="Run past the edge" unit="mm" min="0" step="1" />
            <Num name="clearance" label="Clearance above top" unit="mm" min="0" step="1" />
            <p className="hint">The outer passes hang a little over the edges, so the edges come out clean. Each pass starts and ends clear of the stock, and the step to the next pass happens out there too.</p>
          </Section>
          <CutterSection ctx={ctx} toolLabel="Cutter diameter" />
          <ProgramSection />
        </>
      )}
      tiles={tiles}
      sectionCaption="Section across the passes, with the depth levels"
      timeRows={[['rough', 'Roughing passes'], ['finish', 'Finishing pass'], ['move', 'Step-overs and plunges']]}
    />
  );
}
