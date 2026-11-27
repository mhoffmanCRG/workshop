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

// A block with the face mill's passes across its top.
export function FacingIcon(props) {
  return (
    <Icon {...props}>
      <path d="M6 30l18-9 18 9-18 9z" />
      <path d="M6 30v6l18 9 18-9v-6" />
      <path d="M12 27l18 9M18 24l18 9" strokeWidth="1.25" strokeDasharray="3 2" />
      <path d="M24 4v11M19 15h10v4H19z" />
    </Icon>
  );
}

// A plate with a rounded pocket and the clearing loops inside it.
export function PocketIcon(props) {
  return (
    <Icon {...props}>
      <rect x="4" y="8" width="40" height="32" rx="2" />
      <rect x="11" y="14" width="26" height="20" rx="4" />
      <rect x="16" y="19" width="16" height="10" rx="1" strokeWidth="1.25" strokeDasharray="3 2" />
      <path d="M21 24h6" strokeWidth="1.25" />
    </Icon>
  );
}

// A part with the cutter's path running round it and a tab.
export function ProfileIcon(props) {
  return (
    <Icon {...props}>
      <rect x="12" y="13" width="24" height="22" rx="4" />
      <rect x="6" y="7" width="36" height="34" rx="9" strokeWidth="1.25" strokeDasharray="3 2" />
      <path d="M36 22h6v4h-6" strokeWidth="1.5" />
    </Icon>
  );
}

// A round hole with the helix going down inside it.
export function BoreIcon(props) {
  return (
    <Icon {...props}>
      <ellipse cx="24" cy="10" rx="14" ry="5" />
      <path d="M10 10v26M38 10v26" />
      <path d="M10 36a14 5 0 0 0 28 0" />
      <path d="M14 16c6 4 16 4 20 0M14 23c6 4 16 4 20 0M14 30c6 4 16 4 20 0" strokeWidth="1.25" />
    </Icon>
  );
}

// A plate with a grid of drilled holes.
export function DrillIcon(props) {
  const holes = [];
  [14, 24, 34].forEach((x) => [17, 31].forEach((y) => holes.push(<circle key={x + '-' + y} cx={x} cy={y} r="3" />)));
  return (
    <Icon {...props}>
      <rect x="5" y="9" width="38" height="30" rx="2" />
      {holes}
    </Icon>
  );
}

// A plate with a slot through it and its centre line.
export function SlotIcon(props) {
  return (
    <Icon {...props}>
      <rect x="4" y="10" width="40" height="28" rx="2" />
      <rect x="10" y="19" width="28" height="10" rx="5" />
      <path d="M15 24h18" strokeWidth="1.25" strokeDasharray="3 2" />
    </Icon>
  );
}
