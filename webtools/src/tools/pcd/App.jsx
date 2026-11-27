import { useCallback, useEffect, useRef, useState } from 'react';
import PCD from './lib/pcd.js';
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

const TIME_KEY = 'pcd-show-time';
const SHOW_KEY = 'pcd-show';
const SIDE_KEY = 'pcd-side-collapsed';
const WARN_KEY = 'pcd-warnings-open';
const FOLD_KEY = 'pcd-collapsed';

const CYCLE_OPTIONS = Object.keys(PCD.CYCLES).map((k) => [k, PCD.CYCLES[k].label]);
const MATERIAL_OPTIONS = Object.keys(PCD.MATERIALS).map((k) => [k, PCD.MATERIALS[k].label]);
const DRILLING = 'drill spot dwell peck chipbreak';

function initialShown() {
  const saved = loadJSON(SHOW_KEY, {}) || {}, out = {};
  ['path', 'cutter', 'part', 'zero'].forEach((k) => { out[k] = typeof saved[k] === 'boolean' ? saved[k] : true; });
  return out;
}

const f3 = (v) => v.toFixed(3).replace(/\.?0+$/, '') || '0';
const deg = (v) => (Math.round(v * 1000) / 1000) + '°';

function feedInfo(r) {
  if (!r || !r.gcode) return '';
  const st = r.stats, p = r.params;
  if (r.geom.tap) return 'A tap feeds one pitch per turn: ' + p.rpm + ' rpm × ' + p.tapPitch + ' mm = ' + Math.round(st.tapFeed) + ' mm/min, kept in step with the spindle by G33.1.';
  return (p.feedAuto ? st.materialLabel + ': ' + st.materialRev.toFixed(3) + ' mm per turn gives ' + p.feed + ' mm/min at ' + p.rpm + ' rpm. '
    : 'Feed per turn: ' + st.feedRev.toFixed(3) + ' mm (typical for ' + st.materialLabel.toLowerCase() + ': ' + st.materialRev.toFixed(3) + '). ') +
    'A usual spindle speed for a ' + p.toolDia + ' mm HSS drill in ' + st.materialLabel.toLowerCase() + ' is about ' + (Math.round(st.suggestedRpm / 50) * 50).toLocaleString() + ' rpm; carbide runs two to three times faster.';
}

function cycleTile(r) {
  const p = r.params, g = r.geom, s = r.stats;
  if (p.cycle === 'peck' || p.cycle === 'chipbreak') return { id: 'pecks', label: 'Pecks per hole', value: String(g.pecks) };
  if (p.cycle === 'spot') return { id: 'cycle', label: 'Spot diameter', value: g.spotDia.toFixed(2), unit: 'mm' };
  if (p.cycle === 'dwell') return { id: 'cycle', label: 'Dwell at bottom', value: String(p.holeDwell), unit: 's' };
  if (p.cycle === 'tap') return { id: 'cycle', label: 'Tap feed (synced)', value: String(Math.round(s.tapFeed)), unit: 'mm/min' };
  return { id: 'cycle', label: 'Cycle', value: PCD.CYCLES[p.cycle].code };
}

function tileItems(r, timeShown) {
  if (!r || !r.gcode) return null;
  const g = r.geom, s = r.stats, p = r.params, first = g.list[0];
  return [
    { id: 'pcd', label: 'Pitch circle', value: 'Ø' + f3(p.pcd), unit: 'mm', key: true },
    { id: 'holes', label: 'Holes to drill', value: g.list.length + (g.list.length < g.holes.length ? ' of ' + g.holes.length : '') },
    { id: 'angle', label: 'Angle between', value: deg(Math.abs(g.step)) },
    { id: 'pitch', label: 'Hole spacing', value: g.chord.toFixed(3), unit: 'mm' },
    { id: 'wall', label: 'Wall between holes', value: p.count > 1 ? g.wall.toFixed(2) : '–', unit: p.count > 1 ? 'mm' : '' },
    { id: 'first', label: 'Hole ' + first.n + ' at', value: 'X' + f3(first.x) + ' Y' + f3(first.y) },
    { id: 'depth', label: g.tap ? 'Thread depth' : g.tipLen > 0 && !g.spot ? 'Depth to tip' : 'Depth', value: s.holeDepth.toFixed(2), unit: 'mm' },
    cycleTile(r),
    g.tap ? { id: 'feed', label: 'Spindle', value: String(p.rpm), unit: 'rpm' } : { id: 'feed', label: 'Feed', value: String(p.feed), unit: 'mm/min' },
    { id: 'time', label: 'Estimated run time', value: duration(s.minutes), pressed: timeShown, controls: 'timecalc' }
  ];
}

// Hole positions for the table (and for copying as text).
function HoleTable({ r }) {
  const [label, setLabel] = useState('Copy');
  if (!r || !r.gcode) return null;
  const rows = r.geom.holes;
  const text = 'Hole\tAngle\tX\tY\n' + rows.filter((h) => !h.skip).map((h) => h.n + '\t' + h.angle.toFixed(3) + '\t' + h.x.toFixed(4) + '\t' + h.y.toFixed(4)).join('\n') + '\n';
  function copy() {
    const done = (good) => { setLabel(good ? 'Copied' : 'Copy failed'); setTimeout(() => setLabel('Copy'), 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
    else done(false);
  }
  return (
    <section className="panel holes-panel">
      <div className="toolbar">
        <h2>Hole positions</h2>
        <button type="button" className="quiet" onClick={copy}>{label}</button>
      </div>
      <div className="hole-table-wrap">
        <table className="time-table hole-table">
          <thead><tr><th>Hole</th><th>Angle</th><th>X</th><th>Y</th></tr></thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.n} className={h.skip ? 'skipped' : ''}>
                <td>{h.n}{h.skip ? ' (skipped)' : ''}</td><td>{h.angle.toFixed(3)}°</td><td>{h.x.toFixed(4)}</td><td>{h.y.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">Work coordinates, angles anticlockwise from +X. Copy gives a tab-separated list of the holes drilled, for a spreadsheet or a manual job.</p>
    </section>
  );
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
    const r = PCD.generate(p);
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
  const name = PCD.title(toParams(values));
  useEffect(() => { document.title = name + ' G-code'; }, [name]);

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
    commit(toValues(PCD.DEFAULTS));
    fileNameEdited.current = false;
    update();
  }

  function openSetup() {
    const d = setupDialog.current;
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }

  const feedLocked = !!(result && result.params.feedAuto);
  const tap = values.cycle === 'tap';
  const sideToggle = (
    <button type="button" ref={toggleRef} className={'side-toggle' + (sideCollapsed ? ' floating' : '')}
      aria-expanded={!sideCollapsed} title={sideCollapsed ? 'Show the settings' : 'Hide the settings'}
      onClick={() => setSideCollapsed(!sideCollapsed)}>
      {sideCollapsed ? '›' : '‹'}
    </button>
  );
  const form = { values, edit, setDefaults, shape: values.cycle, foldKey: FOLD_KEY };

  return (
    <FormContext.Provider value={form}>
      <SetupDialog ref={setupDialog} />

      <main className={'layout' + (sideCollapsed ? ' side-collapsed' : '')}>
        <div className="side">
          <header className="top">
            {!sideCollapsed && sideToggle}
            <h1 aria-describedby="about">
              <select name="cycle" className="title-select" aria-label="Cycle" title="Cycle"
                value={values.cycle} onChange={(e) => edit('cycle', e.target.value)}>
                {CYCLE_OPTIONS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select> on a PCD
            </h1>
            <p id="about" role="tooltip">Drills, spots or taps holes spaced round a pitch circle, or along an arc of one, with LinuxCNC canned cycles (G81, G82, G83, G73) or rigid tapping (G33.1).</p>
            <nav className="menu" aria-label="Help">
              <button type="button" className="menu-item" aria-haspopup="dialog" title="Setting up the job" onClick={openSetup}>Job setup</button>
            </nav>
          </header>

          <Messages result={result} storeKey={WARN_KEY} />

          <form id="settings" className="settings" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            <Section title="Pattern" names={['cx', 'cy', 'pcd', 'count', 'layout', 'span', 'startAngle', 'direction', 'skip']}>
              <Num name="pcd" label="Pitch circle diameter" unit="mm" min="0" step="1" />
              <Num name="count" label="Number of holes" min="1" max="360" step="1" />
              <Sel name="layout" label="Spacing" options={[['full', 'Full circle'], ['arc', 'Along an arc']]} />
              {values.layout === 'arc' && <Num name="span" label="First to last hole" unit="deg" min="0" max="360" step="5" />}
              <Num name="startAngle" label="First hole at" unit="deg from +X" step="5" />
              <Sel name="direction" label="Numbered" options={[['ccw', 'Anticlockwise'], ['cw', 'Clockwise']]} />
              <Num name="cx" label="Centre X" unit="mm" step="1" />
              <Num name="cy" label="Centre Y" unit="mm" step="1" />
              <Text name="skip" label="Holes to leave out (e.g. 2, 5-6)" placeholder="none" />
              <p className="hint">The holes are drilled in their number order, going round the way they are numbered. A full circle spaces them evenly; an arc puts the first and last at its ends.</p>
            </Section>

            <Section title="Hole" names={['holeDia', 'depth', 'depthTo', 'pointAngle', 'zTop', 'thickness', 'retract', 'clearance', 'retractMode', 'peck', 'holeDwell', 'tapPitch']}>
              <Num name="holeDia" label={tap ? 'Tap drill hole' : 'Hole diameter'} unit="mm" min="0" step="0.1" />
              <Num name="depth" label={tap ? 'Thread depth' : values.cycle === 'spot' ? 'Spot depth (to tip)' : 'Hole depth'} unit="mm" min="0" step="0.5" />
              <Sel name="depthTo" label="Depth is" shape="drill dwell peck chipbreak" options={[['full', 'To full diameter'], ['tip', 'To the tip']]} />
              <Num name="pointAngle" label="Point angle" unit="deg" shape={DRILLING} min="60" max="180" step="1" />
              <Num name="peck" label="Peck depth (Q)" unit="mm" shape="peck chipbreak" min="0" step="0.5" />
              <Num name="holeDwell" label="Dwell at bottom (P)" unit="s" shape="dwell" min="0" step="0.1" />
              <Num name="tapPitch" label="Thread pitch (K)" unit="mm" shape="tap" min="0" step="0.05" />
              <Num name="zTop" label="Top of part" unit="Z mm" step="0.5" />
              <Num name="thickness" label="Part thickness" unit="mm, 0 = not given" min="0" step="1" />
              <Num name="retract" label="R plane above top" unit="mm" min="0" step="0.5" />
              <Num name="clearance" label="Clearance above top" unit="mm" min="0" step="1" />
              <Sel name="retractMode" label="Between holes" options={[['r', 'R plane (G99)'], ['clear', 'Clearance (G98)']]} />
              <p className="hint">{tap
                ? 'G33.1 feeds the tap down in step with the spindle, reverses it at the bottom and brings the tap back out to the R plane.'
                : values.cycle === 'peck' ? 'G83 pecks down by Q, pulling right out to the R plane after each peck to clear the chips.'
                  : values.cycle === 'chipbreak' ? 'G73 pecks down by Q and backs off a quarter of a millimetre after each peck to break the chip, without leaving the hole.'
                    : 'The drill point goes past the full-diameter depth by about 0.3 × the drill diameter (118° point). The part thickness is only used to warn when the tip comes out the bottom.'}</p>
            </Section>

            <Section title="Tool" names={['toolDia', 'material', 'rpm', 'feedAuto', 'feed']}>
              <Num name="toolDia" label={tap ? 'Tap size' : values.cycle === 'spot' ? 'Spot drill diameter' : 'Drill diameter'} unit="mm" min="0" step="0.1" />
              <Sel name="material" label="Material" options={MATERIAL_OPTIONS} />
              <Num name="rpm" label="Spindle speed" unit="rpm" min="0" step="50" />
              <Check name="feedAuto" shape={DRILLING}>Set the feed from the material</Check>
              <Num name="feed" label="Feed" unit="mm/min" shape={DRILLING} min="0" step="5" disabled={feedLocked} />
              <p className="hint">{feedInfo(ok ? result : lastGood.current)}</p>
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
                <label className="inline"><input type="checkbox" checked={shown.cutter} onChange={(e) => onShow('cutter', e.target.checked)} /> Tool</label>
                <label className="inline"><input type="checkbox" checked={shown.part} onChange={(e) => onShow('part', e.target.checked)} /> Part</label>
                <label className="inline"><input type="checkbox" checked={shown.zero} onChange={(e) => onShow('zero', e.target.checked)} /> Zero point</label>
              </figcaption>
            </figure>
            <figure className="view-top">
              <canvas ref={el.top} />
              <figcaption>
                Seen from above:
                <span className="key key-cut">drilled</span>
                <span className="key key-rough">still to drill</span>
              </figcaption>
            </figure>
            <figure className="view-section">
              <canvas ref={el.section} />
              <figcaption>Section through the hole being drilled, with the R plane, clearance and peck depths</figcaption>
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

          <HoleTable r={ok ? result : null} />

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
