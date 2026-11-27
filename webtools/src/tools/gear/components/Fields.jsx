import { createContext, useContext } from 'react';
import { loadJSON, storeItem } from '../lib/params.js';

/* Form context: { values, edit(name, value), setDefaults(names), shape } */
export const FormContext = createContext(null);
const useForm = () => useContext(FormContext);

// Settings that only some groove shapes use carry shape="round trapezoid" etc.
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

export function Check({ name, children }) {
  const f = useForm();
  return (
    <label className="check">
      <input type="checkbox" name={name} checked={!!f.values[name]} onChange={(e) => f.edit(name, e.target.checked)} />{' '}
      {children}
    </label>
  );
}

export function DefaultButton({ names }) {
  const f = useForm();
  return <button type="button" className="quiet section-default" onClick={() => f.setDefaults(names)}>Set to default</button>;
}

// Which settings sections are collapsed, remembered between page loads.
const FOLD_KEY = 'htd5m-collapsed';
const folded = new Set((() => { const v = loadJSON(FOLD_KEY, []); return Array.isArray(v) ? v : []; })());

export function Section({ title, names, children }) {
  return (
    <details className="section" open={!folded.has(title)}
      onToggle={(e) => {
        if (e.currentTarget.open) folded.delete(title); else folded.add(title);
        storeItem(FOLD_KEY, JSON.stringify([...folded]));
      }}>
      <summary>{title}</summary>
      <div className="section-body">
        {children}
        <DefaultButton names={names} />
      </div>
    </details>
  );
}
