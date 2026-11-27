import PROFILE from './lib/profile.js';
import ToolPage from '../../shared/toolpath/ToolPage.jsx';
import { makeParams } from '../../shared/toolpath/params.js';
import { CutterSection, ProgramSection } from '../../shared/toolpath/fields.jsx';
import { Num, Sel, Check, Section } from '../../shared/components/tool/Fields.jsx';
import { duration } from '../../shared/components/tool/Tiles.jsx';

const params = makeParams(PROFILE.DEFAULTS, 'profile-settings');
const f2 = (v) => (Math.round(v * 100) / 100).toString();

function tiles(r, timeShown) {
  const p = r.params, g = r.geom, s = r.stats, round = p.shape === 'circle';
  return [
    { id: 'size', label: (p.side === 'inside' ? 'Opening' : 'Part') + (round ? ' diameter' : ' size'), value: round ? 'Ø' + f2(p.dia) : f2(p.width) + ' × ' + f2(p.length), unit: 'mm', key: true },
    { id: 'depth', label: 'Depth', value: f2(p.depth), unit: 'mm' },
    { id: 'levels', label: 'Levels', value: String(s.levels) + ' × ' + f2(p.depth / s.levels), unit: 'mm' },
    { id: 'tabs', label: 'Tabs', value: p.tabs > 0 ? g.tabs + ' × ' + f2(p.tabWidth) + ' wide' : 'None' },
    { id: 'path', label: 'Contour length', value: f2(s.length), unit: 'mm' },
    { id: 'side', label: 'Cutter runs', value: (p.side === 'inside' ? 'Inside' : 'Outside') + ', ' + (p.milling === 'conventional' ? 'conv.' : 'climb') },
    { id: 'feed', label: 'Feed', value: String(p.feed), unit: 'mm/min' },
    { id: 'rpm', label: 'Spindle', value: String(p.rpm), unit: 'rpm' },
    { id: 'through', label: 'Cuts through', value: p.thickness > 0 ? (g.through ? 'Yes' : 'No') : '–' },
    { id: 'time', label: 'Estimated run time', value: duration(s.minutes), pressed: timeShown, controls: 'timecalc' }
  ];
}

const setup = (
  <>
    <ol>
      <li>Clamp the stock so the clamps are clear of the cutter&rsquo;s path all the way round, with a spoil board underneath when cutting right through.</li>
      <li>Set X and Y zero so the shape&rsquo;s centre lands at &ldquo;Centre X / Y&rdquo;.</li>
      <li>Set Z zero to match &ldquo;Top of part&rdquo;. To cut through, make the depth the part thickness plus 0.2 to 0.5 mm.</li>
      <li>With tabs, the part stays joined to the stock at the end. Cut the tabs with a saw or chisel and file them flush.</li>
      <li>Run it in air first with Z zero raised. Measure after the finish pass and adjust the cutter diameter setting if the size is off.</li>
    </ol>
    <p>The cutter goes down a little at a time as it travels round the contour, so it never plunges. Climb milling (the default) goes clockwise round the outside and anticlockwise round the inside, and leaves the better finish.</p>
  </>
);

export default function App() {
  return (
    <ToolPage op={PROFILE} params={params} id="profile" shapeKey="shape"
      heading={(values, edit) => (
        <>
          <select name="shape" className="title-select" aria-label="Shape" title="Shape"
            value={values.shape} onChange={(e) => edit('shape', e.target.value)}>
            {Object.keys(PROFILE.SHAPES).map((k) => <option key={k} value={k}>{PROFILE.SHAPES[k]}</option>)}
          </select> G-code
        </>
      )}
      about="Cuts round the outside of a rectangle or circle (to cut a part out), or round the inside (to cut an opening), in depth steps with tabs to hold the part, and a finish pass at full depth."
      setup={setup}
      fields={(ctx) => (
        <>
          <Section title="Shape" names={['side', 'cx', 'cy', 'width', 'length', 'cornerR', 'angle', 'dia', 'depth', 'zTop', 'thickness']}>
            <Sel name="side" label="Cut round the" options={[['outside', 'Outside (a part)'], ['inside', 'Inside (an opening)']]} />
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
            <p className="hint">The sizes are the finished part (or opening). The cutter runs offset by its radius, outside or inside the line.</p>
          </Section>
          <Section title="Cutting" names={['stepdown', 'entry', 'rampAngle', 'finish', 'allowance', 'milling', 'retract', 'clearance']}>
            <Num name="stepdown" label="Depth per level" unit="mm" min="0" step="0.5" />
            <Sel name="entry" label="Going down" options={[['ramp', 'Ramp along the contour'], ['plunge', 'Plunge']]} />
            <Num name="rampAngle" label="Ramp angle" unit="deg" min="0.5" max="30" step="0.5" />
            <Check name="finish">Finish pass at full depth</Check>
            <Num name="allowance" label="Left for the finish pass" unit="mm" min="0" step="0.05" />
            <Sel name="milling" label="Milling" options={[['climb', 'Climb'], ['conventional', 'Conventional']]} />
            <Num name="retract" label="Start height above top" unit="mm" min="0" step="0.5" />
            <Num name="clearance" label="Clearance above top" unit="mm" min="0" step="1" />
          </Section>
          <Section title="Tabs" names={['tabs', 'tabWidth', 'tabHeight']}>
            <Num name="tabs" label="Number of tabs" unit="0 = none" min="0" max="24" step="1" />
            <Num name="tabWidth" label="Tab width" unit="mm" min="0" step="0.5" />
            <Num name="tabHeight" label="Tab height" unit="mm above the bottom" min="0" step="0.1" />
            <p className="hint">Tabs are spaced evenly round the contour. Over each one the cutter lifts to the tab height on the levels below it, and again on the finish pass.</p>
          </Section>
          <CutterSection ctx={ctx} />
          <ProgramSection />
        </>
      )}
      tiles={tiles}
      sectionCaption="Section through the centre along X: the cut either side of the part, as deep as it is so far"
      timeRows={[['rough', 'Levels round the contour'], ['finish', 'Finish pass'], ['move', 'Moves at feed']]}
    />
  );
}
