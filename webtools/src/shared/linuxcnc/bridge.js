/*
 * Layer 1 of the LinuxCNC link: the transport to the AXIS "Tools" tab
 * (linuxcnc/mill/python/web_tab.py). Nothing else in the app talks to web_tab.py directly.
 *
 * web_tab.py provides window.webkit.messageHandlers.linuxcnc when LinuxCNC is running, and calls
 * back into the page through three globals:
 *   window.linuxcncReply(id, ok, message, extra)   answer to a request
 *   window.linuxcncStatus(status)                  machine status, ~10 times a second when it changes
 *   window.linuxcncToolbar(action, arg)            a button in the tab's GTK toolbar was pressed
 * Outside AXIS (a normal browser) there is no handler and every request answers "Not connected".
 */

function handler() {
  const w = window.webkit;
  return w && w.messageHandlers && w.messageHandlers.linuxcnc;
}

export function bridgeAvailable() {
  return !!handler();
}

let connected = false;
let nextId = 1;
let lastUi = '';
const pending = {};

/** Install the callbacks once. Returns false when there is no LinuxCNC to talk to. */
export function connect({ status, toolbar }) {
  if (connected) return true;
  if (!handler()) return false;
  connected = true;
  window.linuxcncReply = (id, ok, message, extra) => {
    const done = pending[id];
    delete pending[id];
    if (done) done({ ok: !!ok, message: message || '', extra: extra || {} });
  };
  window.linuxcncStatus = (st) => status(st);
  window.linuxcncToolbar = (action, arg) => toolbar(action, arg);
  // status is only pushed when it changes, and the push at page load can beat these callbacks
  request('status');
  return true;
}

/** Send a command; resolves with {ok, message, extra}. */
export function request(cmd, args) {
  const h = handler();
  if (!h) return Promise.resolve({ ok: false, message: 'Not connected to LinuxCNC.', extra: {} });
  const id = nextId++;
  return new Promise((resolve) => {
    pending[id] = resolve;
    h.postMessage(JSON.stringify({ id, cmd, ...(args || {}) }));
  });
}

/** Tell the GTK toolbar what to show. Only sent when it changes (status arrives 10 times a second). */
export function showToolbar(ui) {
  const h = handler();
  if (!h) return;
  const text = JSON.stringify(ui);
  if (text === lastUi) return;
  lastUi = text;
  h.postMessage(JSON.stringify({ cmd: 'ui', ...ui }));
}
