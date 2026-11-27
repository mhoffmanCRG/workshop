import { useCallback, useEffect, useRef, useState } from 'react';
import THREAD from './lib/thread.js';
import { createEngine, IDLE_INFO } from './lib/engine.js';
import { STORE_KEY, initialValues, toParams, toValues, toInput, applyEdit, defaultFor, defaultFileName } from './lib/params.js';
import { loadItem, storeItem, loadJSON } from '../../shared/storage.js';
import { FormContext, Num, Sel, Check, Text, Section } from '../../shared/components/tool/Fields.jsx';
import Messages from '../../shared/components/tool/Messages.jsx';
import Tiles, { duration } from '../../shared/components/tool/Tiles.jsx';
import SetupDialog from './components/SetupDialog.jsx';
import TimeCalc from './components/TimeCalc.jsx';
import MachineFollow from './components/MachineFollow.jsx';
import { useMachineProgram } from '../../shared/linuxcnc/index.js';

const TIME_KEY = 'thread-show-time';
const SHOW_KEY = 'thread-show';
const SIDE_KEY = 'thread-side-collapsed';
const WARN_KEY = 'thread-warnings-open';
const FOLD_KEY = 'thread-collapsed';

const STANDARD_OPTIONS = Object.keys(THREAD.STANDARDS).map((k) => [k, THREAD.STANDARDS[k].label]);
const MATERIAL_OPTIONS = Object.keys(THREAD.MATERIALS).map((k) => [k, THREAD.MATERIALS[k].label]);

function initialShown() {
  const saved = loadJSON(SHOW_KEY, {}) || {}, out = {};
  ['path', 'cutter', 'part', 'zero'].forEach((k) => { out[k] = typeof saved[k] === 'boolean' ? saved[k] : true; });
  return out;
}

function sizeOptions(standard) {
  const list = THREAD.sizeList(standard).map((s) => [s[0], s[1]]);
  return list.concat([['custom', list.length ? 'Other (entered below)' : 'Entered below']]);
}

function feedInfo(r) {
  if (!r || !r.gcode) return '';
  const st = r.stats, p = r.params;
  return (p.feedAuto ? st.materialLabel + ': ' + st.materialChip.toFixed(3) + ' mm per tooth gives ' + p.feed + ' mm/min at the cutting edge at ' + p.rpm + ' rpm. '
    : 'Tooth load at the cutting feed: ' + st.toothLoad.toFixed(4) + ' mm per tooth (typical for ' + st.materialLabel.toLowerCase() + ': ' + st.materialChip.toFixed(3) + '). ') +
    (p.edgeFeed ? 'The cutter centre runs at ' + r.passes[0].feed + (r.passes.length > 1 ? ' to ' + st.finalFeed : '') + ' mm/min. ' : '') +
    'A usual spindle speed for this cutter in ' + st.materialLabel.toLowerCase() + ' is about ' + (Math.round(st.suggestedRpm / 100) * 100).toLocaleString() + ' rpm.';
}

function tileItems(r, timeShown) {
  if (!r || !r.gcode) return null;
  const g = r.geom, s = r.stats, p = r.params, inch = (THREAD.STANDARDS[p.standard] || {}).inch;
  const pitch = inch ? (25.4 / p.pitch).toFixed(1).replace(/\.0$/, '') : p.pitch.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  return [
    g.internal ? { id: 'prep', label: 'Drill hole', value: p.holeDia.toFixed(2), unit: 'mm', key: true }
      : { id: 'prep', label: 'Turn stock to', value: p.stockDia.toFixed(3), unit: 'mm', key: true },
    { id: 'tip', label: g.internal ? 'Cut to major dia' : 'Cut to root dia', value: g.dFinal.toFixed(3), unit: 'mm' },
    { id: 'depth', label: 'Thread depth', value: g.depth.toFixed(3), unit: 'mm' },
    { id: 'pitch', label: p.starts > 1 ? 'Pitch, lead' : 'Pitch', value: pitch + (inch ? ' tpi' : '') + (p.starts > 1 ? ', ' + g.lead.toFixed(3) : ''),
      unit: p.starts > 1 || !inch ? 'mm' : '' },
    { id: 'path', label: 'Final path radius', value: g.finalR.toFixed(3), unit: 'mm' },
    { id: 'passes', label: 'Radial + spring passes', value: p.passes + ' + ' + p.springPasses },
    { id: 'turns', label: 'Helix turns per pass', value: String(g.turns) },
    { id: 'feed', label: 'Final centre feed', value: String(s.finalFeed), unit: 'mm/min' },
    { id: 'ratio', label: 'Cutter / thread dia', value: Math.round(s.ratio * 100) + ' %' },
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
    const r = THREAD.generate(p);
    const ok = !r.errors.length;
    // while the feed comes from the material, show the worked-out value in its (locked) box
    if (r.params.feedAuto && isFinite(r.params.feed) && valuesRef.current.feed !== String(r.params.feed)) {
      commit({ ...valuesRef.current, feed: String(r.params.feed) });
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
  const name = ok ? result.geom.name : THREAD.threadName(toParams(values));
  const internal = values.kind !== 'external';
  useEffect(() => { document.title = name + (internal ? ' internal' : ' external') + ' thread G-code'; }, [name, internal]);

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
    hint: 'Send loads this G-code into AXIS. The preview and drawings then follow the machine while it runs.',
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
    commit(toValues(THREAD.DEFAULTS));
    fileNameEdited.current = false;
    update();
  }

  function openSetup() {
    const d = setupDialog.current;
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }

  const feedLocked = !!(result && result.params.feedAuto);
  const inchStd = !!(THREAD.STANDARDS[values.standard] || {}).inch;
  const tpi = Number(values.pitch) > 0 ? (25.4 / Number(values.pitch)).toFixed(2).replace(/\.?0+$/, '') : '';
  const sideToggle = (
    <button type="button" ref={toggleRef} className={'side-toggle' + (sideCollapsed ? ' floating' : '')}
      aria-expanded={!sideCollapsed} title={sideCollapsed ? 'Show the settings' : 'Hide the settings'}
      onClick={() => setSideCollapsed(!sideCollapsed)}>
      {sideCollapsed ? '›' : '‹'}
    </button>
  );
  const form = { values, edit, setDefaults, shape: values.kind, foldKey: FOLD_KEY };

  return (
    <FormContext.Provider value={form}>
      <SetupDialog ref={setupDialog} />

      <main className={'layout' + (sideCollapsed ? ' side-collapsed' : '')}>
        <div className="side">
          <header className="top">
            {!sideCollapsed && sideToggle}
            <h1 aria-describedby="about">
              <select name="standard" className="title-select" aria-label="Thread standard" title="Thread standard"
                value={values.standard} onChange={(e) => edit('standard', e.target.value)}>
                {STANDARD_OPTIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select> thread G-code
            </h1>
            <p id="about" role="tooltip">Mills a thread with a thread mill on helical moves (G2/G3 with Z), inside a drilled hole or round a turned boss. Any size and hand, one or more starts, single-point or multi-tooth cutters.</p>
            <nav className="menu" aria-label="Help">
              <button type="button" className="menu-item" aria-haspopup="dialog" title="Setting up the job" onClick={openSetup}>Job setup</button>
            </nav>
          </header>

          <Messages result={result} storeKey={WARN_KEY} />

          <form id="settings" className="settings" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            <Section title="Thread" names={['hand', 'starts', 'majorDia', 'pitch', 'angle', 'minorDia', 'holeDia', 'stockDia', 'allowance', 'length']}>
              <Sel name="size" label="Size" options={sizeOptions(values.standard)} />
              <Sel name="kind" label="Thread" options={[['internal', 'Inside (in a hole)'], ['external', 'Outside (on a boss)']]} />
              <Sel name="hand" label="Hand" options={[['right', 'Right hand'], ['left', 'Left hand']]} />
              <Num name="starts" label="Starts" min="1" max="8" step="1" />
              <Num name="majorDia" label="Major diameter" unit="mm" min="0" step="0.01" />
              <Num name="pitch" label="Pitch" unit={inchStd && tpi ? 'mm (' + tpi + ' tpi)' : 'mm'} min="0" step="0.05" />
              <Num name="angle" label="Thread angle" unit="deg" min="20" max="120" step="1" />
              <Num name="minorDia" label="Minor diameter" unit="mm" shape="internal" min="0" step="0.01" />
              <Num name="minorDia" label="Root diameter" unit="mm" shape="external" min="0" step="0.01" />
              <Num name="holeDia" label="Drilled hole" unit="mm" shape="internal" min="0" step="0.05" />
              <Num name="stockDia" label="Stock diameter" unit="mm" shape="external" min="0" step="0.05" />
              <Num name="allowance" label="Diameter allowance" unit="mm" step="0.01" />
              <Num name="length" label="Thread length" unit="mm" min="0" step="0.5" />
              <p className="hint">Picking a size fills in the diameters: the basic minor diameter and the usual tap drill for an inside thread, the root the cutter must reach for an outside one. The cutter tip goes to the major diameter inside and to the root diameter outside; a positive allowance moves it further (looser fit), a negative one less. Check the first part with a gauge.</p>
            </Section>

            <Section title="Position" names={['centres', 'zTop', 'holeDepth', 'clearance']}>
              <Text name="centres" label="Thread centres (x,y; x,y …)" placeholder="0,0" />
              <Num name="zTop" label="Top of thread" unit="Z mm" step="0.5" />
              <Num name="holeDepth" label="Hole depth" unit="mm, 0 = through" shape="internal" min="0" step="0.5" />
              <Num name="clearance" label="Clearance above top" unit="mm" min="0" step="1" />
              <p className="hint">Each thread is cut in turn at the positions listed, in work coordinates. For a blind hole, give its drilled depth below the top: the cutter tip must stay above the bottom.</p>
            </Section>

            <Section title="Cutter" names={['toolDia', 'rows', 'tipOffset', 'shaftDia', 'shaftLen', 'flutes', 'material', 'rpm', 'feedAuto', 'feed', 'edgeFeed', 'plunge']}>
              <Num name="toolDia" label="Cutting diameter" unit="mm" min="0" step="0.1" />
              <Num name="rows" label="Teeth along the cutter" min="1" max="60" step="1" />
              <Num name="tipOffset" label="Lowest tooth above tip" unit="mm" min="0" step="0.05" />
              <Num name="shaftDia" label="Shaft diameter" unit="mm" min="0" step="0.1" />
              <Num name="shaftLen" label="Shaft length to holder" unit="mm" min="0" step="1" />
              <Num name="flutes" label="Flutes" min="1" max="12" step="1" />
              <Sel name="material" label="Material" options={MATERIAL_OPTIONS} />
              <Num name="rpm" label="Spindle speed" unit="rpm" min="0" step="100" />
              <Check name="feedAuto">Set the feed from the material</Check>
              <Num name="feed" label="Cutting feed" unit="mm/min" min="0" step="10" disabled={feedLocked} />
              <Check name="edgeFeed">Feed is at the cutting edge (convert for the cutter centre)</Check>
              <Num name="plunge" label="Feed in and out" unit="mm/min" min="0" step="10" />
              <p className="hint">{feedInfo(ok ? result : lastGood.current)}</p>
              <p className="hint">A single-point cutter has one tooth and cuts the whole length on one helix; a multi-tooth cutter has a row of teeth at the thread pitch and needs fewer turns. The cutter must match the pitch. G-code feeds the cutter centre, which runs on a smaller circle than the teeth inside a hole and a larger one round a boss, so with the conversion on the edge feed stays as entered.</p>
            </Section>

            <Section title="Cutting" names={['direction', 'passes', 'spacing', 'springPasses']}>
              <Sel name="direction" label="Milling" options={[['climb', 'Climb'], ['conventional', 'Conventional']]} />
              <Num name="passes" label="Radial passes" min="1" max="50" step="1" />
              <Sel name="spacing" label="Pass depths" options={[['area', 'Equal chip area'], ['equal', 'Equal depth']]} />
              <Num name="springPasses" label="Spring passes" min="0" max="5" step="1" />
              <p className="hint">Each pass leads in on a quarter-circle arc, runs the whole thread on a helix and leads out the same way. Equal chip area takes deeper cuts first, where the tooth only touches with its tip, and lighter ones as more of the flank engages. A spring pass repeats the full depth to take out what the cutter sprang away from. Climb milling gives a better finish and is the usual choice.</p>
            </Section>

            <Section title="Program" names={['wcs', 'dwell', 'toolChange', 'toolNumber', 'coolant']}>
              <Sel name="wcs" label="Work offset" options={[['', 'None'], ...['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map((w) => [w, w])]} />
              <Num name="dwell" label="Spindle start dwell" unit="s" min="0" step="0.5" />
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
                <span className="key key-cut">full-depth path</span>
                <span className="key key-rough">roughing paths</span>
              </figcaption>
            </figure>
            <figure className="view-section">
              <canvas ref={el.section} />
              <figcaption>Section through the wall at the top of the thread, cutter at its current depth</figcaption>
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
