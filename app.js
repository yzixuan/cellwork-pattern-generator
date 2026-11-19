(() => {
  "use strict";
  const GIF_URL = "https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js";
  const MUXER_URL = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.mjs";

  const FORMATS = {
    "16:9": { w: 1920, h: 1080, label: "16:9 · 1920 × 1080" },
    "1:1": { w: 1080, h: 1080, label: "Square · 1080 × 1080" },
    "4:5": { w: 1080, h: 1350, label: "Portrait 4:5 · 1080 × 1350" },
    "9:16": { w: 1080, h: 1920, label: "Story 9:16 · 1080 × 1920" },
    og: { w: 1200, h: 630, label: "Link preview · 1200 × 630" },
    banner: { w: 1500, h: 500, label: "Banner 3:1 · 1500 × 500" },
  };
  const SWATCHES = [
    ["#B18CFF", "Lavender"], ["#1EFFB0", "Mint"], ["#D9A77E", "Sand"],
    ["#4C9DFF", "Sky blue"], ["#EDEAF1", "Chalk"], ["#FF7A5C", "Coral"],
  ];

  const DEFAULTS = {
    generator: "waves", seed: 310, scale: 100, complexity: 3, distortion: 50,
    shape: "dot", spacing: 16, dotSize: 90, mapping: "both", shades: 5, threshold: 8, texture: 10,
    mode: "ambient", loop: 6,
    tone: "dark", color: "#B18CFF", opacity: 95, grain: 16,
    textOn: false, caption: "Category", headline: "Your headline here", subtitle: "A short line of supporting text", showCaption: false, showHeadline: true, showSubtitle: false, textFont: "sans", textPos: "bl", textSize: 86,
    format: "16:9", fileType: "mp4", fileTypeChosen: false, stillAuto: false, lastMotionType: "mp4", pngScale: 1, filename: "",
  };

  let S = { ...DEFAULTS };
  // People who ask their system for reduced motion start with Animation off.
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) S.mode = "off";
  try { Object.assign(S, JSON.parse(localStorage.getItem("cellwork-v1") || "{}")); } catch (e) {}
  if (S.shape === "bar") S.shape = "diamond";
  if (!["png", "svg", "mp4", "gif", "html"].includes(S.fileType)) S.fileType = "png";
  S.filename = ""; // the File name field is hidden, so always use the automatic name
  // File type follows Animation until someone picks one: Video when it's on, PNG when it's off.
  if (!S.fileTypeChosen) S.fileType = S.mode === "off" ? "png" : "mp4";
  if (S.mode === "off" && (S.fileType === "mp4" || S.fileType === "gif")) {
    S.lastMotionType = S.fileType; S.fileType = "png"; S.stillAuto = true;
  }
  if (S.mode !== "off") S.mode = "ambient"; // Reveal was removed; a saved Reveal becomes On
  // Move untouched copies of the old default text onto the new defaults.
  if (S.caption === "Side project") S.caption = DEFAULTS.caption;
  if (S.headline === "Generative Art, After Hours") S.headline = DEFAULTS.headline;
  // "Value sets" is hidden for now, so don't leave anyone stuck on a choice they can't see.
  S.mapping = "both";

  // The drawing engine (engine.js), bound to the live settings object.
  const engine = createCellworkEngine(S);
  const { GENS, GLYPHS, TEXT_FONTS, buildP, buildColours, layout, textItems, paint } = engine;

  if (S.generator === "lsystem") S.generator = "trees"; // renamed from L-Systems
  // A saved choice may point at a pattern that's gone or hidden; fall back before the menu is built.
  if (!GENS[S.generator] || GENS[S.generator].hidden) S.generator = DEFAULTS.generator;

  // Canvas text doesn't trigger web-font loading, so load the chosen face before drawing with it.
  function loadTextFont() {
    const F = TEXT_FONTS[S.textFont] || TEXT_FONTS.sans;
    return Promise.all([F.head, F.label, 400].map((w) => document.fonts.load(`${w} 40px "${F.family}"`)))
      .then(() => { dirty = true; }, () => {});
  }

  /* ---------- preview ---------- */
  const view = document.getElementById("view");
  const vctx = view.getContext("2d");
  const frameEl = document.getElementById("frame");
  let clock = 0, last = performance.now(), dirty = true;
  const fmt = () => FORMATS[S.format] || FORMATS["16:9"];

  function fitView() {
    const { w, h } = fmt();
    const r = frameEl.getBoundingClientRect();
    const availW = Math.max(40, r.width), availH = Math.max(40, r.height);
    const cw = Math.min(availW, availH * (w / h));
    const ch = cw * (h / w);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.style.width = cw + "px";
    view.style.height = ch + "px";
    view.width = Math.round(cw * dpr);
    view.height = Math.round(ch * dpr);
    dirty = true;
  }
  new ResizeObserver(fitView).observe(frameEl);

  // Animation Off stops the clock, so the preview (and still exports) freeze on the current frame.
  function previewTime() {
    return clock;
  }
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    let animating = false;
    if (S.mode === "ambient") { clock += dt; animating = true; }
    if (animating || dirty) {
      paint(vctx, view.width, view.height, view.width / fmt().w, previewTime(now));
      dirty = false;
    }
    requestAnimationFrame(tick);
  }

  /* ---------- controls ---------- */
  const controls = document.getElementById("controls");
  const binders = {};
  const h = (tag, attrs = {}, kids = []) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "text") e.textContent = v; else if (k.startsWith("on")) e.addEventListener(k.slice(2), v); else e.setAttribute(k, v);
    }
    for (const k of [].concat(kids)) if (k) e.append(k);
    return e;
  };
  function group(title, headExtra) {
    const g = h("section", { class: "group" }, [h("div", { class: "group-head" }, [h("h2", { text: title }), headExtra])]);
    controls.append(g);
    return g;
  }
  function row(g, label, ctl, id) {
    const r = h("div", { class: "row" }, [id ? h("label", { for: id, text: label }) : h("span", { class: "label", text: label }), ctl]);
    g.append(r);
    return r;
  }
  function slider(key, min, max, step, unit = "") {
    const id = "c-" + key;
    const input = h("input", { type: "range", id, min, max, step, value: S[key] });
    const out = h("output", { for: id });
    const sync = () => { input.value = S[key]; out.textContent = S[key] + unit; input.style.setProperty("--p", ((S[key] - min) / (max - min)) * 100 + "%"); };
    input.addEventListener("input", () => set(key, +input.value));
    binders[key] = sync; sync();
    return h("div", { class: "slider" }, [input, out]);
  }
  function seg(key, opts, labelledBy) {
    const btns = opts.map(([v, label, icon]) => {
      const b = h("button", { type: "button", "data-v": String(v), onclick: () => set(key, v) });
      if (icon) { b.innerHTML = icon; b.setAttribute("aria-label", label); b.title = label; } else b.textContent = label;
      return b;
    });
    const sync = () => btns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === String(S[key]))));
    binders[key] = sync; sync();
    return h("div", { class: "seg", role: "group", "aria-label": labelledBy }, btns);
  }
  function select(key, opts) {
    const id = "c-" + key;
    const el = h("select", { id, class: "field", onchange: (e) => set(key, e.target.value) }, opts.map(([v, l]) => h("option", { value: v, text: l })));
    binders[key] = () => (el.value = S[key]); binders[key]();
    return el;
  }
  function textField(key, placeholder) {
    const id = "c-" + key;
    const el = h("input", { id, class: "field", type: "text", placeholder, value: S[key], oninput: (e) => set(key, e.target.value) });
    binders[key] = () => { if (el.value !== S[key]) el.value = S[key]; };
    return el;
  }

  // Generator
  let g = group("Generator");
  row(g, "Pattern", select("generator", Object.entries(GENS).filter(([, v]) => !v.hidden).map(([k, v]) => [k, v.name])), "c-generator");
  const seedInput = h("input", { id: "c-seed", class: "field", type: "number", min: 0, max: 99999, value: S.seed, oninput: (e) => { const v = parseInt(e.target.value, 10); if (!isNaN(v)) set("seed", v); } });
  binders.seed = () => { if (+seedInput.value !== S.seed) seedInput.value = S.seed; };
  const dice = h("button", { class: "icon-btn", type: "button", title: "New seed", "aria-label": "New seed", onclick: () => set("seed", Math.floor(Math.random() * 9999) + 1) });
  dice.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg>';
  row(g, "Seed", h("div", { class: "combo" }, [seedInput, dice]), "c-seed");
  row(g, "Scale", slider("scale", 40, 300, 5, "%"), "c-scale");
  row(g, "Detail", slider("complexity", 1, 6, 1), "c-complexity");
  const distRow = row(g, "Distortion", slider("distortion", 0, 100, 1), "c-distortion");

  // Cells
  g = group("Cells");
  const icon = (body) => `<svg viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">${body}</svg>`;
  row(g, "Shape", seg("shape", [
    ["dot", "Dot", icon('<circle cx="7" cy="7" r="4.5"/>')],
    ["square", "Square", icon('<rect x="2.5" y="2.5" width="9" height="9" rx=".5"/>')],
    ["diamond", "Diamond", icon('<path d="M7 1.5 12.5 7 7 12.5 1.5 7Z"/>')],
    ["cross", "Cross", icon('<rect x="1.5" y="5.6" width="11" height="2.8"/><rect x="5.6" y="1.5" width="2.8" height="11"/>')],
    ["glyph", "Glyph", icon('<text x="7" y="11" text-anchor="middle" font-family="Geist Mono, monospace" font-size="11" font-weight="600">#</text>')],
  ], "Cell shape"));
  row(g, "Spacing", slider("spacing", 6, 60, 1, "px"), "c-spacing");
  const sizeRow = row(g, "Dot size", slider("dotSize", 10, 100, 1, "%"), "c-dotSize");
  const mapRow = row(g, "Value sets", seg("mapping", [["both", "Both"], ["size", "Size"], ["colour", "Tone"]], "What the pattern value controls"));
  row(g, "Shades", slider("shades", 2, 8, 1), "c-shades");
  row(g, "Threshold", slider("threshold", 0, 60, 1), "c-threshold");
  row(g, "Texture", slider("texture", 0, 100, 1), "c-texture");

  // Motion
  g = group("Motion");
  row(g, "Animation", seg("mode", [["off", "Off"], ["ambient", "On"]], "Animation"));
  const loopRow = row(g, "Loop", slider("loop", 2, 12, 0.5, "s"), "c-loop");

  // Appearance
  g = group("Appearance");
  row(g, "Tone", seg("tone", [["dark", "Dark"], ["light", "Light"]], "Background tone"));
  const swBtns = SWATCHES.map(([c, name]) => h("button", { class: "swatch", type: "button", style: `--c:${c}`, title: name, "aria-label": name, "data-c": c, onclick: () => set("color", c) }));
  const customInput = h("input", { type: "color", "aria-label": "Custom colour", value: S.color, oninput: (e) => set("color", e.target.value.toUpperCase()) });
  const customWrap = h("span", { class: "swatch-custom", title: "Custom colour" }, [customInput]);
  binders.color = () => {
    let matched = false;
    swBtns.forEach((b) => { const on = b.dataset.c.toLowerCase() === S.color.toLowerCase(); matched ||= on; b.setAttribute("aria-pressed", String(on)); });
    customWrap.dataset.on = String(!matched);
    customInput.value = S.color.length === 7 ? S.color.toLowerCase() : "#b18cff";
  };
  binders.color();
  row(g, "Colour", h("div", { class: "swatches" }, [...swBtns, customWrap]));
  row(g, "Opacity", slider("opacity", 10, 100, 1), "c-opacity");
  row(g, "Grain", slider("grain", 0, 100, 1), "c-grain");

  // Text
  // Eye button beside a text field: shows or hides that line without clearing what's typed.
  const EYE_OPEN = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/></svg>';
  const EYE_SHUT = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6.2 3.8A6.6 6.6 0 0 1 8 3.5C12 3.5 14.5 8 14.5 8a12 12 0 0 1-1.7 2.3M4.2 5A12 12 0 0 0 1.5 8S4 12.5 8 12.5c1 0 2-.3 2.8-.7"/><path d="M2 2l12 12"/></svg>';
  function withEye(key, name, field) {
    const btn = h("button", { class: "icon-btn", type: "button", onclick: () => set(key, !S[key]) });
    const wrap = h("div", { class: "combo" }, [field, btn]);
    binders[key] = () => {
      const on = S[key];
      btn.innerHTML = on ? EYE_OPEN : EYE_SHUT;
      btn.setAttribute("aria-pressed", String(on));
      btn.setAttribute("aria-label", `${on ? "Hide" : "Show"} ${name}`);
      btn.title = `${on ? "Hide" : "Show"} ${name}`;
      wrap.dataset.off = String(!on);
    };
    binders[key]();
    return wrap;
  }
  const textToggle = h("button", { class: "toggle", type: "button", onclick: () => set("textOn", !S.textOn) });
  binders.textOn = () => { textToggle.textContent = S.textOn ? "On" : "Off"; textToggle.setAttribute("aria-pressed", String(S.textOn)); textToggle.setAttribute("aria-label", S.textOn ? "Hide text" : "Show text"); };
  binders.textOn();
  const textGroup = group("Text", textToggle);
  const textRows = [
    row(textGroup, "Label", withEye("showCaption", "label", textField("caption", "Category")), "c-caption"),
    row(textGroup, "Headline", withEye("showHeadline", "headline", textField("headline", "Your headline here")), "c-headline"),
    row(textGroup, "Subtitle", withEye("showSubtitle", "subtitle", textField("subtitle", "Optional supporting line")), "c-subtitle"),
    row(textGroup, "Font", seg("textFont", [["sans", "Sans"], ["mono", "Mono"], ["pixel", "Pixel"]], "Text font")),
    row(textGroup, "Position", seg("textPos", [["tl", "Top"], ["center", "Centre"], ["bl", "Bottom"]], "Text position")),
    row(textGroup, "Size", slider("textSize", 24, 160, 2, "px"), "c-textSize"),
  ];

  // Export
  g = group("Export");
  row(g, "Format", select("format", Object.entries(FORMATS).map(([k, v]) => [k, v.label])), "c-format");
  const nameInput = h("input", { id: "c-filename", class: "field", type: "text", spellcheck: "false", oninput: (e) => { S.filename = e.target.value; persist(); } });
  // File name is hidden for now: downloads use the automatic name (pattern + seed, e.g. waves-310).
  const nameRow = row(g, "File name", nameInput, "c-filename");
  nameRow.hidden = true;
  const FILE_TYPES = {
    png: { label: "PNG", run: () => exportPNG(), motion: false },
    svg: { label: "SVG", run: () => exportSVG(), motion: false },
    mp4: { label: "Video (MP4)", run: () => exportVideo(), motion: true },
    gif: { label: "GIF", run: () => exportGIF(), motion: true },
    html: { label: "Code (HTML)", run: () => exportHTML(), motion: false },
  };
  const typeSelect = select("fileType", Object.entries(FILE_TYPES).map(([k, v]) => [k, v.label]));
  row(g, "File type", typeSelect, "c-fileType");
  const pngRow = row(g, "PNG size", seg("pngScale", [[1, "1×"], [2, "2×"]], "PNG resolution"));
  const bDownload = h("button", { class: "btn primary block", type: "button", onclick: () => run(FILE_TYPES[S.fileType].run) }, ["Download"]);
  const bEmbed = h("button", { class: "btn block", type: "button", onclick: () => copyEmbed() }, ["Copy embed code"]);
  // Shown only if the clipboard refuses, so the code can still be selected and copied by hand.
  const embedBox = h("textarea", { class: "field embed-box", readonly: "", rows: "5", "aria-label": "Embed code", spellcheck: "false" });
  embedBox.hidden = true;
  g.append(bDownload, bEmbed, embedBox);
  const progFill = h("div", { class: "progress-fill" });
  const progLabel = h("div", { class: "progress-label" });
  const progress = h("div", { class: "progress" }, [h("div", { class: "progress-track" }, [progFill]), progLabel]);
  progress.hidden = true;
  const hint = h("p", { class: "hint" });
  g.append(progress, hint);

  /* ---------- state changes ---------- */
  const P_KEYS = new Set(["seed", "scale", "complexity", "distortion"]);
  const COLOUR_KEYS = new Set(["color", "tone", "shades", "mapping"]);
  let persistTimer = 0;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => { try { localStorage.setItem("cellwork-v1", JSON.stringify(S)); } catch (e) {} }, 250);
  }
  function autoName() { return `${S.generator}-${S.seed}`; }
  // Patterns can prefer a spacing. Switching patterns moves spacing between the two
  // preferences only if it still sits at the old one, so a custom spacing is kept.
  const prefSpacing = (g) => GENS[g].spacing || DEFAULTS.spacing;
  function set(key, value) {
    const prevAuto = autoName();
    if (key === "generator" && S.spacing === prefSpacing(S.generator)) { S.spacing = prefSpacing(value); binders.spacing?.(); }
    if (key === "generator") {
      // A pattern with a minimum scale raises Scale on the way in; leaving it restores the
      // earlier Scale unless it was changed meanwhile.
      if (S.scaleBump && S.scale === S.scaleBump.to) S.scale = S.scaleBump.from;
      S.scaleBump = null;
      const min = GENS[value].minScale;
      if (min && S.scale < min) { S.scaleBump = { from: S.scale, to: min }; S.scale = min; }
      binders.scale?.();
    }
    S[key] = value;
    if (P_KEYS.has(key) || key === "generator") buildP();
    if (COLOUR_KEYS.has(key)) buildColours();
    if (key === "format") fitView();
    if (key === "fileType") { S.fileTypeChosen = true; S.stillAuto = false; }
    if (key === "mode") {
      // Turning Animation off swaps Video/GIF for PNG; turning it back on restores the motion
      // format, unless a still format was picked on purpose.
      if (value === "off" && FILE_TYPES[S.fileType].motion) {
        S.lastMotionType = S.fileType; S.fileType = "png"; S.stillAuto = true;
      } else if (value !== "off" && (S.stillAuto || !S.fileTypeChosen)) {
        S.fileType = S.stillAuto ? S.lastMotionType || "mp4" : "mp4"; S.stillAuto = false;
      }
      binders.fileType?.();
    }
    if (key === "textFont") loadTextFont();
    if ((key === "generator" || key === "seed") && (!S.filename || S.filename === prevAuto)) S.filename = "";
    binders[key]?.();
    refreshUI();
    persist();
    dirty = true;
  }
  function refreshUI() {
    const f = fmt();
    document.getElementById("caption").textContent = `${GENS[S.generator].name} · Seed ${S.seed} · ${f.w} × ${f.h}`;
    loopRow.hidden = S.mode !== "ambient";
    sizeRow.querySelector("label").textContent = S.shape === "glyph" ? "Glyph size" : S.shape === "dot" ? "Dot size" : "Cell size";
    mapRow.hidden = true; // "Value sets" is hidden for now; see the reset where settings load
    distRow.hidden = !!GENS[S.generator].noDistortion;
    textRows.forEach((r) => (r.hidden = !S.textOn));
    nameInput.placeholder = autoName();
    if (document.activeElement !== nameInput) nameInput.value = S.filename;
    const motion = S.mode !== "off";
    // Video and GIF need motion; keep them listed but unselectable while Motion is off.
    [...typeSelect.options].forEach((o) => (o.disabled = FILE_TYPES[o.value].motion && !motion));
    const blocked = FILE_TYPES[S.fileType].motion && !motion;
    pngRow.hidden = S.fileType !== "png";
    bEmbed.hidden = S.fileType !== "html";
    if (S.fileType !== "html") embedBox.hidden = true;
    bDownload.disabled = busy || blocked;
    const clip = `${S.loop}s seamless loop`;
    hint.innerHTML = blocked
      ? `Turn on Animation to export ${FILE_TYPES[S.fileType].label}, or pick PNG or SVG.`
      : {
          mp4: `${clip}, 1080p.`,
          gif: `${clip}, 720px.`,
          html: `Runs live and loops forever. Open the page in a browser, or paste the embed code into a site.`,
        }[S.fileType] || ""; // stills need no note
    hint.hidden = !hint.innerHTML;
  }

  document.getElementById("shuffle").addEventListener("click", () => {
    const r = Math.random;
    // Patterns with a preferred spacing (the attractors) stay near it; others pick 10–25px.
    const pref = GENS[S.generator].spacing;
    Object.assign(S, {
      seed: Math.floor(r() * 9999) + 1,
      // Patterns with a minimum scale (Clifford) pick from there up to 300%.
      scale: GENS[S.generator].minScale ? GENS[S.generator].minScale + Math.round(r() * ((300 - GENS[S.generator].minScale) / 5)) * 5 : 60 + Math.round(r() * 36) * 5,
      complexity: 1 + Math.floor(r() * 6),
      distortion: Math.round(r() * 100),
      color: SWATCHES[Math.floor(r() * SWATCHES.length)][0],
      spacing: pref ? pref + Math.floor(r() * 5) : 10 + Math.floor(r() * 16),
      shades: 3 + Math.floor(r() * 5),
      // Kept inside ranges that still read well: smaller dots or a higher threshold thin
      // most patterns out to almost nothing.
      dotSize: 55 + Math.round(r() * 45),
      threshold: Math.round(r() * 25),
      texture: Math.round(r() * 40),
    });
    if (S.filename.match(/^[a-z]+-\d+$/)) S.filename = "";
    buildP(); buildColours();
    Object.values(binders).forEach((b) => b());
    refreshUI(); persist(); dirty = true;
  });

  /* ---------- export ---------- */
  let busy = false;
  const toastEl = document.getElementById("toast");
  let toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }
  function setProgress(label, p) {
    progress.hidden = p == null;
    if (p != null) { progFill.style.width = Math.round(p * 100) + "%"; progLabel.textContent = `${label} · ${Math.round(p * 100)}%`; }
  }
  async function run(fn) {
    if (busy) return;
    busy = true; refreshUI();
    try { await loadTextFont(); await document.fonts.ready; await fn(); }
    catch (e) { console.error(e); toast(e && e.message ? e.message : "Export failed"); }
    finally { busy = false; setProgress(null); refreshUI(); }
  }
  const fileBase = () => (S.filename.trim() || autoName()).replace(/\.(png|svg|gif|mp4|webm)$/i, "").replace(/[\\/:*?"<>|]+/g, "-");
  const nextFrame = () => new Promise((r) => setTimeout(r, 0));
  function stillTime() {
    return clock;
  }
  function framePlan(fps) {
    return { frames: Math.round(S.loop * fps) };
  }

  // Inside the Claude viewer, files go through the downloads capability; opened on its own,
  // the page falls back to a normal browser download.
  const downloadsReady = window.claude && typeof window.claude.use === "function" ? window.claude.use("downloads").catch(() => null) : Promise.resolve(null);
  async function saveFile(filename, blob) {
    const dl = await downloadsReady;
    if (dl) {
      try { await dl.save({ filename, data: blob }); toast(`Saved ${filename}`); }
      catch (e) {
        const code = e && e.code;
        if (code === "declined") toast("Save cancelled");
        else if (code === "rate_limited") toast("A save prompt is already open");
        else if (code === "too_large") toast("That file is too large here. Try a smaller format or shorter loop.");
        else toast(`Couldn't save ${filename}: ${(e && e.message) || code || "unknown error"}`);
      }
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast(`Downloaded ${filename}`);
  }

  function makeCanvas(W, H) {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    return c;
  }

  async function exportPNG() {
    const { w, h: hh } = fmt();
    const k = S.pngScale;
    const c = makeCanvas(w * k, hh * k);
    paint(c.getContext("2d"), c.width, c.height, k, stillTime());
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    await saveFile(`${fileBase()}.png`, blob);
  }

  /* ---------- code export ---------- */
  // The player bundles the engine (engine.js) with the current settings. It fills its
  // container, loops (or holds the paused frame), stops drawing while off screen, and shows a
  // still frame to people who ask for reduced motion.
  const FONT_CSS = {
    sans: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap",
    mono: "https://fonts.googleapis.com/css2?family=Geist+Mono:wght@400;500&display=swap",
    pixel: "https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;600&display=swap",
  };
  const RENDER_KEYS = ["generator", "seed", "scale", "complexity", "distortion", "shape", "spacing", "dotSize", "mapping",
    "shades", "threshold", "texture", "mode", "loop", "tone", "color", "opacity", "grain", "textOn", "caption", "headline",
    "subtitle", "showCaption", "showHeadline", "showSubtitle", "textFont", "textPos", "textSize"];
  function engineSource() {
    // Drop block comments, whole-line comments and indentation to keep the embed small.
    // (The engine has no "/*" inside strings, so removing block comments this way is safe.)
    return createCellworkEngine.toString()
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("//")).join("\n");
  }
  function playerSource(mountExpr) {
    const settings = {};
    for (const k of RENDER_KEYS) settings[k] = S[k];
    const f = fmt();
    return [
      "(function () {",
      '"use strict";',
      "var mount = " + mountExpr + ";",
      "var S = " + JSON.stringify(settings) + ";",
      "var BASE_W = " + f.w + ", BASE_H = " + f.h + ", START = " + JSON.stringify(+stillTime().toFixed(3)) + ";",
      "var FONT_CSS = " + JSON.stringify(S.textOn ? FONT_CSS[S.textFont] || FONT_CSS.sans : "") + ";",
      "var engine = (" + engineSource() + ")(S), paint = engine.paint;",
      "engine.buildP(); engine.buildColours();",
      "var canvas = document.createElement('canvas'); canvas.style.cssText = 'display:block;width:100%;height:100%';",
      "mount.appendChild(canvas);",
      "var ctx = canvas.getContext('2d');",
      "var still = S.mode === 'off' || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);",
      "var W = 1, H = 1, t = START, last = 0, raf = 0, onScreen = true;",
      "function draw() { paint(ctx, W, H, Math.sqrt((W * H) / (BASE_W * BASE_H)), t); }",
      "function size() { var d = Math.min(window.devicePixelRatio || 1, 2), r = mount.getBoundingClientRect();",
      "  W = Math.max(1, Math.round(r.width * d)); H = Math.max(1, Math.round(r.height * d)); canvas.width = W; canvas.height = H; draw(); }",
      "function frame(now) { t += Math.min(0.1, (now - last) / 1000); last = now; draw(); raf = requestAnimationFrame(frame); }",
      "function play() { if (still || raf || !onScreen) return; last = performance.now(); raf = requestAnimationFrame(frame); }",
      "function stop() { cancelAnimationFrame(raf); raf = 0; }",
      "if (FONT_CSS) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = FONT_CSS; document.head.appendChild(l); }",
      "if (document.fonts) document.fonts.ready.then(function () { setTimeout(draw, 50); });",
      "new ResizeObserver(size).observe(mount);",
      "new IntersectionObserver(function (e) { onScreen = e[0].isIntersecting; if (onScreen) play(); else stop(); }).observe(mount);",
      "size(); play();",
      "})();",
    ].join("\n");
  }
  function exportHTML() {
    const f = fmt();
    const page = [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      "<title>" + fileBase().replace(/[<&]/g, "") + " · Cellwork Pattern Generator</title>",
      "<style>html,body{margin:0;height:100%;background:" + engine.BG + "}#cellwork{position:fixed;inset:0}</style>",
      "</head>",
      "<body>",
      '<div id="cellwork" role="img" aria-label="Animated generative pattern"></div>',
      "<script>",
      playerSource('document.getElementById("cellwork")'),
      "</" + "script>",
      "</body>",
      "</html>",
    ].join("\n");
    return saveFile(`${fileBase()}.html`, new Blob([page], { type: "text/html" }));
  }
  function embedSnippet() {
    const f = fmt();
    return [
      "<!-- Cellwork Pattern Generator: " + fileBase() + " -->",
      '<div style="position:relative;width:100%;aspect-ratio:' + f.w + " / " + f.h + ";background:" + engine.BG + '" role="img" aria-label="Animated generative pattern"></div>',
      "<script>",
      playerSource("document.currentScript.previousElementSibling"),
      "</" + "script>",
    ].join("\n");
  }
  function copyEmbed() {
    let code;
    try { code = embedSnippet(); } catch (e) { toast(e.message); return; }
    // Called straight from the click so the clipboard allows it; fall back to a selectable box.
    const showBox = () => {
      embedBox.value = code;
      embedBox.hidden = false;
      embedBox.focus();
      embedBox.select();
      toast("Copy the embed code from the box below");
    };
    if (!navigator.clipboard || !navigator.clipboard.writeText) return showBox();
    navigator.clipboard.writeText(code).then(() => { embedBox.hidden = true; toast(`Embed code copied (${Math.round(code.length / 1000)} KB)`); }, showBox);
  }

  function exportSVG() {
    const { w: W, h: H } = fmt();
    const { base, buckets } = layout(W, H, 1, stillTime());
    const f1 = (n) => Math.round(n * 10) / 10;
    const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`, `<rect width="${W}" height="${H}" fill="${engine.BG}"/>`, `<g opacity="${S.opacity / 100}">`];
    buckets.forEach((b, level) => {
      if (!b.length) return;
      const parts = [];
      if (S.shape === "glyph") {
        const ch = GLYPHS[Math.round((level / Math.max(1, S.shades - 1)) * (GLYPHS.length - 1))];
        for (let n = 0; n < b.length; n += 3) parts.push(`<text x="${f1(b[n])}" y="${f1(b[n + 1])}" font-size="${f1(base * 1.3 * b[n + 2])}">${esc(ch)}</text>`);
        out.push(`<g fill="${RAMP[level]}" font-family="Geist Mono, ui-monospace, monospace" font-weight="500" text-anchor="middle" dominant-baseline="central">${parts.join("")}</g>`);
        return;
      }
      for (let n = 0; n < b.length; n += 3) {
        const x = b[n], y = b[n + 1], d = base * b[n + 2];
        if (d <= 0.2) continue;
        if (S.shape === "dot") parts.push(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(d / 2)}"/>`);
        else if (S.shape === "square") parts.push(`<rect x="${f1(x - d / 2)}" y="${f1(y - d / 2)}" width="${f1(d)}" height="${f1(d)}"/>`);
        else if (S.shape === "diamond") parts.push(`<path d="M${f1(x)} ${f1(y - d / 2)}L${f1(x + d / 2)} ${f1(y)}L${f1(x)} ${f1(y + d / 2)}L${f1(x - d / 2)} ${f1(y)}Z"/>`);
        else { const t = Math.max(1, d * 0.28); parts.push(`<rect x="${f1(x - d / 2)}" y="${f1(y - t / 2)}" width="${f1(d)}" height="${f1(t)}"/><rect x="${f1(x - t / 2)}" y="${f1(y - d / 2)}" width="${f1(t)}" height="${f1(d)}"/>`); }
      }
      out.push(`<g fill="${RAMP[level]}">${parts.join("")}</g>`);
    });
    out.push("</g>");
    for (const t of textItems(W, H, 1)) {
      out.push(`<text x="${f1(t.x)}" y="${f1(t.y)}" fill="${engine.INK}" fill-opacity="${t.alpha}" font-family="${t.family}, sans-serif" font-weight="${t.weight}" font-size="${f1(t.size)}" letter-spacing="${f1(t.spacing)}" text-anchor="${t.align === "center" ? "middle" : "start"}">${esc(t.text)}</text>`);
    }
    out.push("</svg>");
    return saveFile(`${fileBase()}.svg`, new Blob([out.join("\n")], { type: "image/svg+xml" }));
  }

  async function exportGIF() {
    const { GIFEncoder, quantize, applyPalette } = await import(GIF_URL);
    const { w, h: hh } = fmt();
    const k = Math.min(1, 720 / Math.max(w, hh));
    const W = Math.round(w * k), H = Math.round(hh * k);
    const fps = 20;
    const { frames } = framePlan(fps);
    const c = makeCanvas(W, H);
    const ctx = c.getContext("2d", { willReadFrequently: true });
    // One shared palette, built from a few frames across the loop.
    const samples = [0, Math.floor(frames / 3), Math.floor((2 * frames) / 3)];
    const pool = new Uint8ClampedArray(W * H * 4 * samples.length);
    samples.forEach((f, i) => { paint(ctx, W, H, k, f / fps, true); pool.set(ctx.getImageData(0, 0, W, H).data, i * W * H * 4); });
    const palette = quantize(pool, 256, { format: "rgb444" });
    const gif = GIFEncoder();
    for (let i = 0; i < frames; i++) {
      paint(ctx, W, H, k, i / fps, true);
      const index = applyPalette(ctx.getImageData(0, 0, W, H).data, palette, "rgb444");
      gif.writeFrame(index, W, H, i === 0 ? { palette, delay: 1000 / fps, repeat: 0 } : { delay: 1000 / fps });
      setProgress("Encoding GIF", (i + 1) / frames);
      if (i % 3 === 0) await nextFrame();
    }
    gif.finish();
    await saveFile(`${fileBase()}.gif`, new Blob([gif.bytes()], { type: "image/gif" }));
  }

  async function exportVideo() {
    const { w, h: hh } = fmt();
    const k = Math.min(1, 1920 / Math.max(w, hh));
    const W = Math.round((w * k) / 2) * 2, H = Math.round((hh * k) / 2) * 2;
    const fps = 30;
    const { frames } = framePlan(fps);
    const c = makeCanvas(W, H);
    const ctx = c.getContext("2d");

    let config = null;
    if ("VideoEncoder" in window) {
      for (const codec of ["avc1.640028", "avc1.4d0028", "avc1.42e028"]) {
        const cfg = { codec, width: W, height: H, bitrate: 12_000_000, framerate: fps };
        try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) { config = cfg; break; } } catch (e) {}
      }
    }

    if (config) {
      const { Muxer, ArrayBufferTarget } = await import(MUXER_URL);
      const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: "avc", width: W, height: H, frameRate: fps }, fastStart: "in-memory" });
      let failure = null;
      const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failure = e) });
      enc.configure(config);
      for (let i = 0; i < frames; i++) {
        if (failure) throw failure;
        paint(ctx, W, H, k, i / fps);
        const vf = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
        enc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
        vf.close();
        setProgress("Encoding MP4", (i + 1) / frames);
        if (enc.encodeQueueSize > 6) await new Promise((r) => enc.addEventListener("dequeue", r, { once: true }));
        else if (i % 4 === 0) await nextFrame();
      }
      await enc.flush();
      if (failure) throw failure;
      muxer.finalize();
      await saveFile(`${fileBase()}.mp4`, new Blob([muxer.target.buffer], { type: "video/mp4" }));
      return;
    }

    // Fallback for browsers without WebCodecs: record in real time to WebM.
    const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error("This browser can't encode video. Try Chrome, Edge or Safari, or export a GIF.");
    const stream = c.captureStream(fps);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10_000_000 });
    const chunks = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => (rec.onstop = r));
    paint(ctx, W, H, k, 0);
    rec.start();
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) {
      paint(ctx, W, H, k, i / fps);
      setProgress("Recording WebM", (i + 1) / frames);
      const wait = t0 + ((i + 1) * 1000) / fps - performance.now();
      await new Promise((r) => setTimeout(r, Math.max(0, wait)));
    }
    rec.stop();
    await stopped;
    await saveFile(`${fileBase()}.webm`, new Blob(chunks, { type: "video/webm" }));
  }

  /* ---------- start ---------- */
  if (!FORMATS[S.format]) S.format = DEFAULTS.format;
  buildP();
  buildColours();
  refreshUI();
  fitView();
  document.fonts.ready.then(() => (dirty = true));
  loadTextFont();
  requestAnimationFrame(tick);
})();
