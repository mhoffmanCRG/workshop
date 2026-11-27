/*
 * Development-only stand-in for web_tab.py, so the LinuxCNC layer can be tried in a normal
 * browser: open any page with ?mock-linuxcnc under `npm run dev`
 * (for example http://localhost:5173/gear/?mock-linuxcnc).
 *
 * It fakes window.webkit.messageHandlers.linuxcnc with a machine that is on and homed, runs a
 * sent program at about 50 lines a second (taking the position from its X/Y/Z/A words), and
 * draws what the AXIS toolbar would show as a strip along the bottom of the page.
 * shared/mount.jsx only calls it when import.meta.env.DEV, so it is never in the build.
 */
const BUTTONS = [['send', 'Send to LinuxCNC', 'canSend'], ['run', 'Cycle start', 'canRun'], ['pause', 'Pause', 'canPause'], ['stop', 'Stop', null]];

export function installMock() {
  const st = { task: 'on', interp: 'idle', mode: 'manual', paused: false, homed: true, file: '', line: 0,
    pos: { X: 0, Y: 0, Z: 10, A: 0 }, feedOverride: 1, vel: 0, spindle: 0 };
  const files = {};
  let lines = [], timer = null;

  const reply = (id, ok, message, extra) =>
    setTimeout(() => window.linuxcncReply && window.linuxcncReply(id, ok, message || '', extra || {}), 50);
  const push = () => window.linuxcncStatus && window.linuxcncStatus(JSON.parse(JSON.stringify(st)));

  function finish() {
    clearInterval(timer);
    timer = null;
    Object.assign(st, { interp: 'idle', mode: 'manual', paused: false, vel: 0, spindle: 0 });
  }
  function tick() {
    if (st.paused) return;
    for (let n = 0; n < 5 && st.line < lines.length; n++) {
      const text = lines[st.line].replace(/\(.*?\)|;.*/g, '');
      text.replace(/([XYZA])\s*(-?\d*\.?\d+)/gi, (_, k, v) => { st.pos[k.toUpperCase()] = Number(v); return ''; });
      st.line++;                                  // motion_line is 1-based: the line just reached
    }
    Object.assign(st, { vel: 250, spindle: 8000 });
    if (st.line >= lines.length) finish();
    push();
  }

  const cmds = {
    status(m) { reply(m.id, true); push(); },
    load(m) {
      if (st.interp !== 'idle') return reply(m.id, false, 'LinuxCNC is running a program. Stop it before sending a new one.');
      const path = '/mock/nc/' + m.name;
      if (files[path] !== undefined && files[path] !== m.gcode && !m.overwrite) {
        return reply(m.id, false, path + ' already exists with different contents.', { exists: true, path });
      }
      files[path] = m.gcode;
      st.file = path;
      push();
      reply(m.id, true, 'Loaded ' + path + ' in AXIS (mock).', { path });
    },
    run(m) {
      if (st.interp !== 'idle') return reply(m.id, false, 'LinuxCNC is already running a program.');
      if (m.path !== st.file) return reply(m.id, false, 'AXIS has a different file loaded (' + st.file + '). Send the program again.');
      lines = files[st.file].split('\n');
      Object.assign(st, { line: 0, interp: 'reading', mode: 'auto', paused: false });
      timer = setInterval(tick, 100);
      push();
      reply(m.id, true, 'Program started.');
    },
    pause(m) { Object.assign(st, { paused: true, interp: 'paused', vel: 0 }); push(); reply(m.id, true, 'Paused.'); },
    resume(m) { Object.assign(st, { paused: false, interp: 'reading' }); push(); reply(m.id, true, 'Resumed.'); },
    stop(m) { finish(); push(); reply(m.id, true, 'Stopped.'); },
    ui(m) { drawToolbar(m); }
  };

  window.webkit = window.webkit || {};
  window.webkit.messageHandlers = {
    linuxcnc: {
      postMessage(text) {
        const m = JSON.parse(text);
        (cmds[m.cmd] || ((x) => reply(x.id, false, 'Unknown command.')))(m);
      }
    }
  };
}

// The AXIS toolbar's machine section (web_tab.py MachineBar), drawn from the page's "ui" messages.
let bar = null;
function drawToolbar(ui) {
  if (!bar) {
    bar = document.createElement('div');
    bar.setAttribute('data-mock-toolbar', '');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:1000;display:flex;align-items:center;gap:8px;' +
      'padding:5px 10px;font:12px system-ui,sans-serif;background:#0b0e12;color:#e4e9f0;border-top:2px dashed #c79a1a';
    document.body.appendChild(bar);
    document.body.style.paddingBottom = '44px';
  }
  bar.replaceChildren();
  const add = (el) => { bar.appendChild(el); return el; };
  const label = add(document.createElement('b'));
  label.textContent = 'MOCK';
  label.style.color = '#c79a1a';
  const show = new Set(ui.controls || BUTTONS.map((b) => b[0]).concat('follow'));
  if (ui.state) {
    const s = add(document.createElement('span'));
    s.textContent = ui.state;
    s.style.color = { ok: '#55d47c', warn: '#c79a1a', bad: '#e0584c' }[ui.stateClass] || '';
  }
  const dro = add(document.createElement('code'));
  dro.textContent = (ui.dro || []).map(([k, v]) => k + ' ' + v).join('  ');
  BUTTONS.forEach(([action, text, can]) => {
    if (!show.has(action)) return;
    const b = add(document.createElement('button'));
    b.type = 'button';
    b.textContent = action === 'pause' && ui.paused ? 'Resume' : text;
    b.disabled = can ? !ui[can] : false;
    if (action === 'run' && ui.runTitle) b.title = ui.runTitle;
    b.style.cssText = 'padding:2px 8px;font-size:12px';
    b.onclick = () => window.linuxcncToolbar && window.linuxcncToolbar(action, null);
  });
  if (show.has('follow')) {
    const l = add(document.createElement('label'));
    const c = document.createElement('input');
    c.type = 'checkbox';
    c.checked = !!ui.follow;
    c.onchange = () => window.linuxcncToolbar && window.linuxcncToolbar('follow', c.checked);
    l.append(c, ' Show machine');
    l.style.cssText = 'display:inline-flex;gap:4px;min-height:0';
  }
  const info = add(document.createElement('span'));
  info.textContent = ui.info || '';
  info.style.cssText = 'flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#9aa5b5';
}
