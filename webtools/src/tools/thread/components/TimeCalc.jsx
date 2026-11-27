import { forwardRef } from 'react';
import { Num, DefaultButton } from '../../../shared/components/tool/Fields.jsx';

// Finer than the tile's duration: keeps seconds while they still matter.
function clock(minutes) {
  const s = Math.round(minutes * 60);
  if (s < 60) return s + ' s';
  if (s < 3600) return Math.floor(s / 60) + ' min ' + ('0' + s % 60).slice(-2) + ' s';
  return Math.floor(s / 3600) + ' h ' + ('0' + Math.floor(s % 3600 / 60)).slice(-2) + ' min';
}

function TimeTable({ r }) {
  if (!r || !r.gcode) return <table className="time-table" />;
  const s = r.stats, t = s.time, p = r.params, total = s.minutes;
  const mm = (v) => Math.round(v).toLocaleString() + ' mm';
  const rows = [
    ['Roughing passes', t.rough, mm(s.dist.rough)],
    ['Full-depth pass', t.finish, mm(s.dist.finish)],
    ['Spring passes', t.spring, mm(s.dist.spring)],
    ['Feed moves in and out', t.move, mm(s.dist.move)],
    ['Rapid moves', t.rapid, mm(s.dist.rapid)],
    ['Spindle start dwell', t.dwell, '']
  ].filter((row) => row[1] > 0 || row[0] === 'Rapid moves');
  return (
    <table className="time-table">
      <thead><tr><th>Part of the job</th><th>Distance</th><th>Time</th><th>Share</th></tr></thead>
      <tbody>
        {rows.map(([name, time, dist]) => {
          const share = total > 0 ? time / total * 100 : 0;
          return (
            <tr key={name}>
              <td>{name}</td><td>{dist}</td><td>{clock(time)}</td>
              <td className="share"><span className="bar" style={{ width: share.toFixed(1) + '%' }} title={share.toFixed(0) + '%'} /></td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr><td>One part</td><td /><td>{clock(total)}</td><td /></tr>
        {s.holes > 1 && <tr className="sub"><td>Average per thread</td><td /><td>{clock((total - t.dwell) / s.holes)}</td><td /></tr>}
        {p.quantity > 1 && <tr><td>{p.quantity} parts</td><td /><td>{clock(total * p.quantity)}</td><td /></tr>}
      </tfoot>
    </table>
  );
}

const TIME_FIELDS = ['feedOverride', 'rapidRate', 'quantity'];

const TimeCalc = forwardRef(function TimeCalc({ result, hidden }, ref) {
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
        <TimeTable r={result} />
      </div>
      <p className="hint">Times use the programmed feeds at constant speed. Acceleration, tool changes and loading the part are not included, so real runs take a little longer. Feed override scales feed moves only and does not change the G-code.</p>
    </section>
  );
});

export default TimeCalc;
