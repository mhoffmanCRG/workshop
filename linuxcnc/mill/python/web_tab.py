#!/usr/bin/env python3
"""Embed a web page in an AXIS tab, with a small bridge to LinuxCNC.

Usage (in the INI [DISPLAY] section):
    EMBED_TAB_NAME    = Tools
    EMBED_TAB_COMMAND = python3 python/web_tab.py {XID} https://example.com

Pages served from the same origin as URL can talk to LinuxCNC:
    window.webkit.messageHandlers.linuxcnc.postMessage(JSON.stringify({id, cmd, ...}))
      cmd "load"   {name, gcode, overwrite}  write to PROGRAM_PREFIX and open it in AXIS
      cmd "run" | "pause" | "resume" | "stop"
    The page receives replies via window.linuxcncReply(id, ok, message, extra)
    and machine status about 10 times a second via window.linuxcncStatus(status).
"""
import json
import os
import re
import subprocess
import sys
import threading
from urllib.parse import urlsplit

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, GLib, Gtk, WebKit2

# Ubuntu's apport excepthook can block for ~15 s per exception; see probe_screen.py.
sys.excepthook = sys.__excepthook__

AXES = "XYZABCUVW"
TASK_STATES = {1: "estop", 2: "estop-reset", 3: "off", 4: "on"}
INTERP_STATES = {1: "idle", 2: "reading", 3: "paused", 4: "waiting"}
TASK_MODES = {1: "manual", 2: "auto", 3: "mdi"}


def origin(url):
    u = urlsplit(url)
    return (u.scheme, u.netloc)


def program_dir():
    """PROGRAM_PREFIX from the INI, else ~/linuxcnc/nc_files."""
    ini_path = os.environ.get("INI_FILE_NAME")
    if ini_path:
        try:
            import linuxcnc
            prefix = linuxcnc.ini(ini_path).find("DISPLAY", "PROGRAM_PREFIX")
            if prefix:
                return os.path.expanduser(prefix)
        except Exception:
            pass
    return os.path.expanduser("~/linuxcnc/nc_files")


class Bridge:
    """Carries commands from the page to LinuxCNC and status back to the page."""

    def __init__(self, view, url):
        self.view = view
        self.origin = origin(url)
        self.last = None
        try:
            import linuxcnc
            self.lc = linuxcnc
            self.stat = linuxcnc.stat()
            self.cmd = linuxcnc.command()
        except Exception as e:  # LinuxCNC not running: the page still works, minus the bridge
            print("web_tab: no LinuxCNC connection:", e, file=sys.stderr)
            self.lc = None
            return
        ucm = view.get_user_content_manager()
        ucm.connect("script-message-received::linuxcnc", self.on_message)
        ucm.register_script_message_handler("linuxcnc")
        # status is only pushed when it changes, so a freshly (re)loaded page needs a full copy
        view.connect("load-changed", self.on_load)
        GLib.timeout_add(100, self.push_status)

    def on_load(self, _view, event):
        if event == WebKit2.LoadEvent.FINISHED:
            self.last = None

    # ---------------------------------------------------------------- page I/O

    def js(self, script):
        if hasattr(self.view, "evaluate_javascript"):
            self.view.evaluate_javascript(script, -1, None, None, None, None, None)
        else:
            self.view.run_javascript(script, None, None, None)

    def reply(self, rid, ok, message="", extra=None):
        self.js("window.linuxcncReply && window.linuxcncReply(%s, %s, %s, %s)" % (
            json.dumps(rid), json.dumps(bool(ok)), json.dumps(message), json.dumps(extra or {})))

    def trusted(self):
        uri = self.view.get_uri() or ""
        return origin(uri) == self.origin

    # ---------------------------------------------------------------- status

    def status(self):
        s = self.stat
        s.poll()
        pos = {}
        for i, letter in enumerate(AXES):
            if s.axis_mask & (1 << i):
                work = s.actual_position[i] - s.g5x_offset[i] - s.g92_offset[i] - s.tool_offset[i]
                pos[letter] = round(work, 4)
        return {
            "task": TASK_STATES.get(s.task_state, str(s.task_state)),
            "interp": INTERP_STATES.get(s.interp_state, str(s.interp_state)),
            "mode": TASK_MODES.get(s.task_mode, str(s.task_mode)),
            "paused": bool(s.task_paused) or s.interp_state == self.lc.INTERP_PAUSED,
            "homed": all(s.homed[:s.joints]),
            "file": s.file,
            "line": s.motion_line,
            "pos": pos,
            "feedOverride": round(s.feedrate, 3),
            "vel": round(s.current_vel * 60, 1),     # mm/min
            "spindle": round(s.spindle[0]["speed"], 0) if s.spindle else 0,
        }

    def push_status(self):
        try:
            st = self.status()
        except Exception as e:
            st = {"error": str(e)}
        text = json.dumps(st)
        if text != self.last and self.trusted():
            self.last = text
            self.js("window.linuxcncStatus && window.linuxcncStatus(%s)" % text)
        return True

    # ---------------------------------------------------------------- commands

    def on_message(self, _ucm, result):
        value = result.get_js_value() if hasattr(result, "get_js_value") else result
        rid = None
        try:
            msg = json.loads(value.to_string())
            rid = msg.get("id")
            if not self.trusted():
                return self.reply(rid, False, "Commands are only accepted from the page this tab was opened on.")
            handler = getattr(self, "do_" + str(msg.get("cmd")), None)
            if not handler:
                return self.reply(rid, False, "Unknown command.")
            handler(rid, msg)
        except Exception as e:
            self.reply(rid, False, "Error: %s" % e)

    def busy(self):
        self.stat.poll()
        return self.stat.interp_state != self.lc.INTERP_IDLE

    def do_load(self, rid, msg):
        if self.busy():
            return self.reply(rid, False, "LinuxCNC is running a program. Stop it before sending a new one.")
        name = os.path.basename(str(msg.get("name") or "pulley.ngc")).strip()
        name = re.sub(r"[^\w.\- ]", "_", name) or "pulley.ngc"
        if not re.search(r"\.(ngc|nc|tap|gcode)$", name, re.I):
            name += ".ngc"
        folder = program_dir()
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, name)
        gcode = str(msg.get("gcode") or "")
        if not gcode.strip():
            return self.reply(rid, False, "There is no G-code to send.")
        if os.path.exists(path) and not msg.get("overwrite"):
            with open(path, encoding="utf-8", errors="replace") as f:
                if f.read() != gcode:
                    return self.reply(rid, False, "%s already exists with different contents." % path,
                                      {"exists": True, "path": path})
        with open(path, "w", encoding="utf-8") as f:
            f.write(gcode)

        def open_in_axis():
            try:
                r = subprocess.run(["axis-remote", path], capture_output=True, text=True, timeout=20)
                ok, err = r.returncode == 0, (r.stderr or r.stdout).strip()
            except Exception as e:
                ok, err = False, str(e)
            GLib.idle_add(self.reply, rid, ok,
                          "Loaded %s in AXIS." % path if ok else "Saved %s, but AXIS did not open it: %s" % (path, err),
                          {"path": path})
        threading.Thread(target=open_in_axis, daemon=True).start()

    def do_run(self, rid, msg):
        s = self.stat
        s.poll()
        if s.task_state != self.lc.STATE_ON:
            return self.reply(rid, False, "Machine is not on.")
        if not all(s.homed[:s.joints]):
            return self.reply(rid, False, "Home the machine first.")
        if s.interp_state != self.lc.INTERP_IDLE:
            return self.reply(rid, False, "LinuxCNC is already running a program.")
        want = msg.get("path")
        if want and os.path.realpath(s.file) != os.path.realpath(want):
            return self.reply(rid, False, "AXIS has a different file loaded (%s). Send the program again." % s.file)
        self.cmd.mode(self.lc.MODE_AUTO)
        self.cmd.wait_complete()
        self.cmd.auto(self.lc.AUTO_RUN, 0)
        self.reply(rid, True, "Program started.")

    def do_pause(self, rid, msg):
        self.cmd.auto(self.lc.AUTO_PAUSE)
        self.reply(rid, True, "Paused.")

    def do_resume(self, rid, msg):
        self.cmd.auto(self.lc.AUTO_RESUME)
        self.reply(rid, True, "Resumed.")

    def do_stop(self, rid, msg):
        self.cmd.abort()
        self.reply(rid, True, "Stopped.")


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: web_tab.py XID URL")
    xid = int(sys.argv[1], 0)
    url = sys.argv[2]

    # Build in a normal window, then let LinuxCNC's xembed helper force the
    # reparent into AXIS's Tk frame (a bare Gtk.Plug stays blank under Tk).
    window = Gtk.Window()

    view = WebKit2.WebView()
    settings = view.get_settings()
    # The Ironlake iGPU hangs on GL under Xwayland; keep WebKit off the GPU.
    settings.set_hardware_acceleration_policy(WebKit2.HardwareAccelerationPolicy.NEVER)
    view.bridge = Bridge(view, url)

    back = Gtk.Button.new_from_icon_name("go-previous", Gtk.IconSize.BUTTON)
    back.connect("clicked", lambda *_: view.go_back())
    home = Gtk.Button.new_from_icon_name("go-home", Gtk.IconSize.BUTTON)
    home.connect("clicked", lambda *_: view.load_uri(url))
    reload_ = Gtk.Button.new_from_icon_name("view-refresh", Gtk.IconSize.BUTTON)
    reload_.connect("clicked", lambda *_: view.reload())

    bar = Gtk.Box(orientation=Gtk.Orientation.HORIZONTAL, spacing=4)
    for b in (back, home, reload_):
        bar.pack_start(b, False, False, 0)

    box = Gtk.Box(orientation=Gtk.Orientation.VERTICAL)
    box.pack_start(bar, False, False, 0)
    box.pack_start(view, True, True, 0)
    window.add(box)
    box.show_all()

    from gladevcp import xembed
    # Same as gladevcp: GDK exits on X errors (e.g. when AXIS closes the frame).
    Gdk.error_trap_push()
    plug = xembed.reparent(window, xid)
    plug.connect("destroy", Gtk.main_quit)
    plug.show_all()
    view.load_uri(url)
    Gtk.main()


if __name__ == "__main__":
    main()
