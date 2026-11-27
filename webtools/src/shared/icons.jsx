/*
 * Line icons for the tool suite, drawn on a 48 × 48 grid in the current text colour, so CSS sets
 * their colour and size. They are decorative (the text next to them names the tool), so they are
 * hidden from screen readers.
 */
function Icon({ children, ...props }) {
  return (
    <svg viewBox="0 0 48 48" width="48" height="48" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {children}
    </svg>
  );
}

// Outline of a toothed wheel: `teeth` trapezoid teeth between radius rIn and rOut, around 24, 24.
function gearOutline(teeth, rIn, rOut) {
  const step = (2 * Math.PI) / teeth, pts = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step;
    [[rIn, -0.27], [rOut, -0.14], [rOut, 0.14], [rIn, 0.27]].forEach(([r, f]) => {
      const t = a + f * step;
      pts.push((24 + r * Math.sin(t)).toFixed(2) + ' ' + (24 - r * Math.cos(t)).toFixed(2));
    });
  }
  return 'M' + pts.join('L') + 'Z';
}
const GEAR = gearOutline(14, 15.5, 20.5);

export function GearIcon(props) {
  return (
    <Icon {...props}>
      <path d={GEAR} />
      <circle cx="24" cy="24" r="6" />
    </Icon>
  );
}

// A bolt seen from the side: hex head and a threaded shank.
export function ThreadIcon(props) {
  const threads = [];
  for (let y = 17; y <= 41; y += 4) threads.push(<path key={y} d={`M18 ${y + 2}L30 ${y}`} />);
  return (
    <Icon {...props}>
      <path d="M13 5h22v8H13z" />
      <path d="M20.5 5v8M27.5 5v8" />
      <path d="M18 13v30M30 13v30M18 43h12" />
      {threads}
    </Icon>
  );
}

// A milling machine: head, spindle and cutter over a part on the table.
export function MachineIcon(props) {
  return (
    <Icon {...props}>
      <path d="M13 4h22v12H13z" />
      <path d="M20 16v5h8v-5" />
      <path d="M24 21v8" />
      <path d="M14 33h20v5H14z" />
      <path d="M6 41h36" />
    </Icon>
  );
}

// A flange with holes on a pitch circle: outline, dashed pitch circle, six holes and a centre mark.
export function PcdIcon(props) {
  const holes = [];
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3;
    holes.push(<circle key={i} cx={(24 + 13 * Math.sin(a)).toFixed(2)} cy={(24 - 13 * Math.cos(a)).toFixed(2)} r="3" />);
  }
  return (
    <Icon {...props}>
      <circle cx="24" cy="24" r="21" />
      <circle cx="24" cy="24" r="13" strokeDasharray="3 3" strokeWidth="1.25" />
      {holes}
      <path d="M21 24h6M24 21v6" strokeWidth="1.25" />
    </Icon>
  );
}

export function KeywayIcon(props) {
  // a hub with a bore and one keyway cut into its top
  return (
    <Icon {...props}>
      <circle cx="24" cy="24" r="21" />
      <path d="M20.5 11.5 A13 13 0 1 0 27.5 11.5 V8 H20.5 Z" />
      <path d="M21 24h6M24 21v6" strokeWidth="1.25" />
    </Icon>
  );
}
