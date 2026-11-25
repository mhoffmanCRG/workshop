# axisrc.py — dark theme for the AXIS GUI. Loaded via Mill.ini [DISPLAY] USER_COMMAND_FILE
# (instead of ~/.axisrc); AXIS execs it after its UI is built.
# Colours match the dark palette of the Tools tab page (~/workshop/css/style.css).
# Comment out USER_COMMAND_FILE in Mill.ini to get the stock light look back.

_DARK = dict(
    bg="#1b2129",       # window surfaces            (--panel)
    fg="#e4e9f0",       # text                       (--text)
    muted="#9aa5b5",    # disabled / secondary text  (--muted)
    field="#12161c",    # text boxes, lists, DRO     (--bg)
    code="#0c1118",     # G-code listing             (--code-bg)
    line="#313a47",     # borders, button faces      (--line)
    hover="#3a4556",    # hovered buttons
    metal="#4a5565",    # slider / scrollbar handles (--metal)
    accent="#5b9bf5",   # selection, focus ring      (--accent)
    accent_text="#0c1320",  #                        (--accent-text)
    pressed="#24406a",  # selected toggle buttons (accent, dimmed)
)
_D = _DARK

root_window.tk_setPalette(
    background=_D["bg"], foreground=_D["fg"],
    activeBackground=_D["hover"], activeForeground="#ffffff",
    selectBackground=_D["accent"], selectForeground=_D["accent_text"],
    highlightBackground=_D["bg"], highlightColor=_D["accent"],
    insertBackground=_D["fg"], troughColor=_D["field"],
    disabledForeground=_D["muted"], selectColor=_D["field"],
)

# Widgets created later (dialogs, popups) pick these up from the option database.
for _cls in ("Text", "Entry", "Listbox", "Spinbox"):
    root_window.option_add("*%s.background" % _cls, _D["field"])
    root_window.option_add("*%s.foreground" % _cls, _D["fg"])
root_window.option_add("*Button.background", _D["line"])
root_window.option_add("*Button.activeBackground", _D["hover"])
root_window.option_add("*Button.borderWidth", 1)

# Recolour the existing widget tree. AXIS / BWidget / PyVCP build some widgets with
# explicit light colours that tk_setPalette doesn't touch.
root_window.tk.eval(r"""
proc ::_axis_dark {w C} {
    set light {#d9d9d9 #ececec #ffffff white #c3c3c3 gray85 grey85 #dcdad5}
    foreach c [winfo children $w] {
        set cls [winfo class $c]
        if {$cls in {Text Entry Listbox Spinbox}} {
            catch {$c configure -background [dict get $C field] -foreground [dict get $C fg] \
                -insertbackground [dict get $C fg]}
        } elseif {![catch {$c cget -background} v] && [string tolower $v] in $light} {
            catch {$c configure -background [dict get $C bg]}
        }
        if {![catch {$c cget -selectcolor} v] && [string tolower $v] in $light} {
            catch {$c configure -selectcolor [dict get $C pressed]}
        }
        if {![catch {$c cget -activebackground} v] && [string tolower $v] in $light} {
            catch {$c configure -activebackground [dict get $C hover]}
        }
        if {![catch {$c cget -foreground} v] && [string tolower $v] in {black #000000}} {
            catch {$c configure -foreground [dict get $C fg]}
        }
        switch -- $cls {
            NoteBook {
                # BWidget tabs: set colours on the notebook and every page so it redraws them.
                catch {
                    $c configure -background [dict get $C bg] -activebackground [dict get $C hover] \
                        -foreground [dict get $C fg] -activeforeground #ffffff \
                        -disabledforeground [dict get $C muted]
                    set cur [$c raise]
                    foreach p [$c pages] {
                        $c itemconfigure $p -background [dict get $C bg] \
                            -activebackground [dict get $C hover] \
                            -foreground [dict get $C fg] -activeforeground #ffffff
                    }
                    if {$cur ne ""} { $c raise $cur }
                }
            }
            Entry - Spinbox {
                catch {$c configure -disabledbackground [dict get $C bg] \
                    -readonlybackground [dict get $C bg] -disabledforeground [dict get $C muted] \
                    -highlightcolor [dict get $C accent]}
            }
            Button {
                # Classic Tk draws near-white bevels on dark raised buttons; flat-ish face, thin border.
                if {[$c cget -relief] eq "raised"} {
                    catch {$c configure -background [dict get $C line] \
                        -activebackground [dict get $C hover] -borderwidth 1 -highlightthickness 0}
                }
            }
            Scale {
                catch {$c configure -background [dict get $C metal] -activebackground [dict get $C accent] \
                    -troughcolor [dict get $C field] -sliderrelief flat -borderwidth 0 \
                    -highlightthickness 0}
            }
            Scrollbar {
                catch {$c configure -background [dict get $C line] -activebackground [dict get $C metal] \
                    -troughcolor [dict get $C field] -elementborderwidth 1 -activerelief flat}
            }
            Canvas {
                # PyVCP meter / bar faces are drawn white / grey with black ticks and text.
                if {[string match *pyvcp* $c]} {
                    foreach i [$c find all] {
                        set t [$c type $i]
                        if {![catch {$c itemcget $i -fill} f]} {
                            set f [string tolower $f]
                            if {$f in {white #ffffff grey gray lightgrey}} {
                                $c itemconfigure $i -fill [dict get $C field]
                            } elseif {$f in {black #000000} && $t in {line text}} {
                                $c itemconfigure $i -fill [dict get $C fg]
                            }
                        }
                        if {![catch {$c itemcget $i -outline} o] && [string tolower $o] in {black #000000}} {
                            $c itemconfigure $i -outline [dict get $C metal]
                        }
                    }
                }
            }
        }
        ::_axis_dark $c $C
    }
}
""")
root_window.tk.eval(r"""
# Disabled image buttons: classic Tk on X11 covers a disabled button's image with a 50%
# stipple of the background colour, which shows as a checkerboard on a dark theme.
# Instead, keep the real Tk state "normal" and draw a pre-dimmed copy of the icon,
# while the widget command reports the requested state ("disabled") to everyone
# (AXIS and Tk's own bindings) and refuses `invoke`, so the button stays inert.

proc ::_dk_dim_image {img bg} {
    if {[info exists ::_dk_dimmed($img)]} { return $::_dk_dimmed($img) }
    if {[image type $img] ne "photo"} { return $img }
    lassign [winfo rgb . $bg] br bgg bb
    set br [expr {$br / 257}]; set bgg [expr {$bgg / 257}]; set bb [expr {$bb / 257}]
    set w [image width $img]; set h [image height $img]
    set d [image create photo -width $w -height $h]
    for {set y 0} {$y < $h} {incr y} {
        for {set x 0} {$x < $w} {incr x} {
            if {[$img transparency get $x $y]} continue
            lassign [$img get $x $y] r g b
            set grey [expr {0.3 * $r + 0.59 * $g + 0.11 * $b}]
            # 40% greyed icon over 60% background
            set nr [expr {int(0.4 * $grey + 0.6 * $br)}]
            set ng [expr {int(0.4 * $grey + 0.6 * $bgg)}]
            set nb [expr {int(0.4 * $grey + 0.6 * $bb)}]
            $d put [format #%02x%02x%02x $nr $ng $nb] -to $x $y
        }
    }
    set ::_dk_dimmed($img) $d
    return $d
}

proc ::_dk_wrap_button {w bg} {
    if {[info exists ::_dk_state($w)]} return
    set img [$w cget -image]
    if {$img eq "" || [image type $img] ne "photo"} return
    set orig ::_dk_orig$w
    set ::_dk_state($w) [$w cget -state]
    set ::_dk_image($w) $img
    set ::_dk_bg($w) $bg
    rename $w $orig
    if {[catch {proc $w {args} "::_dk_cmd [list $w] [list $orig] {*}\$args"} err]} {
        rename $orig $w
        unset -nocomplain ::_dk_state($w) ::_dk_image($w) ::_dk_bg($w)
        return -code error $err
    }
    # the wrapper proc is not removed with the widget; drop it on destroy
    bind $w <Destroy> +[list ::_dk_forget $w]
    ::_dk_apply $w
}

proc ::_dk_forget {w} {
    catch {rename $w {}}
    unset -nocomplain ::_dk_state($w) ::_dk_image($w) ::_dk_bg($w)
}

proc ::_dk_apply {w} {
    set orig ::_dk_orig$w
    if {$::_dk_state($w) eq "disabled"} {
        $orig configure -state normal -image [::_dk_dim_image $::_dk_image($w) $::_dk_bg($w)]
    } else {
        $orig configure -state $::_dk_state($w) -image $::_dk_image($w)
    }
}

proc ::_dk_cmd {w orig args} {
    set sub [lindex $args 0]
    switch -- $sub {
        cget {
            switch -- [lindex $args 1] {
                -state { return $::_dk_state($w) }
                -image { return $::_dk_image($w) }
            }
        }
        configure - config {
            set rest [lrange $args 1 end]
            if {[llength $rest] >= 2 && [llength $rest] % 2 == 0} {
                set pass {}
                set touched 0
                foreach {k v} $rest {
                    switch -- $k {
                        -state { set ::_dk_state($w) $v; set touched 1 }
                        -image { set ::_dk_image($w) $v; set touched 1 }
                        default { lappend pass $k $v }
                    }
                }
                if {[llength $pass]} { $orig configure {*}$pass }
                if {$touched} { ::_dk_apply $w }
                return
            }
            if {[llength $rest] == 1} {
                switch -- [lindex $rest 0] {
                    -state { return [list -state state State normal $::_dk_state($w)] }
                    -image { return [list -image image Image {} $::_dk_image($w)] }
                }
            }
        }
        invoke - flash - select - deselect - toggle {
            if {$::_dk_state($w) eq "disabled"} return
        }
    }
    return [$orig {*}$args]
}

proc ::_dk_wrap_all {w bg} {
    foreach c [winfo children $w] {
        if {[winfo class $c] in {Button Radiobutton Checkbutton}} {
            catch {::_dk_wrap_button $c $bg}
        }
        ::_dk_wrap_all $c $bg
    }
}

# Icons drawn as black line art (view buttons, spindle direction) vanish on a dark
# background; recolour their dark pixels to the text colour, in place.
proc ::_dk_lighten {img fg} {
    if {[info exists ::_dk_lightened($img)] || [lsearch -exact [image names] $img] < 0} return
    if {[image type $img] ne "photo"} return
    lassign [winfo rgb . $fg] fr fgg fb
    set c [format #%02x%02x%02x [expr {$fr / 257}] [expr {$fgg / 257}] [expr {$fb / 257}]]
    set w [image width $img]; set h [image height $img]
    for {set y 0} {$y < $h} {incr y} {
        for {set x 0} {$x < $w} {incr x} {
            if {[$img transparency get $x $y]} continue
            lassign [$img get $x $y] r g b
            if {max($r, $g, $b) < 90} { $img put $c -to $x $y }
        }
    }
    set ::_dk_lightened($img) 1
}
""")

_DARK_TCL = root_window.tk.call("dict", "create", *sum(_D.items(), ()))
_LINE_ART_ICONS = ("icon_tool_axis_z", "icon_tool_axis_z2", "icon_tool_axis_x", "icon_tool_axis_y",
                   "icon_tool_axis_y2", "icon_tool_axis_p", "icon_spindle_ccw", "icon_spindle_cw")

def _dark_pass():
    root_window.tk.call("::_axis_dark", ".", _DARK_TCL)
    for _i in _LINE_ART_ICONS:
        root_window.tk.call("::_dk_lighten", _i, _D["fg"])
    root_window.tk.call("::_dk_wrap_all", ".", _D["bg"])

_dark_pass()
# AXIS adds the EMBED_TAB pages (Probe Screen, Tools) only after this file runs,
# so recolour again once startup has finished.
root_window.after(1000, _dark_pass)

# G-code listing: code-block background like the Tools page; tags AXIS paints in light colours.
try:
    t.configure(background=_D["code"])
    t.tag_configure("ignored", background=_D["code"], foreground="#6b7686")
    t.tag_configure("lineno", foreground="#6b7686")
    t.tag_configure("executing", background=_D["pressed"], foreground="#ffffff")
except Exception:
    pass

# 3D preview background (was black).
def _rgb(h):
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (1, 3, 5))
try:
    o.colors["back"] = _rgb(_D["field"])
    o.colors["overlay_background"] = _rgb(_D["bg"])
    o.tkRedraw()
except Exception:
    pass
