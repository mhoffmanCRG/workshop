import { useLayoutEffect, useRef } from 'react';
import { loadItem, storeItem } from '../lib/params.js';

const WARN_KEY = 'htd5m-warnings-open';

// Errors and warnings under the title. The user's open/closed choice is remembered for
// warnings; errors always open the list.
export default function Messages({ result }) {
  const box = useRef(null);
  const warningsOpen = useRef(loadItem(WARN_KEY, '1') !== '0');
  const settingOpen = useRef(false);     // true while the code, not the user, is toggling the list
  const errors = result ? result.errors : [], warnings = result ? result.warnings : [];
  const ne = errors.length, nw = warnings.length;

  useLayoutEffect(() => {
    const want = ne > 0 || warningsOpen.current;
    if (box.current && box.current.open !== want) {
      settingOpen.current = true;
      box.current.open = want;
      setTimeout(() => { settingOpen.current = false; }, 0);    // the toggle event arrives asynchronously
    }
  }, [result, ne]);

  const parts = [];
  if (ne) parts.push(ne + (ne === 1 ? ' error' : ' errors'));
  if (nw) parts.push(nw + (nw === 1 ? ' warning' : ' warnings'));

  return (
    <details ref={box} className={'messages-box' + (ne ? ' has-error' : '')} hidden={!ne && !nw}
      onToggle={() => {
        if (settingOpen.current || ne > 0) return;
        warningsOpen.current = box.current.open;
        storeItem(WARN_KEY, warningsOpen.current ? '1' : '0');
      }}>
      <summary>{parts.join(', ')}</summary>
      <div className="messages" aria-live="polite">
        {errors.map((t, i) => <p key={'e' + i} className="msg error">{t}</p>)}
        {warnings.map((t, i) => <p key={'w' + i} className="msg warn">{t}</p>)}
      </div>
    </details>
  );
}
