(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const FINALE = 30; // clicks until he fills the screen

  const gate = $('#gate'), stage = $('#stage'), facesEl = $('#faces'), flashEl = $('#flash');
  const headline = $('#headline'), sub = $('#sub'), kicker = $('#kicker'), logEl = $('#log');
  const friendsEl = $('#friends'), idleEl = $('#idle'), blackEl = $('#black'), finalEl = $('#final');
  const cursorEl = $('#cursor'), muteBtn = $('#mute'), clockEl = $('#clock');
  const darkEl = $('#dark'), rushEl = $('#rush'), finalNote = $('#finalNote');

  let started = false, locked = false, muted = false;
  let clicks = 0, total = 0, friends = 0, rounds = 0;
  let lastAct = 0, idleFired = false;

  const tension = () => Math.min(clicks / FINALE, 1);

  /* ================================================================
     AUDIO — everything is synthesized, no sound files
     ================================================================ */
  let ctx, master, bus, droneG, droneLP, glassG, noiseBuf, silent = false;

  function initAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); // keeps the stingers from clipping
    comp.threshold.value = -16; comp.knee.value = 6; comp.ratio.value = 14;
    comp.attack.value = 0.002; comp.release.value = 0.2;
    master.connect(comp); comp.connect(ctx.destination);

    bus = ctx.createGain();
    bus.connect(master);

    // long, dark room
    const verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    verb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    bus.connect(verb); verb.connect(wet); wet.connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    startDrone();
    heartbeat();
  }

  const now = () => ctx.currentTime;

  function out(pan = 0) {
    if (!ctx.createStereoPanner) return bus;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(bus);
    return p;
  }

  function env(g, t, attack, peak, decay) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function noise(t, dur) {
    const n = ctx.createBufferSource();
    n.buffer = noiseBuf; n.loop = true;
    n.start(t, Math.random()); n.stop(t + dur);
    return n;
  }

  function filter(type, freq, q = 1) {
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }

  let driveCurve;
  function drive() {
    if (!driveCurve) {
      driveCurve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) driveCurve[i] = Math.tanh(7 * (i / 512 - 1));
    }
    const w = ctx.createWaveShaper();
    w.curve = driveCurve;
    return w;
  }

  // low minor-second saws under everything, plus a thin glassy whine
  function startDrone() {
    droneG = ctx.createGain(); droneG.gain.value = 0; droneG.connect(bus);
    droneLP = filter('lowpass', 170, 4); droneLP.connect(droneG);
    [[41.2, 0.3], [43.65, 0.3], [82.7, 0.12]].forEach(([f, v]) => {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = v;
      o.connect(g); g.connect(droneLP); o.start();
    });
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.06; lg.gain.value = 70;
    lfo.connect(lg); lg.connect(droneLP.frequency); lfo.start();

    const air = ctx.createBufferSource(); air.buffer = noiseBuf; air.loop = true;
    const af = filter('bandpass', 320, 0.6), ag = ctx.createGain(); ag.gain.value = 0.06;
    air.connect(af); af.connect(ag); ag.connect(droneG); air.start();

    glassG = ctx.createGain(); glassG.gain.value = 0.004; glassG.connect(bus);
    [1870, 1984, 2351].forEach((f) => {
      const o = ctx.createOscillator(); o.frequency.value = f;
      const l = ctx.createOscillator(), d = ctx.createGain();
      l.frequency.value = rand(0.03, 0.11); d.gain.value = 35;
      l.connect(d); d.connect(o.detune); l.start();
      const g = ctx.createGain(); g.gain.value = 0.33;
      o.connect(g); g.connect(glassG); o.start();
    });
    droneG.gain.setTargetAtTime(0.5, now(), 2);
  }

  function setTension(l) {
    if (!ctx) return;
    droneG.gain.setTargetAtTime(0.5 + 0.4 * l, now(), 0.5);
    droneLP.frequency.setTargetAtTime(170 + 520 * l, now(), 0.5);
    glassG.gain.setTargetAtTime(0.004 + 0.035 * l, now(), 0.5);
  }

  function thump(t, peak) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(72, t); o.frequency.exponentialRampToValueAtTime(36, t + 0.14);
    env(g, t, 0.005, peak, 0.18);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.3);
  }

  function heartbeat() {
    if (ctx && started && !silent && ctx.state === 'running') {
      const t = now() + 0.02, l = tension();
      thump(t, 0.35 + 0.4 * l); thump(t + 0.17, 0.22 + 0.3 * l);
    }
    setTimeout(heartbeat, 1150 - 760 * tension());
  }

  /* ---- stingers ---- */
  function slam(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(165, t); o.frequency.exponentialRampToValueAtTime(27, t + 0.5);
    env(g, t, 0.003, 0.9, 0.9);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 1.1);
    const n = noise(t, 0.3), f = filter('lowpass', 900), ng = ctx.createGain();
    env(ng, t, 0.002, 0.5, 0.22);
    n.connect(f); f.connect(ng); ng.connect(bus);
  }

  function screech(t, pan) {
    const g = ctx.createGain(), ws = drive(), hp = filter('highpass', 600);
    ws.connect(hp); hp.connect(g); g.connect(out(pan));
    const base = rand(650, 1300), dur = rand(0.6, 1.1);
    [1, 1.059, 1.414, 1.52, 2.09].forEach((m) => {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sawtooth'; og.gain.value = 0.2;
      o.frequency.setValueAtTime(base * m, t);
      o.frequency.exponentialRampToValueAtTime(base * m * rand(1.15, 1.5), t + dur);
      o.connect(og); og.connect(ws); o.start(t); o.stop(t + dur + 0.1);
    });
    const n = noise(t, dur), nf = filter('bandpass', 3200, 2), ng = ctx.createGain();
    ng.gain.value = 0.25; n.connect(nf); nf.connect(ng); ng.connect(g);
    env(g, t, 0.004, 0.5, dur);
  }

  function stabs(t, pan) {
    const base = rand(1500, 2100), o2 = out(pan);
    for (let i = 0; i < 4; i++) {
      const s = t + i * 0.15, g = ctx.createGain(), ws = drive();
      ws.connect(g); g.connect(o2);
      [1, 1.06, 1.414, 2.12].forEach((m) => {
        const o = ctx.createOscillator(), og = ctx.createGain();
        o.type = 'sawtooth'; o.frequency.value = base * m; og.gain.value = 0.22;
        o.connect(og); og.connect(ws); o.start(s); o.stop(s + 0.2);
      });
      env(g, s, 0.003, 0.42, 0.13);
    }
  }

  function scream(t, pan) {
    const dur = rand(0.9, 1.5), g = ctx.createGain(), ws = drive();
    ws.connect(g); g.connect(out(pan));
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(rand(280, 360), t);
    o.frequency.exponentialRampToValueAtTime(rand(820, 1150), t + 0.16);
    o.frequency.exponentialRampToValueAtTime(rand(480, 640), t + dur);
    const vib = ctx.createOscillator(), vg = ctx.createGain();
    vib.frequency.value = rand(9, 14); vg.gain.value = 55;
    vib.connect(vg); vg.connect(o.frequency);
    const n = noise(t, dur), ng = ctx.createGain(); ng.gain.value = 0.3;
    n.connect(ng);
    [900, 1400, 3000].forEach((f) => { // rough vowel formants
      const bp = filter('bandpass', f, 6), bg = ctx.createGain(); bg.gain.value = 1.4;
      o.connect(bp); ng.connect(bp); bp.connect(bg); bg.connect(ws);
    });
    env(g, t, 0.01, 0.55, dur);
    o.start(t); vib.start(t); o.stop(t + dur + 0.1); vib.stop(t + dur + 0.1);
  }

  function pianoHit(t) {
    const lp = filter('lowpass', 1300), g = ctx.createGain();
    lp.connect(g); g.connect(bus);
    [55, 58.3, 61.7, 110.6, 117.2].forEach((f) => {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'triangle'; o.frequency.value = f; o.detune.value = rand(-18, 18); og.gain.value = 0.28;
      o.connect(og); og.connect(lp); o.start(t); o.stop(t + 3.2);
    });
    env(g, t, 0.004, 0.8, 3);
  }

  function whisper(pan = 0) {
    if (!ctx || silent) return;
    const t = now() + 0.02, dur = 1.9;
    const n = noise(t, dur), f = filter('bandpass', rand(2400, 3600), 1.4), g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    for (let s = 0; s < dur - 0.2; s += rand(0.07, 0.2)) g.gain.setTargetAtTime(rand(0, 0.16), t + s, 0.03);
    g.gain.setTargetAtTime(0, t + dur - 0.2, 0.05);
    n.connect(f); f.connect(g); g.connect(out(pan));
  }

  function riser(dur) {
    const t = now() + 0.01, g = ctx.createGain(), ws = drive();
    ws.connect(g); g.connect(bus);
    [1, 1.498, 2.01].forEach((m) => {
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.type = 'sawtooth'; og.gain.value = 0.25;
      o.frequency.setValueAtTime(90 * m, t); o.frequency.exponentialRampToValueAtTime(2600 * m, t + dur);
      o.connect(og); og.connect(ws); o.start(t); o.stop(t + dur);
    });
    const n = noise(t, dur), nf = filter('bandpass', 400, 1.5), ng = ctx.createGain(); ng.gain.value = 0.4;
    nf.frequency.exponentialRampToValueAtTime(6000, t + dur);
    n.connect(nf); nf.connect(ng); ng.connect(g);
    g.gain.setValueAtTime(0.002, t); g.gain.exponentialRampToValueAtTime(0.5, t + dur);
    g.gain.setValueAtTime(0, t + dur);
  }

  function sting(pan = 0, hard = false) {
    if (!ctx || ctx.state !== 'running') return;
    const t = now() + 0.005;
    slam(t);
    if (hard) { scream(t, pan); screech(t + 0.03, -pan); return; }
    pick([screech, scream, stabs, screech, scream, pianoHit])(t, pan);
  }

  function hush(on) {
    silent = on;
    if (ctx) master.gain.setTargetAtTime(on || muted ? 0 : 0.9, now(), 0.02);
  }

  /* ================================================================
     WHAT THE BROWSER ALREADY KNOWS
     Everything here is read locally and shown back to the visitor.
     Nothing is looked up, and nothing leaves the page.
     ================================================================ */
  const store = {
    get() { try { return JSON.parse(localStorage.getItem('connector')) || {}; } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem('connector', JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };
  const mem = store.get();
  const prev = { visits: mem.visits | 0, clicks: mem.clicks | 0, finales: mem.finales | 0, last: +mem.last || 0 };
  mem.visits = prev.visits + 1;
  mem.last = Date.now();
  store.set(mem);

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const finePointer = matchMedia('(pointer:fine)').matches;

  function ago(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 2) return 'a minute ago';
    if (m < 60) return `${m} minutes ago`;
    const h = Math.round(m / 60);
    if (h < 24) return plural(h, 'hour') + ' ago';
    const d = Math.round(h / 24);
    return d === 1 ? 'yesterday' : `${d} days ago`;
  }

  const dev = (() => {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'this browser';
    const os = /iPhone|iPod/.test(ua) ? 'an iPhone' : /iPad/.test(ua) ? 'an iPad' : /Android/.test(ua) ? 'an Android phone'
      : /CrOS/.test(ua) ? 'a Chromebook' : /Mac/.test(ua) ? 'a Mac' : /Windows/.test(ua) ? 'Windows'
      : /Linux/.test(ua) ? 'Linux' : 'this machine';
    let lang = '';
    try { lang = new Intl.DisplayNames(['en'], { type: 'language' }).of(navigator.language.split('-')[0]) || ''; } catch (e) { /* older browser */ }
    return { browser, os, lang, dark: matchMedia('(prefers-color-scheme: dark)').matches };
  })();

  let battery = null;
  if (navigator.getBattery) navigator.getBattery().then((b) => { battery = b; }).catch(() => {});

  function batteryLine() {
    if (!battery) return '';
    const pct = Math.round(battery.level * 100);
    if (battery.charging) return `${pct}% and charging. good. you are staying.`;
    return pct <= 30 ? `${pct}% left. he’ll wait.` : `${pct}% battery. plenty of time.`;
  }

  function timeLine() {
    const d = new Date(), h = d.getHours(), wd = d.getDay();
    const day = d.toLocaleDateString('en-US', { weekday: 'long' });
    const t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/i, '');
    const part = h < 5 ? 'night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
    const weekend = wd === 0 || wd === 6;
    const tail = h < 5 ? 'you should be asleep.'
      : h < 9 ? 'you opened this before anything else.'
      : h < 17 ? (weekend ? 'you had the whole day.' : 'someone thinks you are working.')
      : h < 21 ? 'nobody knows you are here.'
      : 'you should be asleep.';
    return `it’s ${t} on a ${day} ${part}. ${tail}`;
  }

  // behaviour on the page
  let enteredAt = 0, lastClickAt = 0, lastMoveAt = 0, stillSaid = false;
  let leaves = 0, awayAt = 0, travel = 0;
  const zone = { left: 0, right: 0 };

  function stay() {
    const s = Math.round((performance.now() - enteredAt) / 1000), m = Math.floor(s / 60);
    return m ? `${plural(m, 'minute')} ${plural(s % 60, 'second')}` : plural(s, 'second');
  }

  const recent = [];
  function personal() {
    const s = [
      ['time', timeLine()],
      ['dev', `${dev.browser} on ${dev.os}. he has used it too.`],
      ['screen', `your screen is ${screen.width} × ${screen.height}. he fits.`],
      ['stay', `you have been here ${stay()}.`],
      ['clicks', `${plural(prev.clicks + total, 'click')} so far. he counted every one.`],
    ];
    if (innerWidth && innerHeight) s.push(['win', `this window is ${innerWidth} × ${innerHeight}. make it bigger.`]);
    const b = batteryLine();
    if (b) s.push(['bat', b]);
    if (leaves) s.push(['leave', `you left ${plural(leaves, 'time')}. you came back ${plural(leaves, 'time')}.`]);
    if (travel > 4000) s.push(['travel', `your cursor has travelled ${(travel / 96 * 0.0254).toFixed(1)} metres. he followed all of it.`]);
    const zt = zone.left + zone.right;
    if (finePointer && zt > 15 && Math.max(zone.left, zone.right) / zt > 0.7) {
      const side = zone.left > zone.right ? 'left' : 'right';
      s.push(['zone', `you keep your cursor on the ${side}. he is on the ${side === 'left' ? 'right' : 'left'}.`]);
    }
    if (prev.visits) s.push(['visit', `visit ${prev.visits + 1}. the last one was ${ago(prev.last)}.`]);
    if (dev.dark) s.push(['dark', 'you keep everything dark. so does he.']);
    if (dev.lang) s.push(['lang', `you read this in ${dev.lang}. he learned it for you.`]);
    const fresh = s.filter(([k]) => !recent.includes(k));
    const [k, text] = pick(fresh.length ? fresh : s);
    recent.push(k);
    if (recent.length > 6) recent.shift();
    return text;
  }

  /* ================================================================
     VISUALS
     ================================================================ */
  const FACE_V = ['', '', 'inv', 'red', 'burn', 'hue', 'melt', 'eyes', 'mirror', 'tall'];
  const FLASH_V = ['', 'eyes', 'eyes', 'mouth', 'inv', 'hot', 'flip', 'wide', 'eyes inv', 'mouth hot'];

  function spawn(x, y, o = {}) {
    const el = document.createElement('div');
    const v = o.v ?? pick(FACE_V);
    el.className = 'face ' + v + (o.tile ? ' tile' : '');
    const w = o.w ?? rand(110, Math.min(innerWidth * 0.42, 400));
    el.style.cssText = `left:${x}px;top:${y}px;width:${w}px;--r:${o.r ?? rand(-14, 14)}deg;--d:${o.d ?? rand(0.5, 1.7)}s`;
    if (v === 'mirror') el.innerHTML = '<i></i><i></i>';
    el.addEventListener('animationend', () => el.remove(), { once: true });
    facesEl.appendChild(el);
    if (!o.tile) while (facesEl.children.length > 70) facesEl.firstChild.remove();
  }

  let flashT;
  function flash(v, ms) {
    flashEl.className = 'on ' + (v ?? pick(FLASH_V));
    clearTimeout(flashT);
    flashT = setTimeout(() => { flashEl.className = ''; }, ms ?? rand(70, 150));
  }

  function burst(n) {
    if (reduced) return flash(undefined, 220);
    let i = 0;
    (function f() { flash(undefined, 60); if (++i < n) setTimeout(f, 115); })();
  }

  function shake() {
    if (reduced) return;
    stage.classList.remove('shake');
    void stage.offsetWidth; // restart the animation
    stage.classList.add('shake');
  }

  function scramble(el, text) {
    const glyphs = '▓▒░#@%&/\\<>_';
    let f = 0;
    clearInterval(el._s);
    el._busy = true;
    el._s = setInterval(() => {
      f++;
      el.textContent = [...text].map((c, i) => (i < f / 2 || c === ' ' ? c : pick(glyphs))).join('');
      if (f / 2 >= text.length) { clearInterval(el._s); el.textContent = text; el._busy = false; }
    }, 22);
  }

  // the headline has a "real" text and, when the pointer is elsewhere, a different one
  let baseLine = headline.textContent, showingAlt = false, nearAt = 0;
  function setHeadline(text, quiet) {
    baseLine = text; showingAlt = false; nearAt = performance.now();
    if (quiet) { clearInterval(headline._s); headline._busy = false; headline.textContent = text; }
    else scramble(headline, text);
  }

  const ALT = {
    'He would like to connect.': 'He is already connected.',
    'He would like to connect. Again.': 'You would like to connect. Again.',
    'You came back.': 'He knew you would.',
    'Request accepted.': 'You let him in.',
    'He knows people you know.': 'He knows where you sit.',
    'He can see this screen.': 'He can see you reading this.',
    'He is in the room.': 'He is behind you.',
    'LOOK AT ME.': 'DON’T LOOK AWAY.',
    'You cannot unfriend him.': 'You never wanted to.',
  };

  const LINES = [
    [1, 'Request accepted.', 'You can click again. You will.'],
    [4, 'He knows people you know.', () => timeLine()],
    [8, 'He can see this screen.', () => `${dev.browser} on ${dev.os}. ${screen.width} × ${screen.height}. he can see all of it.`],
    [13, 'He is in the room.', () => batteryLine() || `you have been here ${stay()}. don’t turn around.`],
    [19, 'LOOK AT ME.', 'look at me look at me look at me'],
    [25, 'You cannot unfriend him.', () => `${plural(total, 'click')}. nobody made you.`],
  ];
  const MUTTER = [
    'he was already there', 'he remembers that spot', 'your cursor is warm', 'that is where he was looking',
    'closer', 'he blinked. you missed it', 'smile', 'this is a shared screen',
    'he likes this', 'do not close the tab', 'you look tired',
  ];

  function log(text) {
    const li = document.createElement('li');
    li.textContent = '› ' + text;
    logEl.appendChild(li);
    while (logEl.children.length > 4) logEl.firstChild.remove();
  }

  const nagAt = {};
  function nag(key, text, gap = 9000) {
    const t = performance.now();
    if (!started || locked || t - (nagAt[key] ?? -Infinity) < gap) return;
    nagAt[key] = t;
    log(text);
  }

  function updateCopy(x, y, gap) {
    const line = LINES.find((l) => l[0] === clicks);
    if (line) {
      setHeadline(line[1]);
      sub.textContent = typeof line[2] === 'function' ? line[2]() : line[2];
    }
    friends += Math.floor(rand(2, 30) * (1 + clicks * 0.6));
    friendsEl.textContent = friends.toLocaleString('en-US');
    kicker.textContent = `${plural(total, 'request')} accepted`;
    log(`accepted at (${Math.round(x)}, ${Math.round(y)})`);
    if (clicks > 1) {
      if (gap && gap < 320 && Math.random() < 0.6) log(`${Math.round(gap)}ms since your last click. you are nervous.`);
      else if (gap > 6000) log(`you waited ${Math.round(gap / 1000)} seconds. he liked that.`);
      else if (Math.random() < 0.75) log(Math.random() < 0.65 ? personal() : pick(MUTTER));
    }
    document.title = `(${total}) ${clicks > 12 ? 'he sees you' : 'new connection'}`;
    document.body.classList.toggle('watched', clicks >= 6 && finePointer);
  }

  /* ---- one click ---- */
  let run = 0;               // bumped by Esc; anything mid-sequence checks it and stops
  const ABORT = {};
  async function wait(ms, id) { await sleep(ms); if (id !== run) throw ABORT; }

  let heldLast = false, idleGrow = 0, nudge = 0, calm = false, calmClick = null;

  function hit(x, y) {
    if (!started || locked) return;
    const t = performance.now(), gap = lastClickAt ? t - lastClickAt : 0;
    lastClickAt = t;
    clicks++; total++;
    mem.clicks = prev.clicks + total;
    store.set(mem);
    lastAct = t; idleFired = false; idleGrow = 0;
    idleEl.classList.remove('on');

    // sometimes nothing happens. then it does.
    if (clicks >= 5 && clicks < FINALE && !heldLast && Math.random() < 0.24) {
      heldLast = true;
      return hold(x, y, gap);
    }
    heldLast = false;
    land(x, y, gap, false);
  }

  async function hold(x, y, gap) {
    const id = run;
    locked = true;
    hush(true);
    facesEl.innerHTML = ''; flashEl.className = '';
    document.body.classList.add('hold');
    log('…');
    try { await wait(rand(1500, 3200), id); } catch (e) { return; }
    document.body.classList.remove('hold');
    hush(false);
    locked = false;
    land(x, y, gap, true);
  }

  function land(x, y, gap, hard) {
    const l = tension();
    sting((x / innerWidth) * 2 - 1, hard);
    spawn(x, y, { w: rand(190, Math.min(innerWidth * 0.5, 400)) * (hard ? 1.7 : 1), d: hard ? 2.2 : undefined });
    const extra = Math.floor(l * 10) + (clicks > 3 ? 1 : 0) + (hard ? 5 : 0);
    for (let i = 0; i < extra; i++) {
      setTimeout(() => spawn(rand(0, innerWidth), rand(0, innerHeight)), rand(0, 380));
    }
    if (hard) burst(7);
    else if (clicks > 11 && Math.random() < 0.55) burst(3 + Math.floor(l * 3));
    else flash();
    shake();
    setTension(l);
    updateCopy(x, y, gap);
    if (clicks >= FINALE) finale();
  }

  /* ---- he fills the screen ---- */
  async function typeDark(lines, id) {
    darkEl.innerHTML = '';
    for (const text of lines) {
      const p = document.createElement('p');
      darkEl.appendChild(p);
      for (const ch of text) {
        p.textContent += ch;
        await wait(ch === ' ' ? 16 : rand(14, 36), id);
      }
      await wait(rand(620, 950), id);
    }
  }

  async function finale() {
    locked = true;
    try { await finaleSteps(run); } catch (e) { if (e !== ABORT) throw e; }
  }

  async function finaleSteps(id) {
    // 1. the wall
    const size = Math.max(84, Math.min(innerWidth, innerHeight) / 5.5), h = size * 409 / 307;
    const cells = [];
    for (let r = 0; r < Math.ceil(innerHeight / h); r++)
      for (let c = 0; c < Math.ceil(innerWidth / size); c++) cells.push([c * size + size / 2, r * h + h / 2]);
    cells.sort(() => Math.random() - 0.5);

    const dur = 2600;
    if (ctx) riser(dur / 1000 + 0.15);
    setHeadline('HE IS EVERYWHERE.');
    for (const [x, y] of cells) {
      spawn(x, y, { w: size, r: 0, d: 8, tile: true, v: pick(['', '', 'inv', 'red', 'burn', 'hue']) });
      await wait(dur / cells.length, id);
    }
    burst(7); shake();
    if (ctx) scream(now() + 0.01, 0);
    await wait(820, id);

    // 2. dark, total silence, and what he knows about you
    blackEl.classList.add('on');
    facesEl.innerHTML = '';
    hush(true);
    await wait(1700, id);
    const extra = leaves ? `you tried to leave ${plural(leaves, 'time')}.`
      : prev.visits ? `this is visit ${prev.visits + 1}. the last one was ${ago(prev.last)}.`
      : batteryLine();
    const lines = [
      timeLine(),
      `${dev.browser} on ${dev.os}. ${screen.width} × ${screen.height}.`,
      extra,
      `you have been here ${stay()}.`,
      `${plural(total, 'click')}. nobody made you.`,
      'he is going to stop now.',
    ].filter(Boolean);
    await typeDark(lines, id);
    await wait(900, id);

    // 3. false calm: the page looks reset. it waits for a click, or gets bored
    darkEl.innerHTML = '';
    blackEl.classList.remove('on');
    calm = true;
    document.body.classList.remove('watched');
    setHeadline('He would like to connect.', true);
    sub.textContent = 'Click anywhere to accept.';
    kicker.textContent = '1 new connection request';
    logEl.innerHTML = '';
    await Promise.race([sleep(rand(3400, 4800)), new Promise((r) => { calmClick = r; })]);
    calmClick = null;
    if (id !== run) throw ABORT;

    // 4. the real one
    calm = false;
    hush(false);
    rushEl.classList.add('on');
    if (ctx && ctx.state === 'running') {
      const t = now() + 0.005;
      slam(t); scream(t, 0); screech(t, -0.6); screech(t + 0.05, 0.6); stabs(t + 0.3, 0);
    }
    burst(8); shake();
    await wait(1150, id);
    rushEl.classList.remove('on');

    // 5. after
    finalNote.textContent = `He will remember ${dev.browser} on ${dev.os}.`;
    finalEl.classList.add('on');
    if (ctx) pianoHit(now() + 0.05);
    await wait(4600, id);

    sting(0); burst(5);
    finalEl.classList.remove('on');
    clicks = 0; rounds++;
    mem.finales = prev.finales + rounds;
    store.set(mem);
    setTension(0);
    setHeadline('He would like to connect. Again.');
    sub.textContent = `You have accepted ${plural(rounds, 'time')}. Click anywhere.`;
    lastAct = performance.now();
    locked = false;
  }

  /* ================================================================
     WIRING
     ================================================================ */
  // returning visitors get a different door
  if (prev.visits) {
    $('#gateTitle').textContent = 'You came back. It still flashes and screams.';
    $('#gateNote').textContent = `Visit ${prev.visits + 1}. The last one was ${ago(prev.last)}.`
      + (prev.clicks ? ` You clicked ${plural(prev.clicks, 'time')}.` : '');
    $('#enter').textContent = 'I understand. Let him in again.';
    setHeadline('You came back.', true);
    sub.textContent = prev.clicks ? `Last time you clicked ${plural(prev.clicks, 'time')}. He counted.` : 'Click anywhere. You know how this goes.';
    kicker.textContent = `visit ${prev.visits + 1}`;
  }

  function enter() {
    gate.classList.add('gone');
    if (!ctx) initAudio(); else ctx.resume();
    started = true;
    if (!enteredAt) enteredAt = performance.now();
    lastAct = lastMoveAt = nearAt = performance.now();
  }

  function stopEverything() { // Esc, at any point
    if (!started) return;
    run++;
    started = false; locked = false; calm = false;
    if (calmClick) { calmClick(); calmClick = null; }
    if (clicks >= FINALE) clicks = 0;
    hush(false);
    if (ctx) ctx.suspend();
    facesEl.innerHTML = ''; darkEl.innerHTML = ''; flashEl.className = '';
    [blackEl, finalEl, rushEl, idleEl].forEach((el) => el.classList.remove('on'));
    document.body.classList.remove('hold');
    gate.classList.remove('gone');
  }

  function toggleMute() {
    muted = !muted;
    muteBtn.textContent = muted ? 'sound off' : 'sound on';
    if (ctx && !silent) master.gain.setTargetAtTime(muted ? 0 : 0.9, now(), 0.03);
  }

  $('#enter').addEventListener('click', enter);
  muteBtn.addEventListener('click', toggleMute);

  addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('[data-nohit]')) return;
    if (calmClick) return calmClick();
    hit(e.clientX, e.clientY);
  });

  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return stopEverything();
    if (!started || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'm' || e.key === 'M') return toggleMute();
    if (calmClick) return calmClick();
    hit(rand(innerWidth * 0.15, innerWidth * 0.85), rand(innerHeight * 0.15, innerHeight * 0.85));
  });

  // pointer light, lagging eyes, and the face that turns to follow
  let px = innerWidth / 2, py = innerHeight / 2, cx = px, cy = py, lastLo = '';
  addEventListener('pointermove', (e) => {
    travel += Math.hypot(e.clientX - px, e.clientY - py);
    px = e.clientX; py = e.clientY;
    lastMoveAt = performance.now(); stillSaid = false;
  }, { passive: true });

  (function frame() {
    cx += (px - cx) * 0.16; cy += (py - cy) * 0.16;
    stage.style.setProperty('--mx', px + 'px');
    stage.style.setProperty('--my', py + 'px');
    cursorEl.style.transform = `translate(${cx}px, ${cy}px)`;

    const l = tension();
    if (idleEl.classList.contains('on')) idleGrow = Math.min(idleGrow + 0.00016, 0.15);
    idleEl.style.setProperty('--lx', ((cx / innerWidth) * 2 - 1).toFixed(3));
    idleEl.style.setProperty('--ly', ((cy / innerHeight) * 2 - 1).toFixed(3));
    idleEl.style.setProperty('--ls', (0.96 + 0.1 * l + nudge + idleGrow).toFixed(4));
    const lo = (calm ? 0 : Math.min(l * 0.3 + nudge * 0.6, 0.45)).toFixed(2);
    if (lo !== lastLo) { lastLo = lo; idleEl.style.setProperty('--lo', lo); }
    requestAnimationFrame(frame);
  })();

  // trying to leave
  document.documentElement.addEventListener('mouseleave', () => {
    if (!started || locked || clicks < 2) return;
    log('where are you going');
    whisper(rand(-1, 1));
    flash('eyes', 90);
  });

  // looking away: he moves, and the page is not what it was
  function away() {
    if (!started || awayAt) return;
    awayAt = performance.now();
    document.title = 'come back';
  }
  function back() {
    if (!awayAt) return;
    const gone = performance.now() - awayAt;
    awayAt = 0;
    document.title = `(${total || 1}) ${clicks > 12 ? 'he sees you' : 'new connection'}`;
    if (!started || locked || gone < 1500) return;
    leaves++;
    const s = Math.round(gone / 1000);
    setHeadline(pick(['He moved while you were gone.', 'You looked away.', 'He is closer now.']), true);
    sub.textContent = `you were gone ${plural(s, 'second')}. he was not.`;
    log(`you left ${plural(leaves, 'time')}. you came back ${plural(leaves, 'time')}.`);
    nudge = Math.min(nudge + 0.07, 0.35);
    idleEl.classList.add('on');
    const id = run;
    setTimeout(() => {
      if (id !== run || !started || locked) return;
      flash('eyes', 130); sting(0); shake();
    }, rand(600, 1500));
  }
  document.addEventListener('visibilitychange', () => (document.hidden ? away() : back()));
  addEventListener('blur', away);
  addEventListener('focus', back);

  addEventListener('wheel', () => nag('wheel', 'there is nothing below this.'), { passive: true });
  addEventListener('resize', () => nag('resize', `${innerWidth} × ${innerHeight}. changing the window does not help.`, 4000));
  addEventListener('contextmenu', () => nag('menu', 'look closer. he does not mind.'));

  // four times a second: the headline that changes when you are not on it, and staring at his eyes
  let dwell = 0, stareAt = -Infinity;
  setInterval(() => {
    if (!started || locked) return;
    const t = performance.now();
    const r = headline.getBoundingClientRect(), m = 80;
    const near = px > r.left - m && px < r.right + m && py > r.top - m && py < r.bottom + m;
    if (near) nearAt = t;
    if (!headline._busy) {
      if (!near && !showingAlt && ALT[baseLine] && t - nearAt > 2600) {
        headline.textContent = ALT[baseLine];
        showingAlt = true;
      } else if (near && showingAlt) {
        showingAlt = false;
        setTimeout(() => { if (!showingAlt && !headline._busy) headline.textContent = baseLine; }, 280);
      }
    }
    if (finePointer && (idleEl.classList.contains('on') || tension() > 0.25)) {
      const f = idleEl.getBoundingClientRect();
      const onEyes = px > f.left + f.width * 0.22 && px < f.left + f.width * 0.78
        && py > f.top + f.height * 0.34 && py < f.top + f.height * 0.5;
      dwell = onEyes ? dwell + 250 : 0;
      if (dwell >= 2500 && t - stareAt > 12000) {
        stareAt = t; dwell = 0;
        log('do not look at the eyes');
        flash('eyes inv', 170); sting(0); shake();
      }
    }
  }, 250);

  // once a second: clock, idle stare, and things that happen on their own
  setInterval(() => {
    clockEl.textContent = new Date().toTimeString().slice(0, 8);
    if (!started || locked) return;
    const t = performance.now();
    zone[px < innerWidth / 2 ? 'left' : 'right']++;

    if (t - lastAct > 7000 && !idleFired) {
      idleFired = true;
      idleEl.classList.add('on');
      whisper(rand(-1, 1));
      log(clicks ? 'he is waiting' : 'click');
    }
    const still = t - lastMoveAt;
    if (finePointer && still > 6000 && !stillSaid && clicks >= 2) {
      stillSaid = true;
      log(`you have not moved in ${Math.round(still / 1000)} seconds. neither has he.`);
    }
    const l = tension();
    if (clicks >= 3 && Math.random() < 0.07) log(personal());
    if (clicks >= 9 && Math.random() < l * 0.7) {
      spawn(rand(0, innerWidth), rand(0, innerHeight), { w: rand(90, 240) });
      if (Math.random() < 0.18) { flash(); whisper(rand(-1, 1)); }
    }
  }, 1000);
})();
