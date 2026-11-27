import SharedTiles, { duration } from '../../../shared/components/tool/Tiles.jsx';

// Summary tiles. Click one to show it on the drawings; the run-time tile opens the time calculator.
export default function Tiles({ result, selected, timeShown, onSelect }) {
  if (!result || !result.gcode) return <SharedTiles items={null} />;
  const g = result.geom, s = result.stats;
  const items = [
    { id: 'od', label: 'Turn stock to', value: g.OD.toFixed(3), unit: 'mm', key: true },
    { id: 'pd', label: 'Pitch diameter', value: g.PD.toFixed(3), unit: 'mm' },
    { id: 'root', label: 'Root diameter', value: g.rootDia.toFixed(3), unit: 'mm' },
    { id: 'index', label: 'Index per tooth', value: g.indexDeg.toFixed(4) + '°' },
    { id: 'width', label: 'Groove width at OD', value: g.grooveWidth.toFixed(2), unit: 'mm' },
    { id: 'land', label: 'Land between grooves', value: g.landWidth.toFixed(2), unit: 'mm' },
    { id: 'passes', label: 'Rough + finish passes', value: s.roughPasses + ' + ' + s.finishPasses },
    { id: 'scallop', label: 'Largest scallop', value: (s.maxExcess * 1000).toFixed(1), unit: 'µm' },
    { id: 'radius', label: 'Average cutting radius', value: (s.meanCutRadius * 100).toFixed(0), unit: '% of cutter' },
    { id: 'time', label: 'Estimated run time', value: duration(s.minutes), pressed: timeShown, controls: 'timecalc' }
  ];
  return <SharedTiles items={items} selected={selected} onSelect={onSelect} />;
}
