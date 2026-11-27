import {
  GearIcon, ThreadIcon, PcdIcon, KeywayIcon, FacingIcon, PocketIcon, ProfileIcon, BoreIcon, DrillIcon, SlotIcon
} from './shared/icons.jsx';

/*
 * The tools on the landing page, in the order shown.
 *
 * A tool with `href` is live: its page is <id>/index.html, which loads src/tools/<id>/main.jsx,
 * and it must also be listed under build.rollupOptions.input in vite.config.js.
 * A tool without `href` is a placeholder tile marked "Coming soon".
 *
 * `machines` lists the machine kinds a tool is for ('mill', 'lathe'); `needs` the axes it drives
 * beyond the machine's usual ones (Gear turns the A axis). Pages show only the tools that suit the
 * machine (shared/machineKind.js).
 */
export const TOOLS = [
  { id: 'gear', title: 'Gear', description: 'Timing pulley grooves on the 4th axis', icon: GearIcon, href: 'gear/', machines: ['mill'], needs: 'A' },
  { id: 'thread', title: 'Threading', description: 'Thread milling, inside and outside', icon: ThreadIcon, href: 'thread/', machines: ['mill'] },
  { id: 'pcd', title: 'PCD', description: 'Holes on a pitch circle', icon: PcdIcon, href: 'pcd/', machines: ['mill'] },
  { id: 'keyway', title: 'Keyway', description: 'Slotting an internal keyway', icon: KeywayIcon, href: 'keyway/', machines: ['mill'] },
  { id: 'facing', title: 'Facing', description: 'Skim the top of a block flat', icon: FacingIcon, href: 'facing/', machines: ['mill'] },
  { id: 'pocket', title: 'Pocket', description: 'Rectangular and round pockets', icon: PocketIcon, href: 'pocket/', machines: ['mill'] },
  { id: 'profile', title: 'Profile', description: 'Cut round a shape, with tabs', icon: ProfileIcon, href: 'profile/', machines: ['mill'] },
  { id: 'bore', title: 'Bore', description: 'Helix-mill holes to size', icon: BoreIcon, href: 'bore/', machines: ['mill'] },
  { id: 'drill', title: 'Drilling', description: 'Grids and rows of holes', icon: DrillIcon, href: 'drill/', machines: ['mill'] },
  { id: 'slot', title: 'Slot', description: 'Straight slots at any angle', icon: SlotIcon, href: 'slot/', machines: ['mill'] }
];

export function toolById(id) {
  return TOOLS.find((t) => t.id === id) || null;
}
