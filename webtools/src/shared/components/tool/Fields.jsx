import { createContext, useContext } from 'react';
import { loadJSON, storeItem } from '../../storage.js';

/*
 * Settings form pieces shared by the tool pages: number boxes, selects, check boxes and folding
 * sections, all bound to one form through FormContext.
 *
 * Form context: { values, edit(name, value), setDefaults(names), shape, foldKey }
 *   shape    the page's current variant; a field with shape="a b" shows only while it is a or b
 *   foldKey  storage key under which the page remembers which sections are folded
 */
export const FormContext = createContext(null);
const useForm = () => useContext(FormContext);

function hiddenFor(shape, current) {
  return shape ? shape.split(' ').indexOf(current) === -1 : false;
}

function Unit({ unit }) {
  return unit ? <> <span className="unit">{unit}</span></> : null;
}

export function Num({ name, label, unit, shape, disabled, ...attrs }) {
  const f = useForm();
  return (
    <label hidden={hiddenFor(shape, f.shape)}>
      {label}<Unit unit={unit} />{' '}
      <input type="number" name={name} value={f.values[name] ?? ''} disabled={disabled}
        onChange={(e) => f.edit(name, e.target.value)} {...attrs} />
    </label>
  );
}

// options: [[value, text], ...]
export function Sel({ name, label, options, shape }) {
  const f = useForm();
  return (
    <label hidden={hiddenFor(shape, f.shape)}>
      {label}{' '}
      <select name={name} value={f.values[name] ?? ''} onChange={(e) => f.edit(name, e.target.value)}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
}

// A free-text setting on its own line under its label (lists, notes).
export function Text({ name, label, shape, placeholder }) {
  const f = useForm();
  return (
    <label className="text-field" hidden={hiddenFor(shape, f.shape)}>
      {label}
      <input type="text" name={name} value={f.values[name] ?? ''} placeholder={placeholder} spellCheck={false}
        onChange={(e) => f.edit(name, e.target.value)} />
    </label>
  );
}

export function Check({ name, children, shape }) {
  const f = useForm();
  return (
    <label className="check" hidden={hiddenFor(shape, f.shape)}>
      <input type="checkbox" name={name} checked={!!f.values[name]} onChange={(e) => f.edit(name, e.target.checked)} />{' '}
      {children}
    </label>
  );
}

export function DefaultButton({ names }) {
  const f = useForm();
  return <button type="button" className="quiet section-default" onClick={() => f.setDefaults(names)}>Set to default</button>;
}

// Which settings sections are folded, per page (foldKey), remembered between page loads.
const foldSets = {};
function foldedFor(key) {
  if (!foldSets[key]) {
    const v = loadJSON(key, []);
    foldSets[key] = new Set(Array.isArray(v) ? v : []);
  }
  return foldSets[key];
}

export function Section({ title, names, children }) {
  const f = useForm();
  const key = f.foldKey || 'tool-collapsed', folded = foldedFor(key);
  return (
    <details className="section" open={!folded.has(title)}
      onToggle={(e) => {
        if (e.currentTarget.open) folded.delete(title); else folded.add(title);
        storeItem(key, JSON.stringify([...folded]));
      }}>
      <summary>{title}</summary>
      <div className="section-body">
        {children}
        <DefaultButton names={names} />
      </div>
    </details>
  );
}
