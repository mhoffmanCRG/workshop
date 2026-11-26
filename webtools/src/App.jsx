import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HTD from './lib/htd.js';
import { createEngine, IDLE_INFO } from './lib/engine.js';
import {
  STORE_KEY, initialValues, toParams, toValues, toInput, defaultFor, defaultFileName, profileOf,
  loadItem, storeItem, loadJSON
} from './lib/params.js';
import { FormContext, Num, Sel, Check, Section } from './components/Fields.jsx';
import SetupDialog from './components/SetupDialog.jsx';
import Messages from './components/Messages.jsx';
import Tiles from './components/Tiles.jsx';
import TimeCalc from './components/TimeCalc.jsx';
import MachinePanel, { linuxcncHandler } from './components/MachinePanel.jsx';

const TIME_KEY = 'htd5m-show-time';
const SHOW_KEY = 'htd5m-show';
const SIDE_KEY = 'htd5m-side-collapsed';

const PROFILE_OPTIONS = ['3M', '5M', '8M', '14M', 'GT2', 'T2.5', 'T5', 'T10'].map((k) => [k, HTD.PROFILES[k] ? HTD.PROFILES[k].label : k]);

function initialShown() {
  const saved = loadJSON(SHOW_KEY, {}) || {}, out = {};
  ['path', 'cutter', 'chuck', 'zero'].forEach((k) => { out[k] = typeof saved[k] === 'boolean' ? saved[k] : true; });
  return out;
}

function feedInfo(r) {
  if (!r || !r.gcode) return '';
  const st = r.stats, pr = r.params;
  return (pr.feedAuto ? st.materialLabel + ': ' + st.materialChip.toFixed(3) + ' mm per tooth gives ' + pr.feed + ' mm/min at ' + pr.rpm + ' rpm. '
    : 'Tooth load at the cutting feed: ' + st.toothLoad.toFixed(4) + ' mm per tooth (typical for ' + st.materialLabel.toLowerCase() + ': ' + st.materialChip.toFixed(3) + '). ') +
    (pr.adaptFeed ? 'This job feeds between ' + st.feedLow + ' and ' + st.feedHigh + ' mm/min. ' : 'Every pass feeds at ' + st.feedLow + ' mm/min. ') +
    'A usual spindle speed for this cutter in ' + st.materialLabel.toLowerCase() + ' is about ' + (Math.round(st.suggestedRpm / 100) * 100).toLocaleString() + ' rpm.';
}

export default function App() {
  const [values, setValues] = useState(initialValues);
  const valuesRef = useRef(values);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(null);
  const [timeHidden, setTimeHidden] = useState(() => loadItem(TIME_KEY, '0') !== '1');
  const [shown, setShown] = useState(initialShown);
  const [sideCollapsed, setSideCollapsed] = useState(() => loadItem(SIDE_KEY, '0') === '1');
  const [playState, setPlayState] = useState({ on: false, active: false });
  const [fileName, setFileName] = useState('');
  const [copyLabel, setCopyLabel] = useState('Copy');
  const [view3dOk, setView3dOk] = useState(true);
  const hasMachine = useMemo(() => !!linuxcncHandler(), []);

  const engineRef = useRef(null);
  const refreshRef = useRef(() => {});      // set by the LinuxCNC panel
  const fileNameEdited = useRef(false);
  const lastGood = useRef(null);
  const timer = useRef(null);
  const flashTime = useRef(false);
  const el = {
    view3d: useRef(null), pulley: useRef(null), groove: useRef(null), gcode: useRef(null),
    lineMark: useRef(null), scrub: useRef(null), playInfo: useRef(null)
  };
  const timePanel = useRef(null);
  const setupDialog = useRef(null);

  const commit = useCallback((next) => { valuesRef.current = next; setValues(next); }, []);

  // ------------------------------------------------------------ generate
  const update = useCallback(() => {
    clearTimeout(timer.current);
    const e = engineRef.current;
    if (!e) return;
    const p = toParams(valuesRef.current);
    storeItem(STORE_KEY, JSON.stringify(p));
    e.stopPlayback();
    const r = HTD.generate(p);
    const ok = !r.errors.length;
    // while the feeds come from the material, show the worked-out values in their boxes (which are locked)
    if (r.params.feedAuto) {
      const next = { ...valuesRef.current };
      let changed = false;
      ['feed', 'plunge'].forEach((n) => {
        if (isFinite(r.params[n]) && next[n] !== String(r.params[n])) { next[n] = String(r.params[n]); changed = true; }
      });
      if (changed) commit(next);
    }
    e.setResult(r);
    if (ok) {
      lastGood.current = r;
      if (!fileNameEdited.current) setFileName(defaultFileName(r.params));
    } else {
      // The tiles are gone while there is an error, so a bad time-calculator value must stay reachable.
      const q = r.params;
      if (!(q.feedOverride > 0 && q.rapidRate > 0 && q.rotaryRapid > 0 && Number.isInteger(q.quantity) && q.quantity >= 1)) setTimeHidden(false);
    }
    setResult(r);
    refreshRef.current();
  }, [commit]);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(update, 120);
  }, [update]);

  const edit = useCallback((name, value) => {
    const next = { ...valuesRef.current, [name]: value };
    // picking the head's side points the stock at it, so the start face is the free end
    if (name === 'headSide') next.stockDir = value === 'left' ? '-1' : '1';
    // a different belt, or a different groove form of a T belt, brings its own groove and a cutter that fits it
    if (name === 'profile' || name === 'grooveForm') HTD.PROFILE_FIELDS.forEach((k) => { next[k] = toInput(k, defaultFor(k, next)); });
    commit(next);
    schedule();
  }, [commit, schedule]);

  const setDefaults = useCallback((names) => {
    const next = { ...valuesRef.current };
    names.forEach((n) => { const v = defaultFor(n, next); if (v !== undefined) next[n] = toInput(n, v); });
    commit(next);
    update();
  }, [commit, update]);

  // ------------------------------------------------------------ engine
  useEffect(() => {
    const e = createEngine({
      view3d: el.view3d.current, pulley: el.pulley.current, groove: el.groove.current, gcode: el.gcode.current,
      lineMark: el.lineMark.current, scrub: el.scrub.current, playInfo: el.playInfo.current
    }, setPlayState);
    engineRef.current = e;
    Object.keys(shown).forEach((k) => { e.view3d.show[k] = shown[k]; });
    e.showZero = shown.zero;
    setView3dOk(e.view3d.supported);
    update();
    return () => { clearTimeout(timer.current); e.dispose(); engineRef.current = null; };
    // created once; later changes go through the handlers below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const profile = profileOf(values);
  useEffect(() => { document.title = profile.label + ' Pulley G-code'; }, [profile.label]);

  // Fold the settings column away to give the views more room; remembered between page loads.
  const firstSide = useRef(true);
  const toggleRef = useRef(null);
  useEffect(() => {
    const first = firstSide.current;
    firstSide.current = false;
    if (!first) {
      storeItem(SIDE_KEY, sideCollapsed ? '1' : '0');
      toggleRef.current?.focus();      // the toggle moved, so keep keyboard focus on it
    }
    if (!first || sideCollapsed) window.dispatchEvent(new Event('resize'));   // the drawings size themselves to their boxes
  }, [sideCollapsed]);

  // The run-time tile opened the time calculator: bring it into view.
  useEffect(() => {
    if (timeHidden || !flashTime.current) return;
    flashTime.current = false;
    const panel = timePanel.current;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    panel.classList.remove('flash'); void panel.offsetWidth; panel.classList.add('flash');
  }, [timeHidden]);

  const ok = !!(result && !result.errors.length);

  function onTile(id) {
    const e = engineRef.current;
    if (!ok || !e) return;
    if (id === 'time') {
      const hide = !timeHidden;
      setTimeHidden(hide);
      storeItem(TIME_KEY, hide ? '0' : '1');
      if (!hide) flashTime.current = true;
      return;
    }
    const s = selected === id ? null : id;
    setSelected(s);
    e.selected = s;
    e.redraw2d();
  }

  function onShow(key, checked) {
    const e = engineRef.current, next = { ...shown, [key]: checked };
    setShown(next);
    storeItem(SHOW_KEY, JSON.stringify(next));
    if (!e) return;
    e.view3d.show[key] = checked;
    e.view3d.draw();
    if (key === 'zero') { e.showZero = checked; if (ok) e.redraw2d(); }
  }

  function currentFileName() { return fileName.trim() || defaultFileName(result.params); }

  function download() {
    if (!ok) return;
    const url = URL.createObjectURL(new Blob([result.gcode], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = currentFileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function copy() {
    if (!ok) return;
    const done = (good) => { setCopyLabel(good ? 'Copied' : 'Copy failed'); setTimeout(() => setCopyLabel('Copy'), 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(result.gcode).then(() => done(true), () => done(false));
    } else {
      el.gcode.current.select();
      done(document.execCommand('copy'));
    }
  }

  function resetAll() {
    commit(toValues(HTD.DEFAULTS));
    fileNameEdited.current = false;
    update();
  }

  function openSetup() {
    const d = setupDialog.current;
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }

  // "Left" and "right" only fit a rotary lying along X; along Y the head is at the front or the back.
  const alongY = values.rotaryParallel === 'Y';
  const headSides = [
    ['left', alongY ? 'Front (Y− end)' : 'Left (X− end)'],
    ['right', alongY ? 'Back (Y+ end)' : 'Right (X+ end)']
  ];
  const feedLocked = !!(result && result.params.feedAuto);
  // Open, the toggle sits in the settings title bar; collapsed, the settings leave the layout
  // altogether and the toggle floats over the top-left corner of the 3D view.
  const sideToggle = (
    <button type="button" ref={toggleRef} className={'side-toggle' + (sideCollapsed ? ' floating' : '')}
      aria-expanded={!sideCollapsed} title={sideCollapsed ? 'Show the settings' : 'Hide the settings'}
      onClick={() => setSideCollapsed(!sideCollapsed)}>
      {sideCollapsed ? '›' : '‹'}
    </button>
  );
  const form = { values, edit, setDefaults, shape: profile.shape };

  return (
    <FormContext.Provider value={form}>
      <SetupDialog ref={setupDialog} />

      <main className={'layout' + (sideCollapsed ? ' side-collapsed' : '')}>
        <div className="side">
          <header className="top">
            {!sideCollapsed && sideToggle}
            <h1 aria-describedby="about">
              <select name="profile" className="title-select" aria-label="Belt profile" title="Belt profile"
                value={values.profile} onChange={(e) => edit('profile', e.target.value)}>
                {PROFILE_OPTIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select> pulley G-code
            </h1>
            <p id="about" role="tooltip">Cuts the belt grooves on a 4th-axis mill with a ball-nose cutter. Stock must already be turned to the outside diameter shown.</p>
            <nav className="menu" aria-label="Help">
              <button type="button" className="menu-item" aria-haspopup="dialog" title="Setting up the job" onClick={openSetup}>Job setup</button>
            </nav>
          </header>

          <Messages result={result} />

          <form id="settings" className="settings" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            <Section title="Pulley" names={['teeth', 'faceWidth']}>
              <Num name="teeth" label="Teeth" min="6" max="400" step="1" />
              <Num name="faceWidth" label="Face width" unit="mm" min="0" step="0.5" />
            </Section>

            <Section title="Groove profile" names={['grooveForm', 'grooveDepth', 'grooveWidth', 'grooveRadius', 'flankRadius', 'flankOffset', 'tipRadius', 'flankAngle', 'pld']}>
              <Sel name="grooveForm" label="Groove form" shape="trapezoid" options={[['SE', 'SE, up to 20 teeth'], ['N', 'N, over 20 teeth']]} />
              <Num name="grooveDepth" label="Groove depth" unit="mm" min="0" step="0.01" />
              <Num name="grooveWidth" label="Groove width at OD" unit="mm" shape="trapezoid" min="0" step="0.01" />
              <Num name="grooveRadius" label={profile.shape === 'trapezoid' ? 'Bottom corner radius' : 'Groove radius'} unit="mm" min="0" step="0.01" />
              <Num name="flankRadius" label="Flank radius" unit="mm" shape="gt" min="0" step="0.01" />
              <Num name="flankOffset" label="Flank centre offset" unit="mm" shape="gt" min="0" step="0.01" />
              <Num name="tipRadius" label="Tooth tip radius" unit="mm" min="0" step="0.01" />
              <Num name="flankAngle" label="Flank angle" unit="deg" shape="round trapezoid" min="0" max="30" step="0.5" />
              <Num name="pld" label={'Pitch dia − outside dia'} unit="mm" min="0" step="0.001" />
              <p className="hint">Nominal {profile.label} values, set when the belt is chosen in the title along with a cutter size and step-down that suit the groove. Check them against your belt or the supplier's drawing. A groove radius equal to the cutter radius cuts the groove bottom in one pass with no side clearance.</p>
            </Section>

            <Section title="Cutter" names={['toolDia', 'toolLength', 'material', 'rpm', 'feedAuto', 'feed', 'plunge', 'flutes', 'adaptFeed', 'feedMin', 'feedMax']}>
              <Num name="toolDia" label="Ball-nose diameter" unit="mm" min="0" step="0.1" />
              <Num name="toolLength" label="Length below holder" unit="mm" min="0" step="0.5" />
              <Sel name="material" label="Material" options={[['aluminium', 'Aluminium'], ['nylon', 'Nylon'], ['castiron', 'Cast iron']]} />
              <Num name="rpm" label="Spindle speed" unit="rpm" min="0" step="100" />
              <Check name="feedAuto">Set the feeds from the material</Check>
              <Num name="feed" label="Cutting feed" unit="mm/min" min="0" step="10" disabled={feedLocked} />
              <Num name="plunge" label="Plunge feed" unit="mm/min" min="0" step="10" disabled={feedLocked} />
              <Num name="flutes" label="Flutes" min="1" max="8" step="1" />
              <Check name="adaptFeed">Adjust feed to tooth load and cutter angle</Check>
              <Num name="feedMin" label="Lowest feed" unit="% of cutting feed" min="1" max="100" step="5" />
              <Num name="feedMax" label="Highest feed" unit="% of cutting feed" min="100" max="500" step="10" />
              <p className="hint">{feedInfo(ok ? result : lastGood.current)}</p>
              <p className="hint">With feeds set from the material, the cutting feed is a typical chip load per tooth for that material and cutter size, times the flutes and the spindle speed; untick it to enter your own. The cutting feed is for a full-depth cut on the side of the cutter. With adjustment on, a pass that only skims the metal is fed faster to keep the same chip thickness per tooth, and a pass that cuts low on the ball, where the cutter turns slowly, is fed slower. Tilting the cutter moves the cut up the ball, so tilted passes run faster.</p>
            </Section>

            <Section title="Cutting" names={['method', 'finishOnly', 'stepDown', 'finishAllow', 'scallop', 'pattern', 'order']}>
              <Sel name="method" label="Cutting method" options={[['centre', 'Centre slotting'], ['side', 'Side cutting']]} />
              <Check name="finishOnly">Side cutting: finishing passes only, no roughing</Check>
              <p className="hint">Centre slotting plunges an upright cutter down the middle of the groove, so the slow-moving tip does the roughing. Side cutting starts at one side with the part turned as far as it will go, then works down from alternate sides with the cutter leaning, so the shaft and the side of the ball do the cutting. It takes more passes. Near the groove bottom the cutter fits the groove too closely to lean much, so the lower part of the ball still cuts there. Tick &ldquo;finishing passes only&rdquo; when the grooves are already roughed out, for example to re-run the finish; the passes then come down the groove from both sides in turn.</p>
              <Num name="stepDown" label="Roughing step-down" unit="mm" min="0" step="0.05" />
              <Num name="finishAllow" label="Finish allowance" unit="mm" min="0" step="0.01" />
              <Num name="scallop" label="Scallop height" unit="mm" min="0" step="0.001" />
              <Sel name="pattern" label="Pass pattern" options={[['zigzag', 'Zigzag'], ['oneway', 'One way']]} />
              <Sel name="order" label="Order" options={[['tooth', 'Groove by groove'], ['split', 'Rough all, finish all'], ['pass', 'Pass by pass']]} />
              <p className="hint">Pass by pass makes each pass on every groove before the next one. The cutter keeps its lean for the whole pass, so the rotary only steps from groove to groove and never winds back. It turns the least with side cutting.</p>
            </Section>

            <Section title="Machine setup" names={['rotaryParallel', 'rotaryLetter', 'mode', 'edgeTilt', 'maxTilt', 'shaftIn', 'topSense', 'rotDir', 'zZero', 'clearance', 'headSide', 'faceStart', 'stockDir', 'leadIn', 'leadOut']}>
              <Sel name="rotaryParallel" label="Rotary axis lies along" options={[['X', 'X'], ['Y', 'Y']]} />
              <Sel name="rotaryLetter" label="Rotary axis letter" options={[['A', 'A'], ['B', 'B'], ['C', 'C']]} />
              <Sel name="mode" label="Profile positioning" options={[['Y', 'Cross-axis offset'], ['A', 'Rotary rotation']]} />
              <Check name="edgeTilt">Tilt the part so the side of the ball cuts the top edges</Check>
              <Num name="maxTilt" label="Tilt limit" unit="deg" min="0" max="180" step="5" />
              <Num name="shaftIn" label="Finish on the shaft" unit="% of max" min="0" max="100" step="5" />
              <Sel name="topSense" label="Rotary + turns stock top toward" options={[['1', 'Cross axis +'], ['-1', 'Cross axis −']]} />
              <p className="hint">With tilt on, each tooth-tip pass turns the part so the widest part of the ball does the cutting, not its slow-moving tip. The cutter works alongside the stock, so the part is never turned further than the cutter's length below the holder allows, keeping the holder 1 mm above the stock. &ldquo;Finish on the shaft&rdquo; then pushes the tilted cutter in along its own axis so its straight side does the finishing; 0 keeps the cut on the ball. To set the direction, jog the rotary positive and watch which way the top of the stock moves (cross axis is Y when the rotary lies along X). If it is wrong the cutter will be on the wrong side of the tooth.</p>
              <Sel name="rotDir" label="Index direction" options={[['1', 'Positive'], ['-1', 'Negative']]} />
              <Sel name="zZero" label="Z zero" options={[['axis', 'Rotary centreline'], ['top', 'Top of stock']]} />
              <p className="hint">Cross-axis offset keeps the rotary still while a groove is cut. Rotary rotation keeps the cross axis at 0 and turns the part to reach the flanks.</p>
              <Num name="clearance" label="Clearance above stock" unit="mm" min="0" step="1" />
              <Sel name="headSide" label="Rotary head is on the" options={headSides} />
              <Num name="faceStart" label="Start face position" unit="mm" step="0.5" />
              <Sel name="stockDir" label="Stock runs toward" options={[['1', 'Positive direction'], ['-1', 'Negative direction']]} />
              <p className="hint">Choosing the head&rsquo;s side also sets &ldquo;Stock runs toward&rdquo; so the start face is the free end of the stock; change it back if you zero on the face next to the head. The drawings look at the free end, and the 3D view shows the head as close as the cutter and holder allow.</p>
              <Num name="leadIn" label="Lead-in" unit="mm" min="0" step="0.5" />
              <Num name="leadOut" label="Lead-out" unit="mm" min="0" step="0.5" />
              <p className="hint">Lead-in and lead-out are how far the cutter centre travels past each face. Keep both at least the cutter radius so plunges happen in air. Shorten lead-out only if the groove must stop at a shoulder.</p>
            </Section>

            <Section title="Program" names={['wcs', 'dwell', 'toolChange', 'toolNumber', 'coolant', 'returnA']}>
              <Sel name="wcs" label="Work offset" options={[['', 'None'], ...['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map((w) => [w, w])]} />
              <Num name="dwell" label="Spindle start dwell" unit="s" min="0" step="0.5" />
              <Check name="toolChange">Tool change and length offset (T, M6, G43)</Check>
              <Num name="toolNumber" label="Tool number" min="1" max="99" step="1" />
              <Check name="coolant">Flood coolant (M8 / M9)</Check>
              <Check name="returnA">Return rotary to 0 at the end</Check>
            </Section>

            <button type="button" className="quiet" onClick={resetAll}>Set everything to default</button>
          </form>
        </div>

        <section className="results">
          <div className="views">
            <div className="tiles-block">
              <Tiles result={ok ? result : null} selected={selected} timeShown={!timeHidden} onSelect={onTile} />
              <p className="hint tiles-hint">Click a tile to show it on the drawings, or the run time tile to open the time calculator. Click it again to hide it.</p>
            </div>
            <figure className="view3d">
              {sideCollapsed && sideToggle}
              <div className="canvas-box"><canvas ref={el.view3d} /></div>
              <figcaption>
                <span>{view3dOk ? '3D preview. Drag to rotate, scroll to zoom, double-click to reset.'
                  : '3D preview needs WebGL, which is turned off or unavailable in this browser.'}</span>
                <label className="inline"><input type="checkbox" checked={shown.path} onChange={(e) => onShow('path', e.target.checked)} /> Toolpath for groove 1</label>
                <label className="inline"><input type="checkbox" checked={shown.cutter} onChange={(e) => onShow('cutter', e.target.checked)} /> Cutter</label>
                <label className="inline"><input type="checkbox" checked={shown.chuck} onChange={(e) => onShow('chuck', e.target.checked)} /> Chuck</label>
                <label className="inline"><input type="checkbox" checked={shown.zero} onChange={(e) => onShow('zero', e.target.checked)} /> Zero point</label>
              </figcaption>
            </figure>
            <figure className="view-pulley">
              <canvas ref={el.pulley} />
              <figcaption>Pulley seen from its free end, cutter to scale at the first groove</figcaption>
            </figure>
            <figure className="view-groove">
              <canvas ref={el.groove} />
              <figcaption>
                One groove:
                <span className="key key-ideal">target profile</span>
                <span className="key key-cut">as cut</span>
                <span className="key key-finish">finishing passes</span>
                <span className="key key-rough">roughing passes</span>
              </figcaption>
            </figure>
          </div>

          <div className="panel player">
            <button type="button" disabled={!ok} onClick={() => engineRef.current?.togglePlay()}>{playState.on ? 'Pause' : 'Play'}</button>
            <button type="button" className="quiet" disabled={!playState.active}
              onClick={() => { engineRef.current?.stopPlayback(); refreshRef.current(); }}>Stop</button>
            <label className="inline">Speed{' '}
              <select defaultValue="10" onChange={(e) => { if (engineRef.current) engineRef.current.speed = Number(e.target.value); }}>
                <option value="1">1&times;</option>
                <option value="10">10&times;</option>
                <option value="60">60&times;</option>
                <option value="300">300&times;</option>
                <option value="1000">1000&times;</option>
              </select>
            </label>
            <input type="range" ref={el.scrub} min="0" max="1000" step="1" defaultValue="0" disabled={!ok}
              aria-label="Position in the program" onChange={(e) => engineRef.current?.scrubTo(e.target.value)} />
            <output ref={el.playInfo} className="play-info">{IDLE_INFO}</output>
          </div>

          {hasMachine && <MachinePanel engineRef={engineRef} refreshRef={refreshRef} result={ok ? result : null} fileName={currentFileName} />}

          <TimeCalc ref={timePanel} result={ok ? result : null} hidden={timeHidden} />

          <div className="output">
            <div className="toolbar">
              <h2>G-code</h2>
              <input type="text" aria-label="File name" spellCheck={false} value={fileName}
                onChange={(e) => { setFileName(e.target.value); fileNameEdited.current = e.target.value.trim() !== ''; }} />
              <button type="button" disabled={!ok} onClick={download}>Download</button>
              <button type="button" className="quiet" disabled={!ok} onClick={copy}>{copyLabel}</button>
            </div>
            <div className="code-wrap">
              <textarea ref={el.gcode} readOnly spellCheck={false} wrap="off" value={ok ? result.gcode : ''}
                onScroll={() => { const e = engineRef.current; if (e && e.play.active) e.placeLineMark(false); }} />
              <div ref={el.lineMark} className="line-mark" hidden />
            </div>
          </div>
        </section>
      </main>
    </FormContext.Provider>
  );
}
