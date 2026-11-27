import BORE from './lib/bore.js';
import ToolPage from '../../shared/toolpath/ToolPage.jsx';
import { makeParams } from '../../shared/toolpath/params.js';
import { CutterSection, ProgramSection } from '../../shared/toolpath/fields.jsx';
import { Num, Sel, Check, Text, Section } from '../../shared/components/tool/Fields.jsx';
import { duration } from '../../shared/components/tool/Tiles.jsx';

const params = makeParams(BORE.DEFAULTS, 'bore-settings');
const f2 = (v) => (Math.round(v * 100) / 100).toString();

function tiles(r, timeShown) {
  const p = r.params, g = r.geom, s = r.stats;
  return [
    { id: 'dia', label: 'Hole diameter', value: 'Ø' + f2(p.holeDia), unit: 'mm', key: true },
    { id: 'depth', label: 'Depth', value: f2(p.depth), unit: 'mm' },
    { id: 'holes', label: 'Holes', value: String(s.holes) },
    { id: 'helix', label: 'Helix down', value: g.plunge ? 'Plunge' : g.turns + ' turns, ' + f2(g.rampAngle) + '°' },
    { id: 'finish', label: 'Finish helix up', value: g.fTurns ? g.fTurns + ' turns' : 'None' },
    { id: 'core', label: 'Core left', value: g.core > 0.05 ? 'Ø' + f2(2 * g.core) : 'None', unit: g.core > 0.05 ? 'mm' : '' },
    { id: 'feed', label: 'Feed', value: String(p.feed), unit: 'mm/min' },
    { id: 'rpm', label: 'Spindle', value: String(p.rpm), unit: 'rpm' },
    { id: 'path', label: 'Helix radius', value: f2(g.Rr) + (g.fTurns ? ' / ' + f2(g.Rf) : ''), unit: 'mm' },
    { id: 'time', label: 'Estimated run time', value: duration(s.minutes), pressed: timeShown, controls: 'timecalc' }
  ];
}

const setup = (
  <>
    <ol>
      <li>Clamp the part clear of the holes, with a spoil board under it if they go through.</li>
      <li>Set X and Y zero so the hole centres listed land where they should. For one hole at 0,0, indicate the hole or boss and zero on its centre.</li>
      <li>Set Z zero to match &ldquo;Top of part&rdquo;, with the end of the cutter as the length reference.</li>
      <li>Measure the cutter&rsquo;s real diameter and enter it: the hole comes out as big as the cutter is off.</li>
      <li>Bore the first hole, measure it, then adjust the cutter diameter setting by half the error on the diameter (or the allowance) before the rest.</li>
    </ol>
    <p>The cutter helixes down close to the wall, leaving the allowance, makes one flat turn at the bottom, then steps out to the wall and helixes back up as the finish pass. A hole up to about twice the cutter&rsquo;s diameter comes out clean; bigger ones leave a core in the middle.</p>
  </>
);

export default function App() {
  return (
    <ToolPage op={BORE} params={params} id="bore"
      heading={() => <>Helical boring G-code</>}
      about="Mills round holes to size with an end mill: a helix down near the wall, a flat turn at the bottom, then a finish helix back up on the wall. One hole or several."
      setup={setup}
      fields={(ctx) => (
        <>
          <Section title="Holes" names={['centres', 'holeDia', 'depth', 'zTop', 'thickness']}>
            <Num name="holeDia" label="Hole diameter" unit="mm" min="0" step="0.5" />
            <Num name="depth" label="Depth" unit="mm" min="0" step="0.5" />
            <Text name="centres" label="Hole centres (x,y; x,y ...)" placeholder="0,0" />
            <Num name="zTop" label="Top of part" unit="Z mm" step="0.5" />
            <Num name="thickness" label="Part thickness" unit="mm, 0 = not given" min="0" step="1" />
            <p className="hint">The holes are bored in the order listed.</p>
          </Section>
          <Section title="Helix" names={['pitch', 'finish', 'allowance', 'finishPitch', 'milling', 'retract', 'clearance']}>
            <Num name="pitch" label="Down per turn" unit="mm" min="0" step="0.1" />
            <Check name="finish">Finish helix up the wall</Check>
            <Num name="allowance" label="Left for the finish pass" unit="mm" min="0" step="0.05" />
            <Num name="finishPitch" label="Up per finish turn" unit="mm" min="0" step="0.1" />
            <Sel name="milling" label="Milling" options={[['climb', 'Climb (anticlockwise)'], ['conventional', 'Conventional (clockwise)']]} />
            <Num name="retract" label="Start height above top" unit="mm" min="0" step="0.5" />
            <Num name="clearance" label="Clearance above top" unit="mm" min="0" step="1" />
            <p className="hint">The Helix down tile shows the angle this gives: 2 to 5° suits most work.</p>
          </Section>
          <CutterSection ctx={ctx} />
          <ProgramSection />
        </>
      )}
      tiles={tiles}
      sectionCaption="Section through hole 1 along X, cut as deep as it is so far"
      timeRows={[['rough', 'Helix down'], ['finish', 'Finish helix up'], ['move', 'Moves at feed']]}
    />
  );
}
