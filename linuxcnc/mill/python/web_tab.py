#!/usr/bin/env python3
"""Embed a web page in an AXIS tab.

Usage (in the INI [DISPLAY] section):
    EMBED_TAB_NAME    = Tools
    EMBED_TAB_COMMAND = python3 python/web_tab.py {XID} https://example.com
"""
import sys

import gi
gi.require_version("Gtk", "3.0")
gi.require_version("Gdk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gdk, Gtk, WebKit2

# Ubuntu's apport excepthook can block for ~15 s per exception; see probe_screen.py.
sys.excepthook = sys.__excepthook__


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
