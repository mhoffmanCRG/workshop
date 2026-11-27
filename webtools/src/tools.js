import { GearIcon, ThreadIcon, PcdIcon, KeywayIcon } from './shared/icons.jsx';

/*
 * The tools on the landing page, in the order shown.
 *
 * A tool with `href` is live: its page is <id>/index.html, which loads src/tools/<id>/main.jsx,
 * and it must also be listed under build.rollupOptions.input in vite.config.js.
 * A tool without `href` is a placeholder tile marked "Coming soon".
 */
export const TOOLS = [
  { id: 'gear', title: 'Gear', description: 'Timing pulley grooves on the 4th axis', icon: GearIcon, href: 'gear/' },
  { id: 'thread', title: 'Threading', description: 'Thread milling, inside and outside', icon: ThreadIcon, href: 'thread/' },
  { id: 'pcd', title: 'PCD', description: 'Holes on a pitch circle', icon: PcdIcon, href: 'pcd/' },
  { id: 'keyway', title: 'Keyway', description: 'Slotting an internal keyway', icon: KeywayIcon, href: 'keyway/' }
];
