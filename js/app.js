/* Page wiring for the HTD pulley G-code generator: form, previews, download. */
(function () {
  'use strict';

  var STORE_KEY = 'htd5m-settings';
  var form = document.getElementById('settings');
  var gcodeBox = document.getElementById('gcode');
  var fileBox = document.getElementById('filename');
  var downloadBtn = document.getElementById('download');
  var copyBtn = document.getElementById('copy');
  var messages = document.getElementById('messages');
  var tiles = document.getElementById('tiles');
  var pulleyCanvas = document.getElementById('pulleyView');
  var grooveCanvas = document.getElementById('grooveView');
  var timeTable = document.getElementById('timeTable');
  var view3d = HTDView3D.create(document.getElementById('view3d'));
  var result = null;
  var fileNameEdited = false;
  var selected = null;       // which summary tile is being shown on the drawings
  var profiles = null;       // groove cross-section after each pass, for the playback drawings
  var timePanel = document.getElementById('timecalc');
  var playBtn = document.getElementById('play');
  var stopBtn = document.getElementById('stop');
  var speedBox = document.getElementById('speed');
  var scrub = document.getElementById('scrub');
  var playInfo = document.getElementById('playInfo');
  var lineMark = document.getElementById('lineMark');
  var TIME_KEY = 'htd5m-show-time';

  // ------------------------------------------------------------ form <-> params

  function fields() {
    return Array.prototype.filter.call(form.elements, function (el) { return el.name; });
  }

  function writeForm(values) {
    fields().forEach(function (el) {
      var v = values[el.name];
      if (v === undefined) return;
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = String(v);
    });
  }

  function readForm() {
    var p = {};
    fields().forEach(function (el) {
      if (el.type === 'checkbox') p[el.name] = el.checked;
      else if (el.type === 'number' || el.hasAttribute('data-num')) p[el.name] = el.value === '' ? NaN : Number(el.value);
      else p[el.name] = el.value;
    });
    return p;
  }

  function loadSaved() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      return saved && typeof saved === 'object' ? saved : {};
    } catch (e) { return {}; }
  }

  function save(p) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(p)); } catch (e) { /* storage unavailable */ }
  }

  // ------------------------------------------------------------ summary

  function tile(id, label, value, unit, key) {
    return '<button type="button" class="tile' + (key ? ' key-tile' : '') + '" data-tile="' + id + '"' +
      ' aria-pressed="' + (id === 'time' ? !timePanel.hidden : selected === id) + '"' +
      (id === 'time' ? ' aria-controls="timecalc"' : '') + '>' +
      '<span class="tile-label">' + label + '</span><span class="tile-value">' + value +
      (unit ? '<small>' + unit + '</small>' : '') + '</span></button>';
  }

  function duration(minutes) {
    var m = Math.round(minutes);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }

  // Finer than duration(): keeps seconds while they still matter.
  function clock(minutes) {
    var s = Math.round(minutes * 60);
    if (s < 60) return s + ' s';
    if (s < 3600) return Math.floor(s / 60) + ' min ' + ('0' + s % 60).slice(-2) + ' s';
    return Math.floor(s / 3600) + ' h ' + ('0' + Math.floor(s % 3600 / 60)).slice(-2) + ' min';
  }

  function showTimes(r) {
    var s = r.stats, t = s.time, p = r.params, total = s.minutes;
    var rows = [
      ['Roughing cuts', t.rough, Math.round(s.dist.rough).toLocaleString() + ' mm'],
      ['Finishing cuts', t.finish, Math.round(s.dist.finish).toLocaleString() + ' mm'],
      ['Plunges and step-overs', t.step, ''],
      ['Rapid moves', t.rapid, ''],
      ['Rotary moves', t.index, Math.round(s.rotaryTravel).toLocaleString() + '\u00b0'],
      ['Spindle start dwell', t.dwell, '']
    ];
    var html = '<thead><tr><th>Part of the job</th><th>Distance</th><th>Time</th><th>Share</th></tr></thead><tbody>';
    rows.forEach(function (row) {
      var share = total > 0 ? row[1] / total * 100 : 0;
      html += '<tr><td>' + row[0] + '</td><td>' + row[2] + '</td><td>' + clock(row[1]) + '</td>' +
        '<td class="share"><span class="bar" style="width:' + share.toFixed(1) + '%" title="' + share.toFixed(0) + '%"></span></td></tr>';
    });
    html += '</tbody><tfoot>' +
      '<tr><td>One pulley</td><td></td><td>' + clock(total) + '</td><td></td></tr>' +
      '<tr class="sub"><td>Average per groove</td><td></td><td>' + clock((total - t.dwell) / p.teeth) + '</td><td></td></tr>';
    if (p.quantity > 1) {
      html += '<tr><td>' + p.quantity + ' pulleys</td><td></td><td>' + clock(total * p.quantity) + '</td><td></td></tr>';
    }
    timeTable.innerHTML = html + '</tfoot>';
  }

  function showSummary(r) {
    var st = r.stats, pr = r.params;
    document.getElementById('feedInfo').textContent =
      (pr.feedAuto ? st.materialLabel + ': ' + st.materialChip.toFixed(3) + ' mm per tooth gives ' + pr.feed + ' mm/min at ' + pr.rpm + ' rpm. '
        : 'Tooth load at the cutting feed: ' + st.toothLoad.toFixed(4) + ' mm per tooth (typical for ' + st.materialLabel.toLowerCase() + ': ' + st.materialChip.toFixed(3) + '). ') +
      (pr.adaptFeed ? 'This job feeds between ' + st.feedLow + ' and ' + st.feedHigh + ' mm/min. ' : 'Every pass feeds at ' + st.feedLow + ' mm/min. ') +
      'A usual spindle speed for this cutter in ' + st.materialLabel.toLowerCase() + ' is about ' + (Math.round(st.suggestedRpm / 100) * 100).toLocaleString() + ' rpm.';
    var g = r.geom, s = r.stats;
    tiles.innerHTML =
      tile('od', 'Turn stock to', g.OD.toFixed(3), 'mm', true) +
      tile('pd', 'Pitch diameter', g.PD.toFixed(3), 'mm') +
      tile('root', 'Root diameter', g.rootDia.toFixed(3), 'mm') +
      tile('index', 'Index per tooth', g.indexDeg.toFixed(4) + '&deg;', '') +
      tile('width', 'Groove width at OD', g.grooveWidth.toFixed(2), 'mm') +
      tile('land', 'Land between grooves', g.landWidth.toFixed(2), 'mm') +
      tile('passes', 'Rough + finish passes', s.roughPasses + ' + ' + s.finishPasses, '') +
      tile('scallop', 'Largest scallop', (s.maxExcess * 1000).toFixed(1), '&micro;m') +
      tile('radius', 'Average cutting radius', (s.meanCutRadius * 100).toFixed(0), '% of cutter') +
      tile('time', 'Estimated run time', duration(s.minutes), '');
  }

  var messagesBox = document.getElementById('messagesBox');
  var WARN_KEY = 'htd5m-warnings-open';
  var warningsOpen = true;     // the user's choice for the warnings list; errors always open it
  var settingOpen = false;     // true while the code, not the user, is toggling the list
  try { warningsOpen = localStorage.getItem(WARN_KEY) !== '0'; } catch (e) { /* storage unavailable */ }
  messagesBox.addEventListener('toggle', function () {
    if (settingOpen || messagesBox.classList.contains('has-error')) return;
    warningsOpen = messagesBox.open;
    try { localStorage.setItem(WARN_KEY, warningsOpen ? '1' : '0'); } catch (e) { /* storage unavailable */ }
  });

  function showMessages(r) {
    var ne = r.errors.length, nw = r.warnings.length, parts = [];
    if (ne) parts.push(ne + (ne === 1 ? ' error' : ' errors'));
    if (nw) parts.push(nw + (nw === 1 ? ' warning' : ' warnings'));
    document.getElementById('messagesSummary').textContent = parts.join(', ');
    messagesBox.hidden = !ne && !nw;
    messagesBox.classList.toggle('has-error', ne > 0);
    var wantOpen = ne > 0 || warningsOpen;
    if (messagesBox.open !== wantOpen) {
      settingOpen = true;
      messagesBox.open = wantOpen;
      setTimeout(function () { settingOpen = false; }, 0);    // the toggle event arrives asynchronously
    }
    messages.innerHTML = '';
    function add(text, cls) {
      var el = document.createElement('p');
      el.className = 'msg ' + cls;
      el.textContent = text;
      messages.appendChild(el);
    }
    r.errors.forEach(function (t) { add(t, 'error'); });
    r.warnings.forEach(function (t) { add(t, 'warn'); });
  }

  // ------------------------------------------------------------ drawing

  function prep(canvas) {
    var dpr = window.devicePixelRatio || 1;
    var w = canvas.clientWidth, h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  // The 2D drawings look at the free end of the pulley, toward the rotary head, as the 3D view
  // does when it opens. With the head at the plus end, machine +Y (tooth-frame +y) runs to the
  // left on screen (-1); with the head at the minus end it runs to the right (+1).
  var FACING = -1;
  function setFacing(r) { FACING = r.stats.headDir > 0 ? -1 : 1; }

  var showZero = true;

  // Program zero on a drawing: the usual quartered-circle datum mark with an arrow along each
  // machine axis that lies in the drawing. (px, py) is the spot in pixels; each axis is
  // { letter, dx, dy }, a unit direction on screen.
  function drawZero(ctx, c, px, py, axes) {
    ctx.save();
    ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.font = '700 12px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    axes.forEach(function (a) {
      var len = 26, head = 6, ex = px + a.dx * len, ey = py + a.dy * len, colour = c['axis-' + a.letter.toLowerCase()];
      ctx.strokeStyle = ctx.fillStyle = colour; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex + a.dx * head, ey + a.dy * head);
      ctx.lineTo(ex - a.dy * head * 0.5, ey + a.dx * head * 0.5); ctx.lineTo(ex + a.dy * head * 0.5, ey - a.dx * head * 0.5);
      ctx.closePath(); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = c.panel;
      // keep the letter on the drawing when the arrow runs off its edge
      var lx = Math.max(8, Math.min(ctx.canvas.clientWidth - 8, ex + a.dx * (head + 9)));
      var ly = Math.max(9, Math.min(ctx.canvas.clientHeight - 9, ey + a.dy * (head + 9)));
      ctx.strokeText(a.letter, lx, ly);
      ctx.fillText(a.letter, lx, ly);
    });
    var rad = 6;
    ctx.fillStyle = c.panel; ctx.beginPath(); ctx.arc(px, py, rad, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = c.text;
    [0, Math.PI].forEach(function (a0) { ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, rad, a0, a0 + Math.PI / 2); ctx.closePath(); ctx.fill(); });
    ctx.strokeStyle = c.text; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py, rad, 0, 2 * Math.PI); ctx.stroke();
    ctx.restore();
  }
  // Letter of the linear axis that runs across the rotary axis.
  function crossLetter(r) { return r.params.rotaryParallel === 'Y' ? 'X' : 'Y'; }

  function colours() {
    var cs = getComputedStyle(document.documentElement), c = {};
    ['metal', 'metal-edge', 'cut', 'finish', 'rough', 'muted', 'text', 'accent', 'mark', 'panel', 'axis-x', 'axis-y', 'axis-z'].forEach(function (k) {
      c[k] = cs.getPropertyValue('--' + k).trim();
    });
    return c;
  }

  // Label with a backing patch so it stays readable over the drawing.
  function tag(ctx, c, text, x, y, align) {
    ctx.save();
    ctx.font = '600 12px system-ui, sans-serif';
    var w = ctx.measureText(text).width + 8;
    var left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    left = Math.max(2, Math.min(left, ctx.canvas.clientWidth - w - 2));
    y = Math.max(11, Math.min(y, ctx.canvas.clientHeight - 11));
    ctx.globalAlpha = 0.9; ctx.fillStyle = c.panel; ctx.fillRect(left, y - 9, w, 18);
    ctx.globalAlpha = 1; ctx.fillStyle = c.mark; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillText(text, left + 4, y);
    ctx.restore();
  }

  // The selected tile's dimension on the pulley end view.
  function markPulley(ctx, c, r, cx, cy, scale) {
    var g = r.geom, top = -Math.PI / 2, step = 2 * Math.PI / g.teeth;
    ctx.save();
    ctx.strokeStyle = c.mark; ctx.setLineDash([]); ctx.lineCap = 'round';
    function diameter(rad, label) {
      var px = rad * scale;
      ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(cx, cy, px, 0, 2 * Math.PI); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(cx - px, cy); ctx.lineTo(cx + px, cy);
      ctx.moveTo(cx - px, cy - 5); ctx.lineTo(cx - px, cy + 5); ctx.moveTo(cx + px, cy - 5); ctx.lineTo(cx + px, cy + 5);
      ctx.stroke();
      tag(ctx, c, label, cx, cy - 13, 'center');
    }
    if (selected === 'od') diameter(g.Ro, 'Stock \u2300 ' + g.OD.toFixed(3) + ' mm');
    else if (selected === 'pd') diameter(g.PD / 2, 'Pitch \u2300 ' + g.PD.toFixed(3) + ' mm');
    else if (selected === 'root') diameter(g.Rr, 'Root \u2300 ' + g.rootDia.toFixed(3) + ' mm');
    else if (selected === 'index') {
      var len = (g.Ro + 2) * scale, ar = g.Ro * 0.55 * scale, mid = top + step / 2;
      ctx.lineWidth = 2; ctx.beginPath();
      ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - len);
      ctx.moveTo(cx, cy); ctx.lineTo(cx + len * Math.sin(step), cy - len * Math.cos(step));
      ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, ar, top, top + step); ctx.stroke();
      tag(ctx, c, g.indexDeg.toFixed(4) + '\u00b0', cx + (ar + 26) * Math.cos(mid), cy + (ar + 26) * Math.sin(mid), 'center');
    } else if (selected === 'width') {
      ctx.lineWidth = 4; ctx.beginPath();
      ctx.moveTo(cx - g.T.y * scale, cy - g.T.z * scale); ctx.lineTo(cx + g.T.y * scale, cy - g.T.z * scale); ctx.stroke();
      tag(ctx, c, g.grooveWidth.toFixed(2) + ' mm', cx + g.T.y * scale + 10, cy - g.T.z * scale - 12, 'left');
    } else if (selected === 'land') {
      var la = top + g.thetaT, lb = top + step - g.thetaT, lm = (la + lb) / 2;
      ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, g.Ro * scale, la, lb); ctx.stroke();
      tag(ctx, c, g.landWidth.toFixed(2) + ' mm', cx + (g.Ro * scale + 16) * Math.cos(lm) + 6, cy + (g.Ro * scale + 16) * Math.sin(lm), 'left');
    }
    ctx.restore();
  }

  // The selected tile's dimension on the single-groove view.
  function markGroove(ctx, c, r, X, Y, edge, scale) {
    var g = r.geom, Rt = r.toolRadius, s = r.stats, step = 2 * Math.PI / g.teeth;
    ctx.save();
    ctx.strokeStyle = c.mark; ctx.fillStyle = c.mark; ctx.setLineDash([]); ctx.lineCap = 'round'; ctx.lineWidth = 2.5;
    function arc(rad, y0, y1) {
      ctx.beginPath();
      for (var i = 0; i <= 60; i++) {
        var y = y0 + (y1 - y0) * i / 60, z = Math.sqrt(Math.max(0, rad * rad - y * y));
        if (i) ctx.lineTo(X(y), Y(z)); else ctx.moveTo(X(y), Y(z));
      }
      ctx.stroke();
    }
    function zAt(rad, y) { return Math.sqrt(Math.max(0, rad * rad - y * y)); }
    if (selected === 'od') {
      arc(g.Ro, -edge, edge);
      tag(ctx, c, 'Stock \u2300 ' + g.OD.toFixed(3) + ' mm', X(0), Y(g.Ro) - 13, 'center');
    } else if (selected === 'pd') {
      ctx.setLineDash([7, 5]); arc(g.PD / 2, -edge, edge);
      tag(ctx, c, 'Pitch \u2300 ' + g.PD.toFixed(3) + ' mm', X(0), Y(g.PD / 2) - 13, 'center');
    } else if (selected === 'root') {
      arc(g.Rr, -edge, edge);
      ctx.lineWidth = 1.5; ctx.beginPath();
      ctx.moveTo(X(0), Y(g.Ro)); ctx.lineTo(X(0), Y(g.Rr));
      ctx.moveTo(X(0) - 5, Y(g.Ro)); ctx.lineTo(X(0) + 5, Y(g.Ro));
      ctx.stroke();
      tag(ctx, c, 'depth ' + r.params.grooveDepth.toFixed(3) + ' mm', X(0) + 8, Y((g.Ro + g.Rr) / 2), 'left');
      tag(ctx, c, 'Root \u2300 ' + g.rootDia.toFixed(3) + ' mm', X(0), Y(g.Rr) + 14, 'center');
    } else if (selected === 'index') {
      tag(ctx, c, 'Next groove is ' + g.indexDeg.toFixed(4) + '\u00b0 round', X(0), 14, 'center');
    } else if (selected === 'width') {
      ctx.beginPath();
      ctx.moveTo(X(-g.T.y), Y(g.T.z)); ctx.lineTo(X(g.T.y), Y(g.T.z));
      ctx.moveTo(X(-g.T.y), Y(g.T.z) - 6); ctx.lineTo(X(-g.T.y), Y(g.T.z) + 6);
      ctx.moveTo(X(g.T.y), Y(g.T.z) - 6); ctx.lineTo(X(g.T.y), Y(g.T.z) + 6);
      ctx.stroke();
      tag(ctx, c, g.grooveWidth.toFixed(2) + ' mm', X(0), Y(g.T.z) - 14, 'center');
    } else if (selected === 'land') {
      var yEnd = Math.min(g.Ro * Math.sin(Math.min(step - g.thetaT, Math.PI / 2)), edge);
      ctx.lineWidth = 4; arc(g.Ro, g.T.y, yEnd); arc(g.Ro, -yEnd, -g.T.y);
      var ym = (g.T.y + yEnd) / 2;
      tag(ctx, c, g.landWidth.toFixed(2) + ' mm', X(ym), Y(zAt(g.Ro, ym)) - 14, 'center');
    } else if (selected === 'passes') {
      ctx.lineWidth = 1.3;
      r.finish.forEach(function (t) { ctx.beginPath(); ctx.arc(X(t.y), Y(t.z), Rt * scale, 0, 2 * Math.PI); ctx.stroke(); });
      r.finish.forEach(function (t) { ctx.beginPath(); ctx.arc(X(t.y), Y(t.z), 3, 0, 2 * Math.PI); ctx.fill(); });
      ctx.setLineDash([4, 3]);
      r.rough.forEach(function (t) { ctx.beginPath(); ctx.arc(X(t.y), Y(t.z), Rt * scale, 0, Math.PI); ctx.stroke(); });
      tag(ctx, c, s.roughPasses + ' roughing (dashed) + ' + s.finishPasses + ' finishing cutter positions', X(0), 14, 'center');
    } else if (selected === 'radius') {
      // where on the cutter the metal comes off: full radius on the shaft, none at the very tip
      var total = s.roughPasses + s.finishPasses;
      tag(ctx, c, 'Cut at ' + (s.meanCutRadius * 100).toFixed(0) + '% of cutter radius on average', X(0), 14, 'center');
      tag(ctx, c, (s.slowShare * 100).toFixed(0) + '% cut below half radius', X(0), 34, 'center');
      tag(ctx, c, 'Tip cuts on ' + s.tipPasses + ' of ' + total + ' passes', X(0), 54, 'center');
    } else if (selected === 'scallop') {
      var worst = r.sim.points.reduce(function (a, b) { return b.excess > a.excess ? b : a; });
      ctx.beginPath(); ctx.arc(X(worst.cy), Y(worst.cz), 8, 0, 2 * Math.PI); ctx.stroke();
      tag(ctx, c, 'largest scallop ' + (worst.excess * 1000).toFixed(1) + ' \u00b5m', X(worst.cy) + 14, Y(worst.cz) + 16, X(worst.cy) > X(0) ? 'right' : 'left');
    }
    ctx.restore();
  }

  // Cutter seen end-on: ball, shaft and holder. (y, z) is the ball centre, u the unit axis
  // pointing up the shaft, all in the drawing's own millimetre frame.
  function drawCutter(ctx, X, Y, scale, y, z, u, Rt, length, colour, holderColour) {
    var n = { y: u.z, z: -u.y }, L = Math.max(0, length - Rt), hr = Math.max(5, 3 * Rt);
    function px(a, b) { return [X(y + a * u.y + b * n.y), Y(z + a * u.z + b * n.z)]; }   // a along the shaft, b across it
    var a1 = px(L, Rt), a0 = px(0, Rt), b0 = px(0, -Rt), b1 = px(L, -Rt), c = px(0, 0);
    var start = Math.atan2(a0[1] - c[1], a0[0] - c[0]), tip = px(-Rt, 0);
    // sweep from one side of the ball to the other by way of the tip
    var viaTip = Math.cos(start + Math.PI / 2) * (tip[0] - c[0]) + Math.sin(start + Math.PI / 2) * (tip[1] - c[1]) > 0;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a1[0], a1[1]); ctx.lineTo(a0[0], a0[1]);
    ctx.arc(c[0], c[1], Rt * scale, start, start + Math.PI, !viaTip);
    ctx.lineTo(b1[0], b1[1]);
    ctx.closePath();
    ctx.fillStyle = colour; ctx.globalAlpha = 0.16; ctx.fill();
    ctx.globalAlpha = 1; ctx.strokeStyle = colour; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    // holder
    var h = [px(L, hr), px(L + 8, hr), px(L + 8, -hr), px(L, -hr)];
    ctx.beginPath(); ctx.moveTo(h[0][0], h[0][1]);
    for (var i = 1; i < 4; i++) ctx.lineTo(h[i][0], h[i][1]);
    ctx.closePath();
    ctx.strokeStyle = holderColour; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.restore();
  }

  // How many passes groove i has had at the playback position (see the move's carving state).
  function passesDone(m, i) {
    if (m.groove < 0) return 0;
    if (i < m.groove) return m.after;
    if (i > m.groove) return m.before;
    return m.done + (m.stroke ? 1 : 0);
  }

  // End view during playback: the part as cut so far, turned to where the rotary has it,
  // with the cutter where the program has put it.
  function drawPulleyProgress(v, ctx, c, r, X, Y, cx, cy, scale) {
    var g = r.geom, p = r.params, Rt = r.toolRadius, pose = play.pose, m = pose.move;
    var N = g.teeth, step = 2 * Math.PI / N, half = step / 2, last = profiles.tops.length - 1;
    var turn = r.program.turn, P = pose.P * Math.PI / 180;
    var stride = Math.max(1, Math.round(N * r.outline.length / 6000)), first = true, k, j;
    function to(y, z, ang) {
      var ca = Math.cos(ang), sa = Math.sin(ang), px = X(y * ca - z * sa), py = Y(y * sa + z * ca);
      if (first) { ctx.moveTo(px, py); first = false; } else ctx.lineTo(px, py);
    }
    ctx.beginPath();
    for (k = 0; k < N; k++) {
      var i = ((turn * k) % N + N) % N, count = Math.min(passesDone(m, i), last), ang = P - k * step;
      if (count <= 0) {
        for (j = 0; j <= 6; j++) { var th = -half + step * j / 6; to(g.Ro * Math.sin(th), g.Ro * Math.cos(th), ang); }
      } else if (count >= last) {
        for (j = 0; j < r.outline.length; j += stride) to(r.outline[j].y, r.outline[j].z, ang);
        to(r.outline[r.outline.length - 1].y, r.outline[r.outline.length - 1].z, ang);
      } else {
        var top = profiles.tops[count];
        for (j = 0; j < top.length; j++) to(profiles.ys[j], top[j], ang);
      }
    }
    ctx.closePath();
    ctx.fillStyle = c.metal; ctx.fill();
    ctx.strokeStyle = c['metal-edge']; ctx.lineWidth = 1; ctx.stroke();

    ctx.strokeStyle = c.muted;
    ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();

    // cutter and holder at their machine position
    var zc = pose.Z + Rt, zTop = pose.Z + p.toolLength, hr = Math.max(5, 3 * Rt);
    ctx.beginPath();
    var xc = X(pose.C), rp = Rt * scale;
    ctx.moveTo(xc - rp, Y(zTop)); ctx.lineTo(xc - rp, Y(zc));
    ctx.arc(xc, Y(zc), rp, Math.PI, 0, true);
    ctx.lineTo(xc + rp, Y(zTop));
    ctx.strokeStyle = c.mark; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = c.rough; ctx.lineWidth = 1.5;
    ctx.strokeRect(xc - hr * scale, Y(zTop + 8), 2 * hr * scale, 8 * scale);
    if (showZero) drawZero(ctx, c, X(0), Y(-r.stats.zOff), [{ letter: crossLetter(r), dx: FACING, dy: 0 }, { letter: 'Z', dx: 0, dy: -1 }]);

    ctx.fillStyle = c.muted; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(m.groove < 0 ? 'Before the first groove' : 'Groove ' + (m.groove + 1) + ' of ' + N, 8, v.h - 24);
    ctx.fillText('Part turned ' + pose.P.toFixed(1) + '\u00b0', 8, v.h - 8);
  }

  // Groove view during playback: the groove being worked on as the passes so far have left it.
  function drawGrooveProgress(v, ctx, c, r, X, Y, edge, scale, zMin) {
    var g = r.geom, Rt = r.toolRadius, m = play.pose.move, last = profiles.tops.length - 1;
    var count = Math.min(m.groove < 0 ? 0 : m.done + (m.stroke ? 1 : 0), last);
    var top = profiles.tops[count], ys = profiles.ys, n = ys.length, y, j;
    function odZ(yy) { return Math.sqrt(Math.max(0, g.Ro * g.Ro - yy * yy)); }

    ctx.beginPath();
    ctx.moveTo(X(-edge), Y(zMin));
    for (y = -edge; y < ys[0]; y += 0.05) ctx.lineTo(X(y), Y(odZ(y)));
    for (j = 0; j < n; j++) ctx.lineTo(X(ys[j]), Y(top[j]));
    for (y = ys[n - 1]; y < edge; y += 0.05) ctx.lineTo(X(y), Y(odZ(y)));
    ctx.lineTo(X(edge), Y(odZ(edge))); ctx.lineTo(X(edge), Y(zMin));
    ctx.closePath();
    ctx.fillStyle = c.metal; ctx.fill();

    // target profile, thin, so what is still to come off is visible
    var pts = r.sim.points;
    ctx.beginPath();
    for (j = 0; j < pts.length; j++) { if (j) ctx.lineTo(X(pts[j].y), Y(pts[j].z)); else ctx.moveTo(X(pts[j].y), Y(pts[j].z)); }
    ctx.strokeStyle = c['metal-edge']; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);

    // surface as cut so far
    ctx.beginPath();
    for (j = 0; j < n; j++) { if (j) ctx.lineTo(X(ys[j]), Y(top[j])); else ctx.moveTo(X(ys[j]), Y(top[j])); }
    ctx.strokeStyle = c.cut; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();

    // passes: finished ones solid, the current one highlighted, the rest faint
    var all = r.rough.concat(r.finish), current = m.groove >= 0 && m.done < all.length ? m.done : -1;
    all.forEach(function (t, idx) {
      if (idx === current) return;
      ctx.globalAlpha = idx < count ? 0.55 : 0.12;
      ctx.strokeStyle = c.finish; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(X(t.y), Y(t.z), Rt * scale, 0, 2 * Math.PI); ctx.stroke();
    });
    ctx.globalAlpha = 1;
    // where this pass will run, dashed until the cutter is in place and cutting
    if (current >= 0 && !m.stroke) {
      ctx.strokeStyle = c.mark; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.arc(X(all[current].y), Y(all[current].z), Rt * scale, 0, 2 * Math.PI); ctx.stroke();
      ctx.setLineDash([]);
    }
    // the cutter itself, with its shaft, where the program has it relative to this groove
    var p = r.params, pose = play.pose, groove = Math.max(0, m.groove);
    var lean = (pose.P + p.topSense * p.rotDir * groove * 360 / g.teeth) * Math.PI / 180;
    var cs = Math.cos(lean), sn = Math.sin(lean), zc = pose.Z + Rt;
    drawCutter(ctx, X, Y, scale, pose.C * cs + zc * sn, -pose.C * sn + zc * cs, { y: sn, z: cs }, Rt, p.toolLength, c.mark, c.rough);
    // program zero, which swings round this groove as the part turns
    var z0 = -r.stats.zOff, zx = X(z0 * sn), zy = Y(z0 * cs);
    if (showZero && zx > 0 && zx < v.w && zy > 0 && zy < v.h) {
      drawZero(ctx, c, zx, zy, [{ letter: crossLetter(r), dx: FACING * cs, dy: sn }, { letter: 'Z', dx: FACING * sn, dy: -cs }]);
    }
    var label = m.groove < 0 ? 'Before the first groove'
      : 'Groove ' + (m.groove + 1) + ': ' + (current < 0 ? 'all ' + all.length + ' passes done'
        : 'pass ' + (current + 1) + ' of ' + all.length + (current < r.rough.length ? ' (roughing)' : ' (finishing)'));
    tag(ctx, c, label, v.w / 2, 14, 'center');
  }

  function drawPulley(r) {
    var v = prep(pulleyCanvas), ctx = v.ctx, c = colours();
    if (!r || !r.gcode) return;
    setFacing(r);
    var g = r.geom, Rt = r.toolRadius;
    var toolTop = g.Ro + Math.max(4, g.Ro * 0.25);
    var span = g.Ro + toolTop + 2;
    var room = v.h - 36;                                   // leave the bottom strip for the labels
    // wide enough for the cutter to stand beside the stock on tilted passes
    var scale = Math.min((v.w - 20) / (2 * (g.Ro + 2 * Rt) + 2), (room - 16) / span);
    var cx = v.w / 2, cy = room / 2 + (toolTop - g.Ro) * scale / 2;
    function X(y) { return cx + FACING * y * scale; }
    function Y(z) { return cy - z * scale; }
    if (play.pose) { drawPulleyProgress(v, ctx, c, r, X, Y, cx, cy, scale); return; }

    ctx.beginPath();
    for (var k = 0; k < g.teeth; k++) {
      var a = k * 2 * Math.PI / g.teeth, ca = Math.cos(a), sa = Math.sin(a);
      for (var i = 0; i < r.outline.length; i++) {
        var q = r.outline[i], y = q.y * ca + q.z * sa, z = -q.y * sa + q.z * ca;
        if (k === 0 && i === 0) ctx.moveTo(X(y), Y(z)); else ctx.lineTo(X(y), Y(z));
      }
    }
    ctx.closePath();
    ctx.fillStyle = c.metal; ctx.fill();
    ctx.strokeStyle = c['metal-edge']; ctx.lineWidth = 1; ctx.stroke();

    // pitch circle and centre mark
    ctx.setLineDash([5, 4]); ctx.strokeStyle = c.muted;
    ctx.beginPath(); ctx.arc(cx, cy, g.PD / 2 * scale, 0, 2 * Math.PI); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(cx - 6, cy); ctx.lineTo(cx + 6, cy); ctx.moveTo(cx, cy - 6); ctx.lineTo(cx, cy + 6); ctx.stroke();

    // cutter sitting in the first groove at full depth
    var zc = g.Rr + Rt;
    ctx.beginPath();
    ctx.moveTo(cx - Rt * scale, Y(toolTop)); ctx.lineTo(cx - Rt * scale, Y(zc));
    ctx.arc(cx, Y(zc), Rt * scale, Math.PI, 0, true);
    ctx.lineTo(cx + Rt * scale, Y(toolTop));
    ctx.strokeStyle = c.finish; ctx.lineWidth = 1.5; ctx.stroke();

    if (selected) markPulley(ctx, c, r, cx, cy, scale);
    if (showZero) drawZero(ctx, c, X(0), Y(-r.stats.zOff), [{ letter: crossLetter(r), dx: FACING, dy: 0 }, { letter: 'Z', dx: 0, dy: -1 }]);

    ctx.fillStyle = c.muted; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(g.teeth + ' teeth', 8, v.h - 24);
    ctx.fillText('dashed: pitch circle ' + g.PD.toFixed(2) + ' mm', 8, v.h - 8);
  }

  function drawGroove(r) {
    var v = prep(grooveCanvas), ctx = v.ctx, c = colours();
    if (!r || !r.gcode) return;
    setFacing(r);
    var g = r.geom, Rt = r.toolRadius;
    var yHalf = g.T.y + Rt + 0.7;
    var zMin = g.Rr - 0.7, zMax = g.Ro + 2 * Rt + 0.5;
    var scale = Math.min((v.w - 16) / (2 * yHalf), (v.h - 16) / (zMax - zMin));
    var cx = v.w / 2, cy = v.h / 2 + (zMax + zMin) / 2 * scale;
    function X(y) { return cx + FACING * y * scale; }
    function Y(z) { return cy - z * scale; }
    if (play.pose) { drawGrooveProgress(v, ctx, c, r, X, Y, Math.min(yHalf, g.Ro * 0.99), scale, zMin); return; }
    var pts = r.sim.points, i;

    // metal as designed
    function odZ(y) { return Math.sqrt(Math.max(0, g.Ro * g.Ro - y * y)); }
    var edge = Math.min(yHalf, g.Ro * 0.99);
    ctx.beginPath();
    ctx.moveTo(X(-edge), Y(zMin));
    for (var y = -edge; y < -g.T.y; y += 0.05) ctx.lineTo(X(y), Y(odZ(y)));
    for (i = 0; i < pts.length; i++) ctx.lineTo(X(pts[i].y), Y(pts[i].z));
    for (y = g.T.y; y < edge; y += 0.05) ctx.lineTo(X(y), Y(odZ(y)));
    ctx.lineTo(X(edge), Y(odZ(edge))); ctx.lineTo(X(edge), Y(zMin));
    ctx.closePath();
    ctx.fillStyle = c.metal; ctx.fill();

    // cutter positions
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]); ctx.strokeStyle = c.rough;
    r.rough.forEach(function (t) {
      // only the lower half of each roughing position, to keep the view readable
      ctx.beginPath(); ctx.arc(X(t.y), Y(t.z), Rt * scale, 0, Math.PI); ctx.stroke();
    });
    ctx.setLineDash([]); ctx.strokeStyle = c.finish; ctx.globalAlpha = 0.4;
    r.finish.forEach(function (t) { ctx.beginPath(); ctx.arc(X(t.y), Y(t.z), Rt * scale, 0, 2 * Math.PI); ctx.stroke(); });
    ctx.globalAlpha = 1; ctx.fillStyle = c.finish;
    r.finish.forEach(function (t) { ctx.beginPath(); ctx.arc(X(t.y), Y(t.z), 2, 0, 2 * Math.PI); ctx.fill(); });
    // a short stem along the cutter axis shows which way each tilted pass leans
    ctx.globalAlpha = 0.8;
    r.finish.forEach(function (t) {
      if (!t.tilted) return;
      var u = HTD.toolAxis(t), len = Rt * 0.7 * scale;
      ctx.beginPath(); ctx.moveTo(X(t.y), Y(t.z)); ctx.lineTo(X(t.y) + FACING * u.y * len, Y(t.z) - u.z * len); ctx.stroke();
    });
    ctx.globalAlpha = 1;

    // as-cut surface, then the target profile on top
    ctx.beginPath();
    for (i = 0; i < pts.length; i++) { if (i) ctx.lineTo(X(pts[i].cy), Y(pts[i].cz)); else ctx.moveTo(X(pts[i].cy), Y(pts[i].cz)); }
    ctx.strokeStyle = c.cut; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(X(-edge), Y(odZ(edge)));
    for (y = -edge; y < -g.T.y; y += 0.05) ctx.lineTo(X(y), Y(odZ(y)));
    for (i = 0; i < pts.length; i++) ctx.lineTo(X(pts[i].y), Y(pts[i].z));
    for (y = g.T.y; y < edge; y += 0.05) ctx.lineTo(X(y), Y(odZ(y)));
    ctx.lineTo(X(edge), Y(odZ(edge)));
    ctx.strokeStyle = c['metal-edge']; ctx.lineWidth = 1.5; ctx.stroke();

    // cutter with its shaft, seated at full depth
    var deepest = r.finish.reduce(function (a, b) { return b.z < a.z ? b : a; });
    drawCutter(ctx, X, Y, scale, deepest.y, deepest.z, HTD.toolAxis(deepest), Rt, r.params.toolLength, c.finish, c.rough);

    if (selected) markGroove(ctx, c, r, X, Y, edge, scale);
    if (showZero && Y(-r.stats.zOff) > 0 && Y(-r.stats.zOff) < v.h) {
      drawZero(ctx, c, X(0), Y(-r.stats.zOff), [{ letter: crossLetter(r), dx: FACING, dy: 0 }, { letter: 'Z', dx: 0, dy: -1 }]);
    }

    // 1 mm scale bar
    var bx = 12, by = v.h - 12;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + scale, by);
    ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by + 4); ctx.moveTo(bx + scale, by - 4); ctx.lineTo(bx + scale, by + 4);
    ctx.strokeStyle = c.text; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = c.text; ctx.font = '12px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('1 mm', bx + scale / 2, by - 6);
  }

  // ------------------------------------------------------------ update

  function defaultFileName(p) {
    var prof = HTD.PROFILES[p.profile];
    return (prof ? prof.label : 'pulley').toLowerCase().replace(/\s+/g, '') + '-' + p.teeth + 't.nc';
  }

  // Nominal groove values of the belt profile chosen in the title, and a cutter that fits it.
  var PROFILE_FIELDS = HTD.PROFILE_FIELDS;
  function profileNow() { return HTD.PROFILES[form.elements.profile.value] || HTD.PROFILES[HTD.DEFAULTS.profile]; }
  function defaultFor(name) {
    if (PROFILE_FIELDS.indexOf(name) === -1) return HTD.DEFAULTS[name];
    return HTD.profileSettings(form.elements.profile.value, form.elements.grooveForm.value)[name];
  }
  // Only the groove settings the chosen belt's shape uses are shown.
  function showShapeFields() {
    var shape = profileNow().shape;
    Array.prototype.forEach.call(form.querySelectorAll('[data-shape]'), function (el) {
      el.hidden = el.getAttribute('data-shape').split(' ').indexOf(shape) === -1;
    });
    document.getElementById('radiusLabel').textContent = shape === 'trapezoid' ? 'Bottom corner radius' : 'Groove radius';
    document.getElementById('profileName').textContent = profileNow().label;
  }

  function update() {
    nameHeadSides();
    document.title = profileNow().label + ' Pulley G-code';
    showShapeFields();
    var p = readForm();
    save(p);
    stopPlayback();
    result = HTD.generate(p);
    showMessages(result);
    var ok = !result.errors.length;
    // while the feeds come from the material, show the worked-out values in their boxes and lock them
    ['feed', 'plunge'].forEach(function (name) {
      var box = form.elements[name];
      box.disabled = !!result.params.feedAuto;
      if (result.params.feedAuto && isFinite(result.params[name])) box.value = result.params[name];
    });
    downloadBtn.disabled = copyBtn.disabled = playBtn.disabled = scrub.disabled = !ok;
    play.lines = ok ? result.gcode.split('\n') : [];
    profiles = ok ? HTD.passProfiles(result) : null;
    gcodeBox.value = ok ? result.gcode : '';
    if (ok) {
      showSummary(result);
      showTimes(result);
      if (!fileNameEdited) fileBox.value = defaultFileName(result.params);
    } else {
      tiles.innerHTML = '';
      // The tiles are gone while there is an error, so a bad time-calculator value must stay reachable.
      var q = result.params;
      if (!(q.feedOverride > 0 && q.rapidRate > 0 && q.rotaryRapid > 0 && Number.isInteger(q.quantity) && q.quantity >= 1)) timePanel.hidden = false;
      timeTable.innerHTML = '';
    }
    view3d.setResult(ok ? result : null);
    drawPulley(ok ? result : null);
    drawGroove(ok ? result : null);
  }

  // ------------------------------------------------------------ G-code playback

  var play = { active: false, on: false, t: 0, last: 0, line: -1, lines: [], pose: null };

  function stamp(minutes) {
    var s = Math.floor(minutes * 60 + 1e-6), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
    return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + s % 60).slice(-2);
  }

  // Highlight bar over the current line of the G-code box.
  function placeLineMark(follow) {
    if (play.line < 0) { lineMark.hidden = true; return; }
    var cs = getComputedStyle(gcodeBox);
    var lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4, pad = parseFloat(cs.paddingTop) || 0;
    if (follow) gcodeBox.scrollTop = Math.max(0, pad + play.line * lh - gcodeBox.clientHeight / 2 + lh / 2);
    lineMark.style.top = (pad + play.line * lh - gcodeBox.scrollTop) + 'px';
    lineMark.style.height = lh + 'px';
    lineMark.hidden = false;
  }

  function showPose() {
    var P = result.program, mv = P.moves, lo = 0, hi = mv.length - 1;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (mv[mid].t1 >= play.t) hi = mid; else lo = mid + 1; }
    var m = mv[lo], from = lo ? mv[lo - 1] : P.start;
    var f = m.t1 > m.t0 ? Math.min(1, Math.max(0, (play.t - m.t0) / (m.t1 - m.t0))) : 1;
    function mix(k) { return from[k] + (m[k] - from[k]) * f; }
    view3d.setPose({ L: mix('L'), C: mix('C'), Z: mix('Z'), P: mix('P'), L0: from.L, move: lo });
    scrub.value = P.total > 0 ? Math.round(play.t / P.total * 1000) : 0;
    playInfo.textContent = stamp(play.t) + ' / ' + stamp(P.total) + '   line ' + (m.line + 1) + '   ' + (play.lines[m.line] || '');
    play.line = m.line;
    // the two drawings follow the playback as well
    play.pose = { move: m, C: mix('C'), Z: mix('Z'), P: mix('P') };
    drawPulley(result); drawGroove(result);
    placeLineMark(true);
  }

  function playButtons() {
    playBtn.textContent = play.on ? 'Pause' : 'Play';
    stopBtn.disabled = !play.active;
  }

  function tick(now) {
    if (!play.on) return;
    // Cap the step so a background tab does not jump far ahead when it comes back.
    play.t += Math.min(now - play.last, 100) / 60000 * Number(speedBox.value);
    play.last = now;
    if (play.t >= result.program.total) { play.t = result.program.total; play.on = false; }
    showPose();
    playButtons();
    if (play.on) requestAnimationFrame(tick);
  }

  function stopPlayback() {
    play.active = play.on = false; play.t = 0; play.line = -1; play.pose = null;
    scrub.value = 0;
    playInfo.textContent = 'Play runs the G-code in the 3D preview and on both drawings.';
    lineMark.hidden = true;
    view3d.setPose(null);
    if (result && result.gcode) { drawPulley(result); drawGroove(result); }
    playButtons();
  }

  playBtn.addEventListener('click', function () {
    if (!result || !result.gcode) return;
    if (play.on) { play.on = false; playButtons(); return; }
    if (!play.active || play.t >= result.program.total) play.t = 0;
    play.active = play.on = true;
    play.last = performance.now();
    playButtons();
    showPose();
    requestAnimationFrame(tick);
  });
  stopBtn.addEventListener('click', stopPlayback);
  scrub.addEventListener('input', function () {
    if (!result || !result.gcode) return;
    play.active = true;
    play.t = result.program.total * Number(scrub.value) / 1000;
    play.last = performance.now();
    showPose();
    playButtons();
  });
  gcodeBox.addEventListener('scroll', function () { if (play.active) placeLineMark(false); });

  // Tiles: click to show that dimension on the drawings; the run-time tile jumps to the calculator.
  tiles.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.tile') : null;
    if (!btn || !result || !result.gcode) return;
    var id = btn.getAttribute('data-tile');
    if (id === 'time') {
      timePanel.hidden = !timePanel.hidden;
      try { localStorage.setItem(TIME_KEY, timePanel.hidden ? '0' : '1'); } catch (err) { /* storage unavailable */ }
      showSummary(result);
      if (!timePanel.hidden) {
        timePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        timePanel.classList.remove('flash'); void timePanel.offsetWidth; timePanel.classList.add('flash');
      }
      var timeTile = tiles.querySelector('[data-tile="time"]');
      if (timeTile) timeTile.focus();
      return;
    }
    selected = selected === id ? null : id;
    showSummary(result);
    drawPulley(result); drawGroove(result);
    var again = tiles.querySelector('[data-tile="' + id + '"]');
    if (again) again.focus();
  });

  var timer = null;
  function schedule() { clearTimeout(timer); timer = setTimeout(update, 120); }

  // Some settings sit outside the <form> element but belong to it, so listen on the document.
  function onEdit(e) {
    if (e.target.form !== form) return;
    // picking the head's side points the stock at it, so the start face is the free end
    if (e.type === 'change' && e.target.name === 'headSide') form.elements.stockDir.value = e.target.value === 'left' ? '-1' : '1';
    // a different belt, or a different groove form of a T belt, brings its own groove and a cutter that fits it
    if (e.type === 'change' && (e.target.name === 'profile' || e.target.name === 'grooveForm')) PROFILE_FIELDS.forEach(function (k) { form.elements[k].value = String(defaultFor(k)); });
    schedule();
  }
  // "Left" and "right" only fit a rotary lying along X; along Y the head is at the front or the back.
  function nameHeadSides() {
    var alongY = form.elements.rotaryParallel.value === 'Y', opts = form.elements.headSide.options;
    Array.prototype.forEach.call(opts, function (o) {
      o.textContent = o.value === 'left' ? (alongY ? 'Front (Y\u2212 end)' : 'Left (X\u2212 end)') : (alongY ? 'Back (Y+ end)' : 'Right (X+ end)');
    });
  }
  document.addEventListener('input', onEdit);
  document.addEventListener('change', onEdit);
  form.addEventListener('submit', function (e) { e.preventDefault(); });

  // A "Set to default" button for each group of settings.
  Array.prototype.forEach.call(document.querySelectorAll('#settings .section-body, .time-inputs'), function (section) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'quiet section-default';
    btn.textContent = 'Set to default';
    btn.addEventListener('click', function () {
      Array.prototype.forEach.call(section.querySelectorAll('[name]'), function (el) {
        var v = defaultFor(el.name);
        if (v === undefined) return;
        if (el.type === 'checkbox') el.checked = !!v; else el.value = String(v);
      });
      update();
    });
    section.appendChild(btn);
  });

  // Remember which settings sections are collapsed.
  var FOLD_KEY = 'htd5m-collapsed';
  var sections = Array.prototype.slice.call(document.querySelectorAll('#settings details.section'));
  function sectionName(d) { return d.querySelector('summary').textContent.trim(); }
  try {
    var folded = JSON.parse(localStorage.getItem(FOLD_KEY) || '[]');
    if (Array.isArray(folded)) sections.forEach(function (d) { if (folded.indexOf(sectionName(d)) !== -1) d.open = false; });
  } catch (e) { /* storage unavailable */ }
  sections.forEach(function (d) {
    d.addEventListener('toggle', function () {
      var closed = sections.filter(function (x) { return !x.open; }).map(sectionName);
      try { localStorage.setItem(FOLD_KEY, JSON.stringify(closed)); } catch (e) { /* storage unavailable */ }
    });
  });

  // "Setting up the job" opens as a modal from the title bar.
  var setupDialog = document.getElementById('setupDialog');
  document.getElementById('openSetup').addEventListener('click', function () {
    if (setupDialog.showModal) setupDialog.showModal(); else setupDialog.setAttribute('open', '');
  });
  document.getElementById('closeSetup').addEventListener('click', function () {
    if (setupDialog.close) setupDialog.close(); else setupDialog.removeAttribute('open');
  });
  // a click on the dimmed area outside the box closes it
  setupDialog.addEventListener('click', function (e) { if (e.target === setupDialog && setupDialog.close) setupDialog.close(); });

  // Tick boxes under the 3D view: what to show, remembered between page loads.
  var SHOW_KEY = 'htd5m-show';
  var showBoxes = { path: 'showPath', cutter: 'showCutter', chuck: 'showChuck', zero: 'showZero' };
  var shown = {};
  try { shown = JSON.parse(localStorage.getItem(SHOW_KEY) || '{}') || {}; } catch (e) { shown = {}; }
  Object.keys(showBoxes).forEach(function (key) {
    var box = document.getElementById(showBoxes[key]);
    if (typeof shown[key] === 'boolean') box.checked = shown[key];
    view3d.show[key] = box.checked;
    if (key === 'zero') showZero = box.checked;
    box.addEventListener('change', function () {
      view3d.show[key] = shown[key] = box.checked;
      try { localStorage.setItem(SHOW_KEY, JSON.stringify(shown)); } catch (e) { /* storage unavailable */ }
      view3d.draw();
      if (key === 'zero') {
        showZero = box.checked;
        if (result && result.gcode) { drawPulley(result); drawGroove(result); }
      }
    });
  });
  if (!view3d.supported) {
    document.getElementById('view3dHelp').textContent = '3D preview needs WebGL, which is turned off or unavailable in this browser.';
  }

  document.getElementById('reset').addEventListener('click', function () {
    writeForm(HTD.DEFAULTS);
    fileNameEdited = false;
    update();
  });

  fileBox.addEventListener('input', function () { fileNameEdited = fileBox.value.trim() !== ''; });

  downloadBtn.addEventListener('click', function () {
    if (!result || !result.gcode) return;
    var name = fileBox.value.trim() || defaultFileName(result.params);
    var url = URL.createObjectURL(new Blob([result.gcode], { type: 'text/plain' }));
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  });

  copyBtn.addEventListener('click', function () {
    if (!result || !result.gcode) return;
    function done(ok) {
      copyBtn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(function () { copyBtn.textContent = 'Copy'; }, 1500);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(result.gcode).then(function () { done(true); }, function () { done(false); });
    } else {
      gcodeBox.select();
      done(document.execCommand('copy'));
    }
  });

  var redraw = function () { if (result && result.gcode) { drawPulley(result); drawGroove(result); } view3d.draw(); };
  window.addEventListener('resize', redraw);
  // The 3D canvas stretches with the layout, so redraw it whenever its box changes.
  if (window.ResizeObserver) new ResizeObserver(function () { view3d.draw(); }).observe(document.getElementById('view3d'));
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    if (mq.addEventListener) mq.addEventListener('change', redraw);
  }

  try { timePanel.hidden = localStorage.getItem(TIME_KEY) !== '1'; } catch (e) { /* storage unavailable */ }

  var initial = {}, saved = loadSaved(), k;
  for (k in HTD.DEFAULTS) initial[k] = saved[k] !== undefined && saved[k] !== null ? saved[k] : HTD.DEFAULTS[k];
  writeForm(initial);
  update();
})();
