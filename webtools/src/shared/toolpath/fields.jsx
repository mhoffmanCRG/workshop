import { forwardRef } from 'react';
import { Num, Sel, Check, Section, DefaultButton } from '../components/tool/Fields.jsx';
import { MATERIAL_OPTIONS, feedInfo } from './cutting.js';

/*
 * Settings sections and panels every toolpath page shares. `ctx` is what ToolPage hands the page's
 * fields function: { values, result, ok, last (last good result), locked (feeds set from the material) }.
 */

export function CutterSection({ ctx, toolLabel = 'End mill diameter', children }) {
  return (
    <Section title="Tool" names={['toolDia', 'flutes', 'material', 'rpm', 'feedAuto', 'feed', 'plungeFeed']}>
      <Num name="toolDia" label={toolLabel} unit="mm" min="0" step="0.5" />
      <Num name="flutes" label="Flutes" min="1" max="12" step="1" />
      <Sel name="material" label="Material" options={MATERIAL_OPTIONS} />
      <Num name="rpm" label="Spindle speed" unit="rpm" min="0" step="100" />
      <Check name="feedAuto">Set the feeds from the material</Check>
      <Num name="feed" label="Feed" unit="mm/min" min="0" step="10" disabled={ctx.locked} />
      <Num name="plungeFeed" label="Plunge feed" unit="mm/min" min="0" step="5" disabled={ctx.locked} />
      {children}
      <p className="hint">{feedInfo(ctx.ok ? ctx.result : ctx.last)}</p>
    </Section>
  );
}

export function ProgramSection() {
  return (
    <Section title="Program" names={['wcs', 'dwell', 'toolChange', 'toolNumber', 'coolant']}>
      <Sel name="wcs" label="Work offset" options={[['', 'None'], ...['G54', 'G55', 'G56', 'G57', 'G58', 'G59'].map((w) => [w, w])]} />
      <Num name="dwell" label="Spindle start dwell" unit="s" min="0" step="0.5" />
      <Check name="toolChange">Tool change and length offset (T, M6, G43)</Check>
      <Num name="toolNumber" label="Tool number" min="1" max="99" step="1" />
      <Sel name="coolant" label="Coolant" options={[['off', 'Off'], ['flood', 'Flood (M8)'], ['mist', 'Mist (M7)']]} />
    </Section>
  );
}

// "Setting up the job", opened as a modal from the title bar.
export const SetupDialog = forwardRef(function SetupDialog({ children }, ref) {
  const close = () => { if (ref.current?.close) ref.current.close(); else ref.current?.removeAttribute('open'); };
  return (
    <dialog ref={ref} className="modal" aria-labelledby="setupTitle"
      // a click on the dimmed area outside the box closes it
      onClick={(e) => { if (e.target === ref.current) close(); }}>
      <div className="modal-head">
        <h2 id="setupTitle">Setting up the job</h2>
        <button type="button" className="quiet" aria-label="Close" onClick={close}>Close</button>
      </div>
      {children}
    </dialog>
  );
});

// Finer than the tile's duration: keeps seconds while they still matter.
function clock(minutes) {
  const s = Math.round(minutes * 60);
  if (s < 60) return s + ' s';
  if (s < 3600) return Math.floor(s / 60) + ' min ' + ('0' + s % 60).slice(-2) + ' s';
  return Math.floor(s / 3600) + ' h ' + ('0' + Math.floor(s % 3600 / 60)).slice(-2) + ' min';
}

/** rows: [[bucket, label]] in table order; per: { word, count } for an "Average per ..." line. */
function TimeTable({ r, rows }) {
  if (!r || !r.gcode) return <table className="time-table" />;
  const s = r.stats, t = s.time, p = r.params, total = s.minutes;
  const mm = (v) => (v ? Math.round(v).toLocaleString() + ' mm' : '');
  const shown = rows.concat([['rapid', 'Rapid moves'], ['dwell', 'Spindle start dwell']])
    .filter(([k]) => (t[k] || 0) > 0 || k === 'rapid');
  const per = s.per;
  return (
    <table className="time-table">
      <thead><tr><th>Part of the job</th><th>Distance</th><th>Time</th><th>Share</th></tr></thead>
      <tbody>
        {shown.map(([k, name]) => {
          const time = t[k] || 0, share = total > 0 ? time / total * 100 : 0;
          return (
            <tr key={k}>
              <td>{name}</td><td>{mm(s.dist[k])}</td><td>{clock(time)}</td>
              <td className="share"><span className="bar" style={{ width: share.toFixed(1) + '%' }} title={share.toFixed(0) + '%'} /></td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr><td>One part</td><td /><td>{clock(total)}</td><td /></tr>
        {per && per.count > 1 && <tr className="sub"><td>Average per {per.word}</td><td /><td>{clock((total - (t.dwell || 0)) / per.count)}</td><td /></tr>}
        {p.quantity > 1 && <tr><td>{p.quantity} parts</td><td /><td>{clock(total * p.quantity)}</td><td /></tr>}
      </tfoot>
    </table>
  );
}

const TIME_FIELDS = ['feedOverride', 'rapidRate', 'quantity'];

export const TimeCalc = forwardRef(function TimeCalc({ result, hidden, rows, note }, ref) {
  return (
    <section ref={ref} className="panel timecalc" id="timecalc" hidden={hidden}>
      <h2>Time calculator</h2>
      <div className="time-grid">
        <div className="time-inputs">
          <Num name="feedOverride" label="Feed override" unit="%" min="1" max="300" step="5" />
          <Num name="rapidRate" label="Rapid rate" unit="mm/min" min="0" step="100" />
          <Num name="quantity" label="Parts to make" min="1" step="1" />
          <DefaultButton names={TIME_FIELDS} />
        </div>
        <TimeTable r={result} rows={rows} />
      </div>
      <p className="hint">Times use the programmed feeds at constant speed. Acceleration, tool changes and loading the part are not included, so real runs take a little longer, most of all on short moves. Feed override scales feed moves only and does not change the G-code.{note ? ' ' + note : ''}</p>
    </section>
  );
});
