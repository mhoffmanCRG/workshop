/*
 * Which machine the pages are for (mill or lathe, and its axes), so each page shows only the tools
 * that suit it.
 *
 * In the AXIS Tools tab, web_tab.py sets window.linuxcncMachine = {kind, axes} from the LinuxCNC INI
 * before any script runs, and that decides. In a normal browser there is no machine: the landing page
 * offers All / Mill / Lathe, remembered in this browser, and ?machine=mill|lathe|all in the URL picks
 * one too. Until something is picked every tool is shown.
 */
import { useSyncExternalStore } from 'react';
import { loadItem, storeItem } from './storage.js';

export const KINDS = { mill: 'Mill', lathe: 'Lathe' };
const STORE_KEY = 'machine-kind';

function fromLinuxcnc() {
  const m = typeof window !== 'undefined' && window.linuxcncMachine;
  if (!m || !KINDS[m.kind]) return null;
  return { kind: m.kind, axes: typeof m.axes === 'string' ? m.axes.toUpperCase() : '', from: 'linuxcnc' };
}

function chosen() {
  let pick = null;
  try { pick = new URLSearchParams(window.location.search).get('machine'); } catch (e) { /* no URL */ }
  if (pick === 'all' || KINDS[pick]) storeItem(STORE_KEY, pick);
  else pick = loadItem(STORE_KEY, 'all');
  return { kind: KINDS[pick] ? pick : null, axes: '', from: 'chosen' };
}

let current = fromLinuxcnc() || chosen();
const listeners = new Set();

/** {kind: 'mill' | 'lathe' | null (any), axes: 'XYZA' or '' (not known), from: 'linuxcnc' | 'chosen'} */
export function getMachineKind() { return current; }

/** Pick the machine in a normal browser (null = all). Ignored when LinuxCNC says what it is. */
export function chooseMachineKind(kind) {
  if (current.from === 'linuxcnc') return;
  storeItem(STORE_KEY, KINDS[kind] ? kind : 'all');
  current = { kind: KINDS[kind] ? kind : null, axes: '', from: 'chosen' };
  listeners.forEach((fn) => fn());
}

export function useMachineKind() {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, getMachineKind);
}

/**
 * Why a tool does not suit the machine, or '' if it does (or nothing is known).
 * tool.machines lists the kinds it is for; tool.needs the axis letters it drives besides the usual.
 */
export function unsuitable(tool, m = current) {
  if (!tool || !m.kind) return '';
  if (tool.machines && tool.machines.indexOf(m.kind) < 0) {
    return tool.title + ' is a ' + tool.machines.map((k) => KINDS[k].toLowerCase()).join(' or ') + ' tool, and this machine is a ' + m.kind + '.';
  }
  const missing = m.axes ? (tool.needs || '').split('').filter((a) => m.axes.indexOf(a) < 0) : [];
  if (missing.length) return tool.title + ' needs the ' + missing.join(', ') + ' axis, which this machine does not have.';
  return '';
}
