import { useCallback, useEffect, useRef, useState } from 'react';
import { createEngine, IDLE_INFO } from './engine.js';
import { loadItem, storeItem, loadJSON } from '../storage.js';
import { FormContext } from '../components/tool/Fields.jsx';
import Messages from '../components/tool/Messages.jsx';
import Tiles from '../components/tool/Tiles.jsx';
import { SetupDialog, TimeCalc } from './fields.jsx';
import MachineFollow from './MachineFollow.jsx';
import { useMachineProgram } from '../linuxcnc/index.js';

/*
 * The whole page of a toolpath tool (Facing, Pocket, Profile, Bore, Drilling, Slot): settings column,
 * tiles, 3D preview, the two drawings, playback, the LinuxCNC link, time calculator and G-code. A
 * tool supplies its generator and what is particular to it:
 *
 *   op        { DEFAULTS, generate(p), title(p), fileName(p), applyEdit?(values, name, value) }
 *   params    makeParams(op.DEFAULTS, storeKey)
 *   id        prefix for what the page remembers in browser storage
 *   shapeKey  the setting chosen in the title (fields with shape="..." follow it)
 *   heading(values, edit)  the title; about: its tooltip; setup: the Job setup dialog's content
 *   fields(ctx)            the settings sections; ctx: { values, result, ok, last, locked }
 *   tiles(result, timeShown)  the summary tiles (a tile with id 'time' opens the time calculator)
 *   topKey, sectionCaption the drawings' captions; extra(result): panels above the G-code
 *   timeRows, timeNote     the time calculator's rows ([[bucket, label]]) and an extra note
 *
 * A result's `auto` (e.g. feeds worked out from the material) is written into the settings form.
 */
export default function ToolPage({ op, params, id, shapeKey, heading, about, setup, fields, tiles, topKey, sectionCaption, extra, timeRows, timeNote }) {
  const KEY = { time: id + '-show-time', show: id + '-show', side: id + '-side-collapsed', warn: id + '-warnings-open', fold: id + '-collapsed' };
  const [values, setValues] = useState(params.initialValues);
  const valuesRef = useRef(values);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(null);
  const [timeHidden, setTimeHidden] = useState(() => loadItem(KEY.time, '0') !== '1');
  const [shown, setShown] = useState(() => {
    const saved = loadJSON(KEY.show, {}) || {}, out = {};
    ['path', 'cutter', 'part', 'zero'].forEach((k) => { out[k] = typeof saved[k] === 'boolean' ? saved[k] : true; });
    return out;
  });
  const [sideCollapsed, setSideCollapsed] = useState(() => loadItem(KEY.side, '0') === '1');
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
    const p = params.toParams(valuesRef.current);
    storeItem(params.storeKey, JSON.stringify(p));
    e.stopPlayback();
    let r;
    try { r = op.generate(p); } catch (err) {
      console.error('Generator failed:', err);
      r = { params: p, errors: ['Could not work out the toolpath (' + err.message + '). Change a setting, or set everything to default.'], warnings: [], gcode: '' };
    }
    const ok = !r.errors.length;
    // values worked out by the generator (feeds from the material) show in their locked boxes
    if (r.auto) {
      const cur = valuesRef.current, next = { ...cur };
      let changed = false;
      Object.keys(r.auto).forEach((k) => { if (isFinite(r.auto[k]) && cur[k] !== String(r.auto[k])) { next[k] = String(r.auto[k]); changed = true; } });
      if (changed) commit(next);
    }
    e.setResult(r);
    if (ok) {
      lastGood.current = r;
      if (!fileNameEdited.current) setFileName(op.fileName(r.params));
    } else {
      // The tiles are gone while there is an error, so a bad time-calculator value must stay reachable.
      const q = r.params;
      if (!(q.feedOverride > 0 && q.rapidRate > 0 && Number.isInteger(q.quantity) && q.quantity >= 1)) setTimeHidden(false);
    }
    setResult(r);
    refreshRef.current();
  }, [commit, op, params]);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(update, 120);
  }, [update]);

  const edit = useCallback((name, value) => {
    const cur = valuesRef.current;
    commit(op.applyEdit ? op.applyEdit(cur, name, value) : { ...cur, [name]: value });
    schedule();
  }, [commit, schedule, op]);

  const setDefaults = useCallback((names) => {
    const next = { ...valuesRef.current };
    names.forEach((n) => { const v = params.defaultFor(n); if (v !== undefined) next[n] = params.toInput(n, v); });
    commit(next);
    update();
  }, [commit, update, params]);

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
  const name = op.title(params.toParams(values));
  useEffect(() => { document.title = name + ' G-code'; }, [name]);

  // Fold the settings column away to give the views more room; remembered between page loads.
  const firstSide = useRef(true);
  const toggleRef = useRef(null);
  useEffect(() => {
    const first = firstSide.current;
    firstSide.current = false;
    if (!first) {
      storeItem(KEY.side, sideCollapsed ? '1' : '0');
      toggleRef.current?.focus();      // the toggle moved, so keep keyboard focus on it
    }
    if (!first || sideCollapsed) window.dispatchEvent(new Event('resize'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideCollapsed]);

  // The run-time tile opened the time calculator: bring it into view.
  useEffect(() => {
    if (timeHidden || !flashTime.current) return;
    flashTime.current = false;
    const panel = timePanel.current;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    panel.classList.remove('flash'); void panel.offsetWidth; panel.classList.add('flash');
  }, [timeHidden]);

  function currentFileName() { return fileName.trim() || op.fileName(result.params); }

  useMachineProgram({
    gcode: ok ? result.gcode : '',
    fileName: ok ? currentFileName() : '',
    hint: 'Send loads this G-code into AXIS. The preview and drawings then follow the machine while it runs.',
    follow: true
  });

  function onTile(tid) {
    const e = engineRef.current;
    if (!ok || !e) return;
    if (tid === 'time') {
      const hide = !timeHidden;
      setTimeHidden(hide);
      storeItem(KEY.time, hide ? '0' : '1');
      if (!hide) flashTime.current = true;
      return;
    }
    const s = selected === tid ? null : tid;
    setSelected(s);
    e.selected = s;
    e.redraw2d();
  }

  function onShow(key, checked) {
    const e = engineRef.current, next = { ...shown, [key]: checked };
    setShown(next);
    storeItem(KEY.show, JSON.stringify(next));
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
    commit(params.toValues(op.DEFAULTS));
    fileNameEdited.current = false;
    update();
  }

  function openSetup() {
    const d = setupDialog.current;
    if (d.showModal) d.showModal(); else d.setAttribute('open', '');
  }

  const sideToggle = (
    <button type="button" ref={toggleRef} className={'side-toggle' + (sideCollapsed ? ' floating' : '')}
      aria-expanded={!sideCollapsed} title={sideCollapsed ? 'Show the settings' : 'Hide the settings'}
      onClick={() => setSideCollapsed(!sideCollapsed)}>
      {sideCollapsed ? '›' : '‹'}
    </button>
  );
  const form = { values, edit, setDefaults, shape: shapeKey ? values[shapeKey] : '', foldKey: KEY.fold };
  const ctx = { values, edit, result, ok, last: lastGood.current, locked: !!(result && result.params.feedAuto) };

  return (
    <FormContext.Provider value={form}>
      <SetupDialog ref={setupDialog}>{setup}</SetupDialog>

      <main className={'layout' + (sideCollapsed ? ' side-collapsed' : '')}>
        <div className="side">
          <header className="top">
            {!sideCollapsed && sideToggle}
            <h1 aria-describedby="about">{heading(values, edit)}</h1>
            <p id="about" role="tooltip">{about}</p>
            <nav className="menu" aria-label="Help">
              <button type="button" className="menu-item" aria-haspopup="dialog" title="Setting up the job" onClick={openSetup}>Job setup</button>
            </nav>
          </header>

          <Messages result={result} storeKey={KEY.warn} />

          <form id="settings" className="settings" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            {fields(ctx)}
            <button type="button" className="quiet" onClick={resetAll}>Set everything to default</button>
          </form>
        </div>

        <section className="results">
          <div className="views">
            <div className="tiles-block">
              <Tiles items={ok ? tiles(result, !timeHidden) : null} selected={selected} onSelect={onTile} />
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
                {topKey || 'Seen from above:'}
                <span className="key key-swept">cut so far</span>
                <span className="key key-cut">cutting moves</span>
                <span className="key key-finish">finish and feed moves</span>
              </figcaption>
            </figure>
            <figure className="view-section">
              <canvas ref={el.section} />
              <figcaption>{sectionCaption}</figcaption>
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

          <TimeCalc ref={timePanel} result={ok ? result : null} hidden={timeHidden} rows={timeRows} note={timeNote} />

          {extra && extra(ok ? result : null)}

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
