import { useCallback, useEffect, useRef, useState } from 'react';
import KEYWAY from './lib/keyway.js';
import { createEngine, IDLE_INFO } from './lib/engine.js';
import { STORE_KEY, initialValues, toParams, toValues, toInput, applyEdit, defaultFor, defaultFileName } from './lib/params.js';
import { loadItem, storeItem, loadJSON } from '../../shared/storage.js';
import { FormContext, Num, Sel, Check, Section } from '../../shared/components/tool/Fields.jsx';
import Messages from '../../shared/components/tool/Messages.jsx';
import Tiles, { duration } from '../../shared/components/tool/Tiles.jsx';
import SetupDialog from './components/SetupDialog.jsx';
import TimeCalc from './components/TimeCalc.jsx';
import MachineFollow from './components/MachineFollow.jsx';
import { useMachineProgram } from '../../shared/linuxcnc/index.js';

const TIME_KEY = 'keyway-show-time';
const SHOW_KEY = 'keyway-show';
const SIDE_KEY = 'keyway-side-collapsed';
const WARN_KEY = 'keyway-warnings-open';
const FOLD_KEY = 'keyway-collapsed';

const STANDARD_OPTIONS = Object.keys(KEYWAY.STANDARDS).map((k) => [k, KEYWAY.STANDARDS[k].label]);
const MATERIAL_OPTIONS = Object.keys(KEYWAY.MATERIALS).map((k) => [k, KEYWAY.MATERIALS[k].label]);

function initialShown() {
  const saved = loadJSON(SHOW_KEY, {}) || {}, out = {};
  ['path', 'cutter', 'part', 'zero'].forEach((k) => { out[k] = typeof saved[k] === 'boolean' ? saved[k] : true; });
  return out;
}

// What the standard gives for the bore, for the hint under the keyway settings.
function sizeInfo(values) {
  const st = values.standard, bore = Number(values.boreDia);
  if (st === 'custom') return 'Custom size: width and depth as entered.';
  const s = KEYWAY.sizeFor(st, bore);
  if (!s) return 'This bore is outside the ' + KEYWAY.STANDARDS[st].label + ' table; enter the width and depth by hand.';
  return KEYWAY.STANDARDS[st].label + ' for bores ' + s.range + ': key ' + s.width + ' × ' + s.height + ', hub depth ' + s.depth + ' mm' +
    (st === 'ANSI' ? ' (half the key at the side walls, measured on the centre line)' : '') + '.';
}

function docInfo(r) {
  if (!r || !r.gcode) return '';
  const p = r.params, st = r.stats, g = r.geom;
  return (p.docAuto ? st.materialLabel + ': ' + st.materialDoc.toFixed(3) + ' mm per stroke. ' : 'Usual for ' + st.materialLabel.toLowerCase() + ': about ' + st.materialDoc.toFixed(3) + ' mm per stroke. ') +
    'The depth is split evenly, so each stroke takes ' + g.stepDoc.toFixed(4) + ' mm on the first lane.';
}

function tileItems(r, timeShown) {
  if (!r || !r.gcode) return null;
  const g = r.geom, s = r.stats, p = r.params;
  return [
    { id: 'width', label: 'Keyway width', value: p.width.toFixed(3), unit: 'mm', key: true },
    { id: 'depth', label: 'Depth from bore', value: p.depth.toFixed(3), unit: 'mm' },
    { id: 'over', label: 'Over bore + keyway', value: s.over.toFixed(3), unit: 'mm' },
    { id: 'lanes', label: 'Lanes across', value: String(g.lanes.length) },
    { id: 'strokes', label: p.keyways > 1 ? 'Strokes per keyway' : 'Strokes', value: String(s.strokes) },
    { id: 'stroke', label: 'Stroke length', value: g.strokeLen.toFixed(1), unit: 'mm' },
    { id: 'doc', label: 'Depth per stroke', value: g.stepDoc.toFixed(3), unit: 'mm' },
    { id: 'feed', label: 'Stroke feed', value: String(p.strokeFeed), unit: 'mm/min' },
    { id: 'volume', label: 'Material removed', value: s.volume < 1000 ? s.volume.toFixed(0) : (s.volume / 1000).toFixed(2), unit: s.volume < 1000 ? 'mm³' : 'cm³' },
    { id: 'time', label: 'Estimated run time', value: duration(s.minutes), pressed: timeShown, controls: 'timecalc' }
  ];
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

  const engineRef = useRef(null);
  const refreshRef = useRef(() => {});      // set by MachineFollow
  const fileNameEdited = useRef(false);
  const lastGood = useRef(null);
  const timer = useRef(null);
  const flashTime = useRef(false);
  const el = {
    view3d: useRef(null), top: useRef(null), section: useRef(null), gcode: useRef(null),
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
    const r = KEYWAY.generate(p);
    const ok = !r.errors.length;
    // while the depth per stroke comes from the material, show it in its (locked) box
    if (r.params.docAuto && isFinite(r.params.doc) && valuesRef.current.doc !== String(r.params.doc)) {
      commit({ ...valuesRef.current, doc: String(r.params.doc) });
    }
    e.setResult(r);
    if (ok) {
      lastGood.current = r;
      if (!fileNameEdited.current) setFileName(defaultFileName(r.params));
    } else {
      // The tiles are gone while there is an error, so a bad time-calculator value must stay reachable.
      const q = r.params;
      if (!(q.feedOverride > 0 && q.rapidRate > 0 && Number.isInteger(q.quantity) && q.quantity >= 1)) setTimeHidden(false);
    }
    setResult(r);
    refreshRef.current();
  }, [commit]);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(update, 120);
  }, [update]);

  const edit = useCallback((name, value) => {
    commit(applyEdit(valuesRef.current, name, value));
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
      view3d: el.view3d.current, top: el.top.current, section: el.section.current, gcode: el.gcode.current,
      lineMark: el.lineMark.current, scrub: el.scrub.current, playInfo: el.playInfo.current
    }, setPlayState);
    engineRef.current = e;
    Object.keys(shown).forEach((k) => { e.view3d.show[k] = shown[k]; });
    e.showZero = shown.zero;
    update();
    return () => { clearTimeout(timer.current); e.dispose(); engineRef.current = null; };
    // created once; later changes go through the handlers below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ok = !!(result && !result.errors.length);
  const name = ok ? result.geom.name : KEYWAY.keyName(toParams(values));
  useEffect(() => { document.title = name + ' slotting G-code'; }, [name]);

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
    if (!first || sideCollapsed) window.dispatchEvent(new Event('resize'));
  }, [sideCollapsed]);

  // The run-time tile opened the time calculator: bring it into view.
  useEffect(() => {
    if (timeHidden || !flashTime.current) return;
    flashTime.current = false;
    const panel = timePanel.current;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    panel.classList.remove('flash'); void panel.offsetWidth; panel.classList.add('flash');
  }, [timeHidden]);

  function currentFileName() { return fileName.trim() || defaultFileName(result.params); }

  // Offer the G-code to LinuxCNC (inside the AXIS Tools tab): the toolbar gets Send and Cycle start
  // for it, and "Show machine", which MachineFollow draws.
  useMachineProgram({
    gcode: ok ? result.gcode : '',
    fileName: ok ? currentFileName() : '',
    hint: 'Send loads this G-code into AXIS. The spindle must stay stopped: the program never starts it.',
    follow: true
  });

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
    commit(toValues(KEYWAY.DEFAULTS));
    fileNameEdited.current = false;
    update();
  }

  function openSetup() {
    const d = setupDialog.current;
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }

  const docLocked = !!(result && result.params.docAuto);
  const inchStd = !!(KEYWAY.STANDARDS[values.standard] || {}).inch;
  const boreInch = inchStd && Number(values.boreDia) > 0 ? 'mm (' + (Number(values.boreDia) / 25.4).toFixed(4).replace(/\.?0+$/, '') + ' in)' : 'mm';
  const sideToggle = (
    <button type="button" ref={toggleRef} className={'side-toggle' + (sideCollapsed ? ' floating' : '')}
      aria-expanded={!sideCollapsed} title={sideCollapsed ? 'Show the settings' : 'Hide the settings'}
      onClick={() => setSideCollapsed(!sideCollapsed)}>
      {sideCollapsed ? '›' : '‹'}
    </button>
  );
  const form = { values, edit, setDefaults, shape: values.ends, foldKey: FOLD_KEY };

  return (
    <FormContext.Provider value={form}>
      <SetupDialog ref={setupDialog} />

      <main className={'layout' + (sideCollapsed ? ' side-collapsed' : '')}>
        <div className="side">
          <header className="top">
            {!sideCollapsed && sideToggle}
            <h1 aria-describedby="about">
              <select name="standard" className="title-select" aria-label="Key standard" title="Key standard"
                value={values.standard} onChange={(e) => edit('standard', e.target.value)}>
                {STANDARD_OPTIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select> keyway
            </h1>
            <p id="about" role="tooltip">Slots an internal keyway in a bore with the spindle stopped: a slotting tool strokes down the bore on Z, stepping out a little each stroke and pulling clear on the way up. Standard key sizes or any width and depth, one or more keyways.</p>
            <nav className="menu" aria-label="Help">
              <button type="button" className="menu-item" aria-haspopup="dialog" title="Setting up the job" onClick={openSetup}>Job setup</button>
            </nav>
          </header>

          <Messages result={result} storeKey={WARN_KEY} />

          <form id="settings" className="settings" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            <Section title="Keyway" names={['boreDia', 'width', 'depth', 'hubLength', 'ends', 'keyLength', 'hubDia']}>
              <Num name="boreDia" label="Bore diameter" unit={boreInch} min="0" step="0.5" />
              <Num name="width" label="Keyway width" unit="mm" min="0" step="0.1" />
              <Num name="depth" label="Depth from bore" unit="mm, t2" min="0" step="0.1" />
              <Num name="hubLength" label="Hub length" unit="mm" min="0" step="1" />
              <Sel name="ends" label="Keyway" options={[['through', 'Through the hub'], ['blind', 'Blind (stops short)']]} />
              <Num name="keyLength" label="Keyway length" unit="mm" shape="blind" min="0" step="1" />
              <Num name="hubDia" label="Hub outside dia" unit="mm, for the drawings" min="0" step="1" />
              <p className="hint">{sizeInfo(values)} The depth is measured from the bore wall on the keyway centre line, so bore + depth is the size over the bore and keyway. Hub keyways are usually JS9 (normal fit) or P9 (tight fit) on the width.</p>
            </Section>

            <Section title="Position" names={['centreX', 'centreY', 'angle', 'keyways', 'zTop', 'clearance']}>
              <Num name="centreX" label="Bore centre X" unit="mm" step="0.5" />
              <Num name="centreY" label="Bore centre Y" unit="mm" step="0.5" />
              <Num name="angle" label="Keyway direction" unit="deg from +X" step="15" />
              <Num name="keyways" label="Number of keyways" min="1" max="8" step="1" />
              <Num name="zTop" label="Top face" unit="Z mm" step="0.5" />
              <Num name="clearance" label="Clearance above top" unit="mm" min="0" step="1" />
              <p className="hint">More than one keyway are spaced evenly round the bore, starting at the direction given.</p>
            </Section>

            <Section title="Tool" names={['toolWidth', 'edgeOffset', 'headDepth', 'reach', 'orient', 'orientOffset']}>
              <Num name="toolWidth" label="Cutting edge width" unit="mm" min="0" step="0.1" />
              <Num name="edgeOffset" label="Edge in front of axis" unit="mm" step="0.1" />
              <Num name="headDepth" label="Head, edge to back" unit="mm" min="0" step="0.5" />
              <Num name="reach" label="Edge to holder" unit="mm" min="0" step="1" />
              <Check name="orient">Orient the spindle (M19) before each keyway</Check>
              <Num name="orientOffset" label="Orient angle" unit="R when edge faces +X" step="1" />
              <p className="hint">A tool narrower than the keyway cuts it in lanes side by side. The program moves the spindle axis, so the edge offset sets where the edge is; measure it from the spindle centre to the cutting edge. M19 needs spindle orient set up in the machine configuration.</p>
            </Section>

            <Section title="Cutting" names={['material', 'docAuto', 'doc', 'springStrokes', 'strokeFeed', 'returnRapid', 'returnFeed', 'relief', 'sideFeed', 'overtravel']}>
              <Sel name="material" label="Material" options={MATERIAL_OPTIONS} />
              <Check name="docAuto">Set the depth per stroke from the material</Check>
              <Num name="doc" label="Depth per stroke" unit="mm" min="0" step="0.01" disabled={docLocked} />
              <Num name="springStrokes" label="Spring strokes" min="0" max="10" step="1" />
              <Num name="strokeFeed" label="Cutting stroke feed" unit="mm/min" min="0" step="100" />
              <Check name="returnRapid">Return up at rapid</Check>
              <Num name="returnFeed" label="Return feed" unit="mm/min" min="0" step="100" disabled={!!values.returnRapid} />
              <Num name="relief" label="Pull back before return" unit="mm" min="0" step="0.05" />
              <Num name="sideFeed" label="Feed in and out" unit="mm/min" min="0" step="50" />
              <Num name="overtravel" label="Overtravel below hub" unit="mm" shape="through" min="0" step="0.5" />
              <p className="hint">{docInfo(ok ? result : lastGood.current)}</p>
              <p className="hint">Each stroke moves in to the next depth above the part, cuts down the full length, pulls back by the relief so the edge does not rub, and returns up. Spring strokes repeat the full depth to clean up what the tool sprang away from.</p>
            </Section>

            <Section title="Program" names={['wcs', 'toolChange', 'toolNumber', 'coolant']}>
              <Sel name="wcs" label="Work offset" options={[['', 'None'], ...['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map((w) => [w, w])]} />
              <Check name="toolChange">Tool change and length offset (T, M6, G43)</Check>
              <Num name="toolNumber" label="Tool number" min="1" max="99" step="1" />
              <Sel name="coolant" label="Coolant" options={[['off', 'Off'], ['flood', 'Flood (M8)'], ['mist', 'Mist (M7)']]} />
            </Section>

            <button type="button" className="quiet" onClick={resetAll}>Set everything to default</button>
          </form>
        </div>

        <section className="results">
          <div className="views">
            <div className="tiles-block">
              <Tiles items={ok ? tileItems(result, !timeHidden) : null} selected={selected} onSelect={onTile} />
              <p className="hint tiles-hint">Click a tile to show it on the drawings, or the run time tile to open the time calculator. Click it again to hide it.</p>
            </div>
            <figure className="view3d">
              {sideCollapsed && sideToggle}
              <div className="canvas-box"><canvas ref={el.view3d} /></div>
              <figcaption>
                <span>3D preview. Drag to rotate, shift-drag to move, scroll to zoom, double-click to reset.</span>
                <label className="inline"><input type="checkbox" checked={shown.path} onChange={(e) => onShow('path', e.target.checked)} /> Toolpath</label>
                <label className="inline"><input type="checkbox" checked={shown.cutter} onChange={(e) => onShow('cutter', e.target.checked)} /> Cutter</label>
                <label className="inline"><input type="checkbox" checked={shown.part} onChange={(e) => onShow('part', e.target.checked)} /> Part</label>
                <label className="inline"><input type="checkbox" checked={shown.zero} onChange={(e) => onShow('zero', e.target.checked)} /> Zero point</label>
              </figcaption>
            </figure>
            <figure className="view-top">
              <canvas ref={el.top} />
              <figcaption>
                Seen from above:
                <span className="key key-cut">finished keyway</span>
                <span className="key key-rough">other keyways</span>
              </figcaption>
            </figure>
            <figure className="view-section">
              <canvas ref={el.section} />
              <figcaption>Section along the keyway: hub wall, keyway as cut so far, tool at its current height</figcaption>
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
              </select>
            </label>
            <input type="range" ref={el.scrub} min="0" max="1000" step="1" defaultValue="0" disabled={!ok}
              aria-label="Position in the program" onChange={(e) => engineRef.current?.scrubTo(e.target.value)} />
            <output ref={el.playInfo} className="play-info">{IDLE_INFO}</output>
          </div>

          <MachineFollow engineRef={engineRef} refreshRef={refreshRef} />

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
