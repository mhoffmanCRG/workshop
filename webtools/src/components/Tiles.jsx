function duration(minutes) {
  const m = Math.round(minutes);
  return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
}

// Summary tiles. Click one to show it on the drawings; the run-time tile opens the time calculator.
export default function Tiles({ result, selected, timeShown, onSelect }) {
  if (!result || !result.gcode) return <div className="tiles" />;
  const g = result.geom, s = result.stats;
  const tiles = [
    ['od', 'Turn stock to', g.OD.toFixed(3), 'mm', true],
    ['pd', 'Pitch diameter', g.PD.toFixed(3), 'mm'],
    ['root', 'Root diameter', g.rootDia.toFixed(3), 'mm'],
    ['index', 'Index per tooth', g.indexDeg.toFixed(4) + '°', ''],
    ['width', 'Groove width at OD', g.grooveWidth.toFixed(2), 'mm'],
    ['land', 'Land between grooves', g.landWidth.toFixed(2), 'mm'],
    ['passes', 'Rough + finish passes', s.roughPasses + ' + ' + s.finishPasses, ''],
    ['scallop', 'Largest scallop', (s.maxExcess * 1000).toFixed(1), 'µm'],
    ['radius', 'Average cutting radius', (s.meanCutRadius * 100).toFixed(0), '% of cutter'],
    ['time', 'Estimated run time', duration(s.minutes), '']
  ];
  return (
    <div className="tiles">
      {tiles.map(([id, label, value, unit, key]) => (
        <button key={id} type="button" className={'tile' + (key ? ' key-tile' : '')} data-tile={id}
          aria-pressed={id === 'time' ? timeShown : selected === id}
          aria-controls={id === 'time' ? 'timecalc' : undefined}
          onClick={() => onSelect(id)}>
          <span className="tile-label">{label}</span>
          <span className="tile-value">{value}{unit ? <small>{unit}</small> : null}</span>
        </button>
      ))}
    </div>
  );
}
