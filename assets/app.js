(() => {
  const PAGE = 120;
  const $ = s => document.querySelector(s);
  const grid = $('#grid'), tagsEl = $('#tags'), q = $('#q');
  const state = { src: 'all', tags: new Set(), q: '', sort: 'newest', tq: '', allTags: false };
  const TOP = 24;
  let all = [], view = [], shown = 0;
  const shuf = new Map(); // item id -> random rank for the current shuffle
  try { const sv = localStorage.getItem('dv-sort'); if (sv && sv !== 'shuffle') state.sort = sv; } catch {}
  const ls = (k, d) => { try { return new Set(JSON.parse(localStorage.getItem(k)) || d); } catch { return new Set(d); } };
  // Owner mode: likes/removals/suggestion decisions persist server-side (/vault/api, signed-in owner only).
  // Visitors get a read-only vault; `removed` is the public server overlay applied for everyone.
  const liked = new Set(), removed = new Set();
  const own = { on: false, mode: 'vault', sug: [] };
  const legacy = { liked: ls('dv-liked', []), removed: ls('dv-removed', []) }; // pre-owner-mode local state, migrated on first sign-in
  const persist = () => {};
  const inSrc = it => own.mode === 'sug' || state.src === 'all' || (state.src === 'liked' ? liked.has(it.id) : it.source === state.src);
  const pool = () => own.mode === 'sug' ? own.sug : all;
  const API = 'api/';
  const api = async (path, body) => {
    const r = await fetch(API + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin', cache: 'no-store' } : { credentials: 'same-origin', cache: 'no-store' });
    const ct = r.headers.get('content-type') || '';
    const j = ct.includes('json') ? await r.json().catch(() => ({})) : {};
    if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return j;
  };
  const HIDDEN_TAGS = new Set(['bookmark']);

  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const host = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const label = it => it.title || (it.author ? '@' + it.author : '') || host(it.sourceUrl || it.url);
  // Self-hosted media (MEDIA_BASE builds only): upgraded videos carry mediaLiteUrl. Tiles on small screens or
  // slow/save-data connections play the lite file; the expanded view and desktop always use full-quality mediaUrl.
  const liteOK = () => { const c = navigator.connection || {};
    return matchMedia('(max-width: 800px)').matches || !!c.saveData || /2g|3g/.test(c.effectiveType || ''); };
  const tileSrc = it => (it.mediaLiteUrl && liteOK()) ? it.mediaLiteUrl : it.mediaUrl;
  // Multi-media items (several photos/videos): `media` list, entry 0 = the top-level media the tile shows.
  const mlist = it => Array.isArray(it.media) && it.media.length > 1 && it.media.every(m => m && m.url) ? it.media : null;
  const MM_IC = '<svg viewBox="0 0 12 12" aria-hidden="true"><rect x="3.6" y=".8" width="7.6" height="7.6" rx="1.6"/><path d="M1 3.6v5.8A1.8 1.8 0 0 0 2.8 11.2h5.8"/></svg>';
  // Video time left (`.vt`, top-left of video tiles / pages): remaining = duration - currentTime, m:ss (h:mm:ss >= 1h).
  // One capturing listener for every video; only playing videos fire timeupdate (off-screen tiles are paused by vio),
  // and the label is written only when the shown second changes.
  const fmtT = sec => { const s = Math.max(0, Math.ceil(sec - 0.05)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
  const vtTick = e => {
    const v = e.target; if (!v || v.tagName !== 'VIDEO' || !v.parentElement) return;
    if (v.classList.contains('xfull') && !v.classList.contains('on')) return;    // hidden full-quality copy: the lite one drives
    if (!e.type.startsWith('load') && e.type !== 'durationchange' && v.nextElementSibling && v.nextElementSibling.classList.contains('xfull') && v.nextElementSibling.classList.contains('on')) return;
    const l = v.parentElement.querySelector(':scope > .vt, :scope > .vbar > .vt'); if (!l) return;
    const d = v.duration; if (!isFinite(d) || d <= 0) return;
    const t = fmtT(d - (v.currentTime || 0)); if (l.textContent !== t) l.textContent = t;
  };
  ['timeupdate', 'loadedmetadata', 'durationchange', 'seeked'].forEach(t => document.addEventListener(t, vtTick, true));
  // Sound: grid tiles always play muted; the expanded view (a tap = user gesture) plays its video with sound, with a
  // tiny mute toggle (`.vm`, same size as `.vt`) next to the time left — only for videos with an audio track
  // (items.json hasAudio from the build's ffprobe; runtime detection when unknown).
  const audioAttr = a => a === true ? ' data-audio="1"' : a === false ? ' data-audio="0"' : '';
  const hasAudio = v => v.dataset.audio === '1' ? true : v.dataset.audio === '0' ? false
    : (v.mozHasAudio || (v.audioTracks && v.audioTracks.length > 0) || v.webkitAudioDecodedByteCount > 0) ? true : null;
  const SND_IC = m => `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M1.6 4.4h1.9L6.2 2.1v7.8L3.5 7.6H1.6z"/>${m ? '<path d="M8.3 4.6l2.8 2.8M11.1 4.6L8.3 7.4"/>' : '<path d="M8.2 4.3a2.4 2.4 0 0 1 0 3.4M9.7 2.8a4.5 4.5 0 0 1 0 6.4"/>'}</svg>`;

  // Lazy video play: only play visible videos
  const vio = new IntersectionObserver(es => es.forEach(e => {
    const v = e.target;
    if (v.closest('.xv')) { if (v.closest('.pg.off') && !v.paused) v.pause(); return; } // expanded pager drives it
    if (e.isIntersecting) {
      if (!v.getAttribute('src') && v.dataset.src) { v.src = v.dataset.src; v.load(); }
      const pr = v.play(); if (pr) pr.catch(() => {}); // autoplay may be refused (Low Power Mode); the poster stays visible
    } else if (!v.paused) v.pause();
  }), { rootMargin: '200px' });

  function reflowSoon() { masSchedule(false); }
  function card(it) {
    const a = document.createElement('a');
    a.href = it.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.title = label(it);
    const src = it.source === 'x' ? 'X' : it.source === 'savee' ? 'Savee' : it.source === 'cosmos' ? 'Cosmos' : it.source === 'savee-email' ? 'Savee picks' : 'Curated';
    const sub = [own.mode === 'sug' && it.digest ? 'Suggested · ' + src : src, it.author ? '@' + it.author : host(it.sourceUrl || ''), it.sourceUrl && it.author ? host(it.sourceUrl) : ''].filter(Boolean).join(' · ');
    const subH = esc(sub) + (it.why ? `</div><div class="why">${esc(it.why)}` : '');
    const ar = it.width && it.height ? `--ar:${it.width}/${it.height}` : '';
    const bg = it.colors && it.colors[0] ? `background:${it.colors[0]}22;` : '';
    if (it.mediaType === 'image' && it.mediaUrl) {
      a.className = 'card';
      a.innerHTML = `<img class="${ar ? 'ph' : ''}" style="${ar};${bg}" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(it.mediaUrl)}" alt="">
        <div class="meta"><div class="t">${esc(label(it))}</div><div class="s">${subH}</div></div>`;
    } else if (it.mediaType === 'video' && it.mediaUrl) {
      a.className = 'card';
      a.innerHTML = `<video class="${ar ? 'ph' : ''}" style="${ar};${bg}" muted loop playsinline webkit-playsinline disableremoteplayback referrerpolicy="no-referrer" preload="${it.posterUrl ? 'none' : 'metadata'}" ${it.posterUrl ? `poster="${esc(it.posterUrl)}"` : ''} data-src="${esc(tileSrc(it))}"${tileSrc(it) !== it.mediaUrl ? ` data-full="${esc(it.mediaUrl)}"` : ''}${audioAttr(it.hasAudio)}></video>
        <span class="vt">${(mlist(it) && mlist(it)[0].durationMs) || it.durationMs ? fmtT(((mlist(it) && mlist(it)[0].durationMs) || it.durationMs) / 1000) : ''}</span>
        <div class="meta"><div class="t">${esc(label(it))}</div><div class="s">${subH}</div></div>`;
      vio.observe(a.querySelector('video'));
    } else {
      a.className = 'card link';
      a.innerHTML = `<span class="badge">${esc(src)}</span><div class="t">${esc(label(it))}</div>
        ${it.text && it.text !== it.title ? `<div class="txt">${esc(it.text)}</div>` : ''}<div class="s">${esc(host(it.url))}</div>`;
    }
    const m = a.querySelector('img,video');
    // media size changes (natural ratio known, poster fallback, broken) restack the masonry columns
    if (m) { m.addEventListener('load', reflowSoon); m.addEventListener('loadedmetadata', reflowSoon); }
    if (m) m.addEventListener('error', () => {
      if (m.tagName === 'VIDEO' && it.posterUrl && !a.dataset.fb) { // fall back to poster image
        a.dataset.fb = 1; a.querySelector(':scope > .vt')?.remove(); const img = document.createElement('img'); img.src = it.posterUrl; img.referrerPolicy = 'no-referrer';
        img.onload = reflowSoon; img.onerror = () => { a.classList.add('broken'); reflowSoon(); }; m.replaceWith(img); reflowSoon(); return;
      }
      a.classList.add('broken'); reflowSoon();
    });
    a.dataset.id = it.id;
    const ml = it.mediaUrl && it.mediaType !== 'link' ? mlist(it) : null;
    if (ml) { a.classList.add('multi'); a.insertAdjacentHTML('beforeend', `<span class="mm" aria-label="${ml.length} items">${MM_IC}${ml.length}</span>`); }
    if (liked.has(it.id)) a.insertAdjacentHTML('beforeend', HEART_BADGE);
    return a;
  }

  function match(it) {
    if (removed.has(it.id) || !inSrc(it)) return false;
    for (const t of state.tags) if (!it.tags.includes(t)) return false;
    if (state.q) {
      const hay = [it.title, it.text, it.author, it.url, it.sourceUrl, ...(it.tags || [])].join(' ').toLowerCase();
      return state.q.split(/\s+/).every(w => hay.includes(w));
    }
    return true;
  }

  function apply() {
    view = pool().filter(match);
    const byDate = dir => (a, b) => (!a.date) - (!b.date) || (a.date && b.date ? dir * (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : 0);
    if (state.sort === 'newest') view.sort(byDate(-1));
    if (state.sort === 'oldest') view.sort(byDate(1));
    if (state.sort === 'saved') view.sort((a, b) => (!a.savedDate) - (!b.savedDate) || (a.savedDate < b.savedDate ? 1 : a.savedDate > b.savedDate ? -1 : 0));
    if (state.sort === 'shuffle') { // stable per shuffle (filters/search keep the order); each Shuffle tap re-rolls
      const k = it => { let r = shuf.get(it.id); if (r === undefined) shuf.set(it.id, r = Math.random()); return r; };
      view.sort((a, b) => k(a) - k(b));
    }
    if (state.sort === 'media') view = [...view].sort((a, b) => (b.mediaUrl ? 1 : 0) - (a.mediaUrl ? 1 : 0));
    grid.querySelectorAll('video').forEach(v => vio.unobserve(v));
    grid.innerHTML = ''; shown = 0; more(true);
    $('#empty').hidden = view.length > 0;
    $('#count').textContent = own.mode === 'sug' ? `${view.length} suggested` : `${view.length} / ${all.length - removed.size}`;
    $('#empty').textContent = own.mode === 'sug' ? 'No suggestions waiting. New picks arrive with the morning and evening digests.' : 'Nothing here yet.';
    renderTags();
    layout(true); // after renderTags: the active-filter row changes the grid's top padding
  }

  function more(noLayout) {
    const frag = document.createDocumentFragment();
    view.slice(shown, shown + PAGE).forEach(it => frag.appendChild(card(it)));
    shown = Math.min(view.length, shown + PAGE);
    grid.appendChild(frag);
    if (!noLayout) layout(false);
  }
  new IntersectionObserver(es => { if (es[0].isIntersecting && shown < view.length) more(); }, { rootMargin: '1200px' }).observe($('#sentinel'));

  // ---- masonry (multi-column grid): cards stay in sort order in the DOM; each one, in order, goes into the
  // currently shortest column (leftmost on ties), so the newest items fill the top row and reading order is
  // roughly row by row. Heights come from the rendered card before any image loads: media with known
  // width/height carry their aspect ratio (.ph), unknown media get a 4:5 placeholder ratio (CSS), and text
  // cards are measured as laid out. A full reflow (column count / width change, apply()) re-places everything;
  // otherwise placements are kept and columns are only restacked (image loads, new pages appended).
  const mas = { n: 0, cw: 0, cols: [] };
  let masRaf = 0, masFull = false;
  const masSchedule = full => { masFull = masFull || !!full; if (!masRaf) masRaf = requestAnimationFrame(() => { masRaf = 0; const f = masFull; masFull = false; layout(f); }); };
  // (no ResizeObserver on cards: images finishing mid-frame trip WebKit's "ResizeObserver loop" console error;
  // media load/error events call reflowSoon instead)
  function layout(full, again) {
    const cards = [...grid.children].filter(c => c.classList.contains('card'));
    if (grid.classList.contains('single')) { // single column: normal flow (order already correct)
      if (grid.classList.contains('mas')) { cards.forEach(c => { c.style.width = c.style.left = c.style.top = ''; }); grid.style.height = ''; grid.classList.remove('mas'); }
      mas.n = 0; mas.cols = []; return;
    }
    grid.classList.add('mas');
    const rs = getComputedStyle(document.documentElement), cs = getComputedStyle(grid);
    const n = Math.max(1, parseInt(rs.getPropertyValue('--cols'), 10) || 1), gap = parseFloat(rs.getPropertyValue('--gap')) || 6;
    const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0, pt = parseFloat(cs.paddingTop) || 0, pb = parseFloat(cs.paddingBottom) || 0;
    const w0 = grid.clientWidth, cw = Math.max(1, Math.floor((w0 - pl - pr - gap * (n - 1)) / n * 100) / 100);
    if (full || n !== mas.n || Math.abs(cw - mas.cw) > 0.5) { full = true; mas.cols = Array.from({ length: n }, () => []); }
    else mas.cols = mas.cols.map(col => col.filter(c => c.parentNode === grid));
    mas.n = n; mas.cw = cw;
    const W = cw + 'px';
    cards.forEach(c => { if (c.style.width !== W) c.style.width = W; });          // writes first…
    const h = new Map(cards.map(c => [c, c.offsetHeight]));                         // …then one layout read
    const placed = new Set(full ? [] : mas.cols.flat());
    const colH = mas.cols.map(col => col.reduce((s, c) => s + h.get(c) + gap, 0));
    for (const c of cards) {
      if (placed.has(c)) continue;
      let i = 0; for (let j = 1; j < n; j++) if (colH[j] < colH[i] - 0.5) i = j;
      mas.cols[i].push(c); colH[i] += h.get(c) + gap;
    }
    mas.cols.forEach((col, i) => { let y = 0; const x = (pl + i * (cw + gap)) + 'px';
      col.forEach(c => { const t = (pt + y) + 'px'; if (c.style.left !== x) c.style.left = x; if (c.style.top !== t) c.style.top = t; y += h.get(c) + gap; }); });
    const maxH = Math.max(0, ...colH);
    grid.style.height = cards.length ? (pt + Math.max(0, maxH - gap) + pb) + 'px' : '';
    // the new height can add/remove a desktop scrollbar, which changes the width: reflow once more
    if (!again && grid.clientWidth !== w0) layout(false, true);
  }
  addEventListener('resize', () => masSchedule(false));
  addEventListener('orientationchange', () => masSchedule(false));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => masSchedule(false));

  function renderTags() {
    const tpool = pool().filter(it => !removed.has(it.id) && inSrc(it));
    const counts = {};
    tpool.forEach(it => it.tags.forEach(t => { if (!HIDDEN_TAGS.has(t)) counts[t] = (counts[t] || 0) + 1; }));
    state.tags.forEach(t => { counts[t] = counts[t] || 0; });
    let list = Object.entries(counts).sort((a, b) => (state.tags.has(b[0]) - state.tags.has(a[0])) || b[1] - a[1]);
    if (state.tq) list = list.filter(([t]) => t.toLowerCase().includes(state.tq));
    const total = list.length, cut = !state.tq && !state.allTags && total > TOP;
    if (cut) list = list.slice(0, TOP);
    tagsEl.innerHTML = list.map(([t, n]) => `<button data-tag="${esc(t)}" class="${state.tags.has(t) ? 'on' : ''}">${esc(t)}<small>${n}</small></button>`).join('') || '<span class="muted">No tags match.</span>';
    const mb = $('#tmore');
    mb.hidden = state.tq || total <= TOP;
    mb.textContent = state.allTags ? 'Show fewer' : `Show all ${total} tags`;
    // badge + active summary
    const n = state.tags.size + (state.src !== 'all') + (state.sort !== 'newest');
    $('#fcount').hidden = !n; $('#fcount').textContent = n;
    const act = [];
    if (state.src !== 'all') act.push(`<button data-x="src">${esc(state.src)} ×</button>`);
    state.tags.forEach(t => act.push(`<button data-x="tag" data-tag="${esc(t)}">#${esc(t)} ×</button>`));
    if (n) act.push('<button data-x="all" class="link">Clear</button>');
    $('#active').innerHTML = act.join(''); $('#active').hidden = !n;
    document.querySelectorAll('#sources button').forEach(x => x.classList.toggle('on', x.dataset.src === state.src));
    document.querySelectorAll('#sort button').forEach(x => x.classList.toggle('on', x.dataset.sort === state.sort));
    const sb = $('#shbtn'); if (sb) { sb.setAttribute('aria-pressed', state.sort === 'shuffle'); sb.title = state.sort === 'shuffle' ? 'Shuffle again' : 'Shuffle'; }
  }
  const clearAll = () => { state.src = 'all'; state.tags.clear(); state.sort = 'newest'; try { localStorage.removeItem('dv-sort'); } catch {} apply(); };
  tagsEl.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.tags.has(b.dataset.tag) ? state.tags.delete(b.dataset.tag) : state.tags.add(b.dataset.tag);
    apply();
  });
  $('#sources').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.src = b.dataset.src; state.tags.clear(); apply();
  });
  $('#sort').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.sort === 'shuffle') return shuffle();
    state.sort = b.dataset.sort; try { localStorage.setItem('dv-sort', state.sort); } catch {} apply();
  });
  $('#active').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.x === 'src') state.src = 'all';
    else if (b.dataset.x === 'tag') state.tags.delete(b.dataset.tag);
    else return clearAll();
    apply();
  });
  $('#tmore').addEventListener('click', () => { state.allTags = !state.allTags; renderTags(); });
  $('#tq').addEventListener('input', e => { state.tq = e.target.value.trim().toLowerCase(); renderTags(); });
  $('#fclear').addEventListener('click', clearAll);
  const sheet = $('#sheet'), scrim = $('#scrim'), fbtn = $('#fbtn');
  const openSheet = o => { sheet.hidden = scrim.hidden = !o; fbtn.setAttribute('aria-expanded', o); document.body.style.overflow = o && innerWidth < 720 ? 'hidden' : ''; };
  fbtn.addEventListener('click', () => openSheet(sheet.hidden));
  scrim.addEventListener('click', () => openSheet(false));
  $('#fclose').addEventListener('click', () => openSheet(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape') openSheet(false); });
  let tmr; q.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => { state.q = q.value.trim().toLowerCase(); apply(); }, 120); });
  const sbox = $('#sbox'), sbtn = $('#sbtn'), bar = document.querySelector('.bar');
  const setSearch = o => { sbox.classList.toggle('open', o); bar.classList.toggle('searching', o); sbtn.setAttribute('aria-expanded', o); q.tabIndex = o ? 0 : -1; if (o) q.focus(); };
  sbtn.addEventListener('click', () => { if (!sbox.classList.contains('open')) setSearch(true); else if (!q.value) setSearch(false); else q.focus(); });
  q.addEventListener('keydown', e => { if (e.key === 'Escape') { if (q.value) { q.value = ''; state.q = ''; apply(); } setSearch(false); q.blur(); } });
  q.addEventListener('blur', () => setTimeout(() => { if (!q.value && document.activeElement !== sbtn) setSearch(false); }, 120));
  document.addEventListener('keydown', e => { if (e.key === '/' && document.activeElement !== q && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { e.preventDefault(); setSearch(true); } });
  // pill: logo = scroll to top, or reset filters/search when already at top
  $('.brand').addEventListener('click', e => {
    e.preventDefault();
    if (scrollY > 40) { scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (q.value) { q.value = ''; state.q = ''; setSearch(false); }
    clearAll();
  });
  // keep the pill above the iOS on-screen keyboard
  if (window.visualViewport) {
    const kb = () => { const h = Math.max(0, innerHeight - visualViewport.height - visualViewport.offsetTop); document.documentElement.style.setProperty('--kb', (h > 80 ? h : 0) + 'px'); };
    visualViewport.addEventListener('resize', kb); visualViewport.addEventListener('scroll', kb);
  }
  // tap menu: icon-only black box over the tapped tile
  const IC = {
    open: '<svg viewBox="0 0 24 24"><path d="M14 5h5v5M19 5l-8 8M17 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4"/></svg>',
    like: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
    rm: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    ok: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    no: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"/><path d="M6.8 17.2L17.2 6.8"/></svg>',
    src: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>' };
  const HEART_BADGE = `<span class="hb" aria-label="Liked">${IC.like}</span>`;
  let menu = null;
  const closeMenu = () => { if (menu) { menu.closest('.card')?.classList.remove('menu-on'); menu.remove(); menu = null; } };
  const openMenu = (c, ev) => {
    closeMenu(); const id = c.dataset.id;
    menu = document.createElement('div'); menu.className = 'tmenu'; menu.setAttribute('role', 'menu');
    const it = pool().find(x => x.id === id) || {};
    const B = (a, ic, l, x = '') => `<button data-a="${a}" aria-label="${l}" title="${l}" ${x}>${ic}</button>`;
    menu.innerHTML = B('open', IC.open, 'Open link')
      + (own.mode === 'sug' && it.sourceUrl && it.sourceUrl !== it.url ? B('src', IC.src, 'Open source') : '')
      + (!own.on ? '' : own.mode === 'sug' ? B('approve', IC.ok, 'Approve — add to vault') + B('reject', IC.no, 'Reject — never suggest')
        : B('like', IC.like, liked.has(id) ? 'Unlike' : 'Like', `class="${liked.has(id) ? 'liked' : ''}" aria-pressed="${liked.has(id)}"`) + B('rm', IC.rm, 'Remove'));
    c.appendChild(menu); c.classList.add('menu-on');
    if (ev && ev.clientY) { const r = c.getBoundingClientRect(), y = Math.min(Math.max(ev.clientY - r.top, 26), r.height - 26); menu.style.top = y + 'px'; }
  };
  const toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.hidden = true; document.body.appendChild(toastEl);
  let ttm;
  const toast = (msg, undo) => {
    toastEl.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button class="undo">Undo</button>' : ''}`; toastEl.hidden = false;
    const u = toastEl.querySelector('.undo'); if (u) u.onclick = () => { undo(); toastEl.hidden = true; };
    clearTimeout(ttm); ttm = setTimeout(() => { toastEl.hidden = true; }, 4500);
  };
  // shared actions for the icon box; c = element carrying data-id/href, tile = the grid tile (may equal c)
  const act = (c, b, tile) => {
    const id = c.dataset.id, a = b.dataset.a;
    if (a === 'open') { window.open(c.href, '_blank', 'noopener,noreferrer'); if (!xOpen) closeMenu(); }
    if (a === 'src') { const it = pool().find(x => x.id === id); if (it && it.sourceUrl) window.open(it.sourceUrl, '_blank', 'noopener,noreferrer'); if (!xOpen) closeMenu(); }
    if (!own.on) return;
    if (a === 'approve' || a === 'reject') return decide(id, a);
    if (a === 'like') {
      const on = !liked.has(id); on ? liked.add(id) : liked.delete(id); persist();
      send([{ op: on ? 'like' : 'unlike', id }], () => { on ? liked.delete(id) : liked.add(id); apply(); });
      b.classList.toggle('liked', on); b.setAttribute('aria-pressed', on); b.setAttribute('aria-label', on ? 'Unlike' : 'Like');
      for (const el of new Set([c, tile].filter(Boolean))) { el.querySelector('.hb')?.remove(); if (on) el.insertAdjacentHTML('beforeend', HEART_BADGE); }
      if (!on && state.src === 'liked') { if (xOpen) collapse(true); closeMenu(); apply(); }
    }
    if (a === 'rm') {
      if (xOpen) collapse(true);
      closeMenu(); removed.add(id); persist(); const y = scrollY; apply(); scrollTo(0, y);
      const back = () => { removed.delete(id); const y2 = scrollY; apply(); scrollTo(0, y2); };
      send([{ op: 'remove', id }], back);
      toast('Removed for everyone', () => { back(); send([{ op: 'restore', id }], () => { removed.add(id); apply(); }); });
    }
  };
  grid.addEventListener('click', e => {
    const c = e.target.closest('.card'); if (!c) return;
    e.preventDefault(); e.stopPropagation();
    const b = e.target.closest('.tmenu button');
    if (b) return act(c, b, c);
    if (!grid.classList.contains('single')) { expand(c); return; }
    menu && menu.parentNode === c ? closeMenu() : openMenu(c, e);
  });

  // ---- expanded view (multi-column grid): zoom the tile to a full-width card ----
  // Spring FLIP (transform) + clip-path morph (tile shape with 6px corners -> full card with the caption),
  // backdrop fade, icon menu fades in after the zoom. Videos: the tile's own <video> element moves into the
  // card (keeps playing, no reload); on phones the full-quality file is loaded alongside, synced to the same
  // time and cross-faded in. Swipe down / drag to dismiss interactively.
  const xv = document.createElement('div'); xv.className = 'xv'; xv.hidden = true;
  xv.innerHTML = '<div class="xv-bg"></div><div class="xv-scroll"><div class="xv-wrap"></div></div>';
  document.body.appendChild(xv);
  const xbg = xv.querySelector('.xv-bg'), xsc = xv.querySelector('.xv-scroll'), xwrap = xv.querySelector('.xv-wrap');
  let xOpen = null, xAnim = false;
  const RAD = 6;
  const flipFrom = (el, r) => { const f = el.getBoundingClientRect(), k = r.width / f.width;
    return { t: `translate(${r.left - f.left}px, ${r.top - f.top}px) scale(${k})`, k, f }; };
  // clip in the card's own (unscaled) coordinates: only the media area (tile height / k) with 6px visual corners
  const clipFrom = (f, r, k) => `inset(0px 0px ${Math.max(0, f.height - r.height / k).toFixed(2)}px 0px round ${(RAD / k).toFixed(2)}px)`;
  const CLIP_OPEN = `inset(0px 0px 0px 0px round ${RAD}px)`;
  function liveVideo(tile, el) {
    const tv = tile.querySelector('video'), cv = el.querySelector('video');
    if (!tv || !cv) return null;
    const ph = document.createElement('div'); ph.className = 'vph'; ph.style.height = tv.offsetHeight + 'px';
    tv.replaceWith(ph); cv.replaceWith(tv);                 // same task: the element never pauses
    const pr = tv.play(); if (pr) pr.catch(() => {});
    const lv = { tv, ph, fv: null, on: false };
    const full = tv.dataset.full;
    if (full) {                                             // phones: upgrade lite -> full quality without a jump
      const fv = document.createElement('video'); lv.fv = fv;
      fv.className = 'xfull'; fv.muted = true; fv.loop = true; fv.playsInline = true; fv.setAttribute('playsinline', ''); fv.setAttribute('webkit-playsinline', '');
      fv.preload = 'auto'; fv.setAttribute('referrerpolicy', 'no-referrer'); fv.style.height = tv.offsetHeight + 'px';
      fv.src = full; if (tv.dataset.audio) fv.dataset.audio = tv.dataset.audio; tv.after(fv);
      fv.load();                                            // inside the tap: lets WebKit unmute it later without a gesture
      fv.addEventListener('loadeddata', () => {
        if (lv.fv !== fv) return;
        const d = fv.duration || tv.duration || 0, lead = 0.35;
        let target = tv.currentTime + lead; if (d && target > d - 0.1) target = tv.currentTime;
        fv.addEventListener('seeked', () => {
          if (lv.fv !== fv) return;
          const wait = Math.max(0, (target - tv.currentTime) * 1000);
          setTimeout(() => { if (lv.fv !== fv) return; const p2 = fv.play();
            Promise.resolve(p2).then(() => { if (lv.fv !== fv) return;
              const show = () => { if (lv.fv !== fv) return; if (fv.closest('.pg.off')) fv.pause(); fv.classList.add('on'); lv.on = true; xAudio(); // sound moves to the full-quality copy
                setTimeout(() => { if (lv.fv !== fv) return;
                  if (fv.paused && !fv.closest('.pg.off') && !fv.muted) { xMuted = true; xAudio(); const p3 = fv.play(); if (p3) p3.catch(() => {}); } // unmute refused: stay muted, toggle shows it
                  if (lv.on) tv.pause(); }, 260); };
              fv.requestVideoFrameCallback ? fv.requestVideoFrameCallback(show) : setTimeout(show, 60); }).catch(() => {}); }, wait);
        }, { once: true });
        try { fv.currentTime = target; } catch {}
      }, { once: true });
    }
    return lv;
  }
  function restoreVideo(lv) {
    if (!lv) return; const { tv, ph, fv } = lv;
    if (fv) { if (lv.on) { try { tv.currentTime = fv.currentTime; } catch {} } lv.fv = null; fv.pause(); fv.removeAttribute('src'); fv.load(); fv.remove(); }
    tv.muted = true;                                        // back in the grid: muted again
    if (ph.isConnected) ph.replaceWith(tv);
    const pr = tv.play(); if (pr) pr.catch(() => {});
  }
  // ---- multi-media pager (expanded view only): horizontal scroll-snap track, one page per media. Native touch
  // swipe + trackpad scroll; arrow keys and hover prev/next buttons on desktop; dots. The pager keeps the first
  // media's aspect ratio (others are letterboxed), so the zoom from/to the tile is unchanged. The active page's
  // video plays (muted), others pause. Swipe-down dismiss only starts on a mostly vertical drag (see touchmove).
  const CHEV = d => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
  function buildPager(el, it) {
    const ml = it && mlist(it); if (!ml) return null;
    const first = el.querySelector(':scope > video, :scope > img'); if (!first) return null;
    const w = first.offsetWidth, h = first.offsetHeight;
    const pager = document.createElement('div'); pager.className = 'pager';
    pager.style.aspectRatio = w > 1 && h > 1 ? `${w} / ${h}` : (it.width && it.height ? `${it.width} / ${it.height}` : '4 / 5');
    const track = document.createElement('div'); track.className = 'pg-track';
    const p0 = document.createElement('div'); p0.className = 'pg pg0';
    first.before(pager); pager.appendChild(track); track.appendChild(p0);
    const xf = el.querySelector(':scope > .xfull'), vt = el.querySelector(':scope > .vt');
    p0.append(...[first, xf, vt].filter(Boolean));   // same task: a playing video keeps playing
    const pages = [p0];
    ml.slice(1).forEach(m => {
      const pg = document.createElement('div'); pg.className = 'pg off';
      pg.innerHTML = m.type === 'video'
        ? `<video muted loop playsinline webkit-playsinline disableremoteplayback referrerpolicy="no-referrer" preload="none" ${m.posterUrl ? `poster="${esc(m.posterUrl)}"` : ''} data-src="${esc(m.url)}"${audioAttr(m.hasAudio)}></video><span class="vt">${m.durationMs ? fmtT(m.durationMs / 1000) : ''}</span>`
        : `<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(m.url)}" alt="">`;
      track.appendChild(pg); pages.push(pg);
    });
    pager.insertAdjacentHTML('beforeend', `<button class="pg-btn prev" aria-label="Previous" disabled>${CHEV('M14.5 6l-6 6 6 6')}</button><button class="pg-btn next" aria-label="Next">${CHEV('M9.5 6l6 6-6 6')}</button><div class="pg-dots" aria-hidden="true">${pages.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>`);
    const P = { pager, track, pages, idx: 0, raf: 0 };
    track.addEventListener('scroll', () => { if (!P.raf) P.raf = requestAnimationFrame(() => { P.raf = 0;
      const i = Math.max(0, Math.min(pages.length - 1, Math.round(track.scrollLeft / Math.max(1, track.clientWidth))));
      if (i !== P.idx) pagerActivate(P, i); }); }, { passive: true });
    return P;
  }
  const videoShown = v => !(v.classList.contains('xfull') && !v.classList.contains('on'))
    && !(v.nextElementSibling && v.nextElementSibling.classList.contains('xfull') && v.nextElementSibling.classList.contains('on'));
  function pagerActivate(P, i) {
    P.idx = i;
    P.pages.forEach((pg, j) => { pg.classList.toggle('off', j !== i);
      pg.querySelectorAll('video').forEach(v => {
        if (j !== i) { if (!v.paused) v.pause(); return; }
        if (!v.getAttribute('src') && v.dataset.src) { v.preload = 'auto'; v.src = v.dataset.src; }
        if (videoShown(v)) playX(v);
      }); });
    xAudio();                                               // only the visible page's video is audible
    // warm the next page's video (metadata only) so its timer and first frame are ready
    const nv = P.pages[i + 1] && P.pages[i + 1].querySelector('video');
    if (nv && !nv.getAttribute('src') && nv.dataset.src) { nv.preload = 'metadata'; nv.src = nv.dataset.src; }
    P.pager.querySelectorAll('.pg-dots i').forEach((d, j) => d.classList.toggle('on', j === i));
    P.pager.querySelector('.prev').disabled = i === 0; P.pager.querySelector('.next').disabled = i === P.pages.length - 1;
  }
  const pagerGo = (P, i) => { i = Math.max(0, Math.min(P.pages.length - 1, i)); if (i === P.idx) return;
    P.track.scrollTo({ left: i * P.track.clientWidth, behavior: reduceMQ.matches ? 'auto' : 'smooth' }); };
  // closing on another page: that page's media moves to an overlay that fades out over page 0 (no jump, no blink)
  function pagerHome(P, ms) {
    const cur = P.pages[P.idx], ov = document.createElement('div'); ov.className = 'pg pg-ov';
    ov.append(...cur.childNodes); P.pager.appendChild(ov);
    P.track.style.scrollSnapType = 'none'; P.track.scrollLeft = 0; pagerActivate(P, 0);
    ov.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms, easing: 'ease-out', fill: 'forwards' });
  }
  // ---- sound in the expanded view (see audioAttr): xMuted resets to false on every open ----
  let xMuted = false;
  const audible = v => xOpen && !xOpen.closing && !xMuted && hasAudio(v) !== false && videoShown(v) && !v.closest('.pg.off, .pg-ov');
  function xAudio() {
    if (!xOpen) return;
    xOpen.el.querySelectorAll('video').forEach(v => { const m = !audible(v); if (v.muted !== m) v.muted = m; });
    xOpen.el.querySelectorAll('.vm').forEach(b => { if (b.dataset.m === String(xMuted)) return;
      b.dataset.m = xMuted; b.innerHTML = SND_IC(xMuted); b.setAttribute('aria-label', xMuted ? 'Unmute' : 'Mute'); b.setAttribute('aria-pressed', xMuted); });
  }
  // play(); if the browser refuses sound (NotAllowedError), fall back to muted playback and show the toggle as muted
  const playX = v => { const p = v.play(); if (p) p.catch(e => { if (e && e.name === 'NotAllowedError' && !v.muted && xOpen) { xMuted = true; xAudio(); const p2 = v.play(); if (p2) p2.catch(() => {}); } }); };
  // `.vbar` = the media's time left (.vt) + the mute toggle (.vm), top-left
  function muteBtn(box, v) {
    const vt = box.querySelector(':scope > .vt'), bar = document.createElement('div'); bar.className = 'vbar';
    if (vt) { vt.before(bar); bar.appendChild(vt); } else box.appendChild(bar);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'vm'; b.hidden = hasAudio(v) !== true; bar.appendChild(b);
    b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); xMuted = !xMuted; xAudio();
      if (!xMuted) xOpen.el.querySelectorAll('video').forEach(x => { if (audible(x) && x.paused && !x.closest('.pg.off')) playX(x); }); });
    if (hasAudio(v) === null) {                             // unknown (not mirrored): show once the browser sees sound
      let n = 0; const chk = () => { const a = hasAudio(v); if (a || a === false || ++n > 40) { ['loadeddata', 'timeupdate'].forEach(t => v.removeEventListener(t, chk)); if (a) b.hidden = false; } };
      ['loadeddata', 'timeupdate'].forEach(t => v.addEventListener(t, chk));
    }
  }
  function addMutes() {
    const { el, pg } = xOpen;
    (pg ? pg.pages : [el]).forEach(box => { const v = box.querySelector(':scope > video:not(.xfull)'); if (v) muteBtn(box, v); });
    xAudio();
  }
  function stopVideos(root) { root.querySelectorAll('video').forEach(v => { v.pause(); if (v.getAttribute('src')) { v.removeAttribute('src'); v.load(); } }); }
  function expand(tile) {
    if (xOpen || xAnim) return; closeMenu(); xMuted = false;
    const r = tile.getBoundingClientRect();
    const el = tile.cloneNode(true); el.classList.add('xcard'); el.classList.remove('menu-on', 'vt-tile'); el.removeAttribute('title'); el.style.width = el.style.left = el.style.top = el.style.viewTransitionName = ''; // drop masonry placement
    xwrap.replaceChildren(el); xv.hidden = false; xsc.scrollTop = 0;
    document.documentElement.classList.add('xv-on');
    const lv = liveVideo(tile, el);
    const v = el.querySelector('video');
    if (v && !lv) { v.src = v.dataset.full || v.dataset.src; v.muted = !(hasAudio(v) !== false); v.loop = true; v.playsInline = true; v.preload = 'auto'; }
    xOpen = { tile, el, lv, pg: buildPager(el, pool().find(x => x.id === tile.dataset.id)) }; tile.style.visibility = 'hidden';
    addMutes();                                             // unmutes the shown video — still inside the tap (user gesture)
    if (v && !lv) playX(v);
    openMenu(el); xwrap.appendChild(menu); menu.classList.add('xm'); el.classList.remove('menu-on');
    const mn = menu; mn.style.opacity = '0';
    const showMenu = () => { if (!mn.isConnected) return; mn.style.opacity = ''; if (!reduceMQ.matches) mn.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 200, easing: 'ease-out' }); };
    xAnim = true;
    if (reduceMQ.matches || r.width < 2) {
      const m = xv.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
      m.onfinish = () => { xAnim = false; showMenu(); }; return;
    }
    const { t, k, f } = flipFrom(el, r);
    const m = el.animate([{ transform: t, transformOrigin: '0 0', clipPath: clipFrom(f, r, k) }, { transform: 'none', transformOrigin: '0 0', clipPath: CLIP_OPEN }], { duration: SPR_OPEN.ms, easing: SPR_OPEN.ease });
    xbg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' });
    // the menu fades in once the zoom has (visually) landed
    let shown = false; const once = () => { if (!shown) { shown = true; showMenu(); } };
    setTimeout(once, Math.round(SPR_OPEN.ms * 0.62));
    m.onfinish = () => { xAnim = false; once(); };
  }
  function collapse(instant) {
    if (!xOpen) return; const { tile, el, lv, pg } = xOpen;
    xOpen.closing = true; xAudio();                         // silent during the zoom back
    const done = () => { restoreVideo(lv); stopVideos(el); tile.style.visibility = ''; xv.hidden = true; xwrap.replaceChildren(); el.style.transform = el.style.clipPath = '';
      xbg.style.opacity = ''; document.documentElement.classList.remove('xv-on'); xOpen = null; xAnim = false; menu = null; };
    if (!lv) el.querySelectorAll('video').forEach(v => v.pause());
    if (instant || !tile.isConnected) return done();
    xAnim = true;
    if (pg && pg.idx) pagerHome(pg, Math.round(SPR_CLOSE.ms * 0.55));   // zoom back to the tile's (first) media
    const mn = xwrap.querySelector('.tmenu');
    if (mn) mn.animate([{ opacity: getComputedStyle(mn).opacity }, { opacity: 0 }], { duration: 120, fill: 'forwards' });
    if (reduceMQ.matches) { const m = xv.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }); m.onfinish = () => { done(); m.cancel(); }; return; }
    const cur = el.style.transform, curClip = el.style.clipPath; el.style.transform = ''; el.style.clipPath = '';
    const tr = tile.getBoundingClientRect(), { t, k, f } = flipFrom(el, tr);
    const m = el.animate([{ transform: cur || 'none', transformOrigin: '0 0', clipPath: curClip || CLIP_OPEN }, { transform: t, transformOrigin: '0 0', clipPath: clipFrom(f, tr, k) }], { duration: SPR_CLOSE.ms, easing: SPR_CLOSE.ease, fill: 'forwards' });
    xbg.animate([{ opacity: getComputedStyle(xbg).opacity }, { opacity: 0 }], { duration: Math.round(SPR_CLOSE.ms * 0.6), easing: 'ease-out', fill: 'forwards' });
    m.onfinish = () => { done(); m.cancel(); xbg.getAnimations().forEach(a => a.cancel()); };
  }
  xv.addEventListener('click', e => {
    const b = e.target.closest('.tmenu button');
    if (b && xOpen) { e.stopPropagation(); return act(xOpen.el, b, xOpen.tile); }
    const pb = e.target.closest('.pg-btn');
    if (pb && xOpen && xOpen.pg) { e.preventDefault(); e.stopPropagation(); return pagerGo(xOpen.pg, xOpen.pg.idx + (pb.classList.contains('next') ? 1 : -1)); }
    if (e.target.closest('.xcard')) { e.preventDefault(); e.stopPropagation(); return; }
    e.stopPropagation(); collapse();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && xOpen) collapse();
    else if (xOpen && xOpen.pg && !xAnim && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); pagerGo(xOpen.pg, xOpen.pg.idx + (e.key === 'ArrowRight' ? 1 : -1)); }
  }, true);
  // swipe down / drag (from the top of the expanded view) to dismiss: the card follows the finger,
  // shrinks a little, its corners round off and the backdrop fades; release far or fast enough to close
  let sy0 = null, sx0 = 0, sdy = 0, sdx = 0, sv = 0, st = 0, sl = 0, sdrag = false;
  const dragStyle = () => { const p = Math.min(Math.max(sdy, 0), 320), k = 1 - p / 1000;
    xOpen.el.style.transform = `translate(${sdx * 0.5}px, ${p * 0.85}px) scale(${k})`;
    xOpen.el.style.clipPath = `inset(0px 0px 0px 0px round ${(RAD + p / 25).toFixed(2)}px)`;
    xbg.style.opacity = 1 - p / 450; const mn = xwrap.querySelector('.tmenu'); if (mn) mn.style.opacity = Math.max(0, 1 - p / 80); };
  xsc.addEventListener('touchstart', e => { sy0 = (xsc.scrollTop <= 0 && e.touches.length === 1 && !xAnim) ? e.touches[0].clientY : null; sx0 = sy0 == null ? 0 : e.touches[0].clientX; sdy = sdx = sv = 0; sdrag = false; st = performance.now(); sl = sy0 || 0; }, { passive: true });
  xsc.addEventListener('touchmove', e => {
    if (sy0 == null || !xOpen) return;
    const y = e.touches[0].clientY; sdy = y - sy0; sdx = e.touches[0].clientX - sx0;
    const now = performance.now(); if (now > st) sv = 0.7 * sv + 0.3 * ((y - sl) / (now - st)); st = now; sl = y;
    if (!sdrag) { if (sdy > 6 && sdy > Math.abs(sdx)) sdrag = true; else { if (sdy < -6 || Math.abs(sdx) > 12) sy0 = null; return; } }
    e.preventDefault(); dragStyle();
  }, { passive: false });
  const endDrag = () => {
    if (sy0 == null || !xOpen) return; sy0 = null; if (!sdrag) return; sdrag = false;
    if (sdy > 90 || (sdy > 24 && sv > 0.55)) return collapse();
    const el = xOpen.el, from = el.style.transform || 'none', fc = el.style.clipPath || CLIP_OPEN;
    el.style.transform = ''; el.style.clipPath = ''; xbg.style.opacity = ''; const mn = xwrap.querySelector('.tmenu'); if (mn) mn.style.opacity = '';
    el.animate([{ transform: from, clipPath: fc }, { transform: 'none', clipPath: CLIP_OPEN }], { duration: SPR_BACK.ms, easing: SPR_BACK.ease });
  };
  xsc.addEventListener('touchend', endDrag); xsc.addEventListener('touchcancel', endDrag);
  // ---- motion: spring easing (response/damping like SwiftUI .spring) as CSS linear(), reduced-motion aware ----
  const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
  const springEase = (response, damping) => {
    const w0 = 2 * Math.PI / response, z = damping, wd = w0 * Math.sqrt(1 - z * z);
    const dur = Math.min(1.2, Math.log(1000) / (z * w0)), pts = [];
    for (let i = 0; i <= 40; i++) { const t = dur * i / 40;
      pts.push(+(1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + z * w0 / wd * Math.sin(wd * t))).toFixed(4)); }
    pts[pts.length - 1] = 1;
    const ok = window.CSS && CSS.supports && CSS.supports('transition-timing-function', 'linear(0, 1)');
    return { ease: ok ? `linear(${pts.join(', ')})` : 'cubic-bezier(.2,.8,.2,1)', ms: Math.round(dur * 1000) };
  };
  const SPR_VIEW = springEase(0.45, 0.86), SPR_OPEN = springEase(0.42, 0.86), SPR_CLOSE = springEase(0.36, 0.9), SPR_BACK = springEase(0.3, 0.8);
  document.documentElement.style.setProperty('--vt-ease', SPR_VIEW.ease);
  document.documentElement.style.setProperty('--vt-dur', SPR_VIEW.ms + 'ms');

  // ---- view toggle (single column <-> masonry): tiles glide to their new place, scroll anchored on the top tile ----
  const vbtn = $('#vbtn');
  const applyView = single => { grid.classList.toggle('single', single); layout(true); vbtn.setAttribute('aria-pressed', single); vbtn.setAttribute('aria-label', single ? 'Grid view' : 'Single column view'); vbtn.title = single ? 'Grid view' : 'Single column'; try { localStorage.setItem('dv-view', single ? 'single' : 'grid'); } catch {} };
  const topClear = () => parseFloat(getComputedStyle(grid).paddingTop) || 0;
  const near = r => r.bottom > -innerHeight * 0.25 && r.top < innerHeight * 1.25 && r.width > 0;
  const nearCards = () => { const out = []; for (const c of grid.children) { if (!c.classList.contains('card')) continue; const r = c.getBoundingClientRect(); if (near(r)) out.push([c, r]); if (out.length >= (window.__vtMax || 80)) break; } return out; };
  // the tile at the top of the screen (below the status bar + top fade) keeps its screen position
  const anchorOf = list => { const y0 = Math.min(topClear(), innerHeight / 3); let best = null;
    for (const [c, r] of list) if (r.bottom > y0 + 4 && r.top < innerHeight && (!best || r.top < best[1].top - 0.5 || (Math.abs(r.top - best[1].top) <= 0.5 && r.left < best[1].left))) best = [c, r];
    return best; };
  const keepAnchor = a => { if (!a) return; const d = a[0].getBoundingClientRect().top - a[1].top; if (Math.abs(d) > 0.5) scrollTo(0, scrollY + d); };
  let viewBusy = false;
  function setView(single, animate) {
    if (!animate || viewBusy || reduceMQ.matches || xOpen) { const a = animate ? anchorOf(nearCards()) : null; applyView(single); keepAnchor(a); return; }
    closeMenu();
    const before = nearCards(), a = anchorOf(before);
    if (document.startViewTransition) {
      // View Transitions API: name only the tiles near the viewport (old ∪ new), and the pill so it stays on top
      const named = new Set();
      const name = c => { if (named.has(c)) return; c.style.viewTransitionName = 'vt' + named.size; c.classList.add('vt-tile'); named.add(c); };
      before.forEach(([c]) => name(c)); bar.style.viewTransitionName = 'vt-pill';
      viewBusy = true;
      const vt = document.startViewTransition(() => { applyView(single); keepAnchor(a); nearCards().forEach(([c]) => name(c)); });
      vt.finished.finally(() => { named.forEach(c => { c.style.viewTransitionName = ''; c.classList.remove('vt-tile'); }); bar.style.viewTransitionName = ''; viewBusy = false; });
      return;
    }
    // fallback: FLIP with the Web Animations API
    const old = new Map(before);
    applyView(single); keepAnchor(a);
    viewBusy = true; const anims = [];
    for (const [c, r] of nearCards()) {
      const o = old.get(c);
      if (o && Math.abs(o.top - r.top) < innerHeight * 2) {
        const sx = o.width / r.width, sy = o.height / r.height;
        anims.push(c.animate([{ transform: `translate(${o.left - r.left}px, ${o.top - r.top}px) scale(${sx}, ${sy})`, transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }], { duration: SPR_VIEW.ms, easing: SPR_VIEW.ease }));
      } else anims.push(c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 80, easing: 'ease-out', fill: 'backwards' }));
    }
    Promise.allSettled(anims.map(x => x.finished)).then(() => { viewBusy = false; });
  }
  let saved = null; try { saved = localStorage.getItem('dv-view'); } catch {}
  applyView(saved === 'single');
  vbtn.addEventListener('click', () => { if (navigator.vibrate) try { navigator.vibrate(8); } catch {} setView(!grid.classList.contains('single'), true); });
  // ---- shuffle (navbar button + Sort chip): a new random order each tap; tiles glide to their new slots ----
  // apply() rebuilds the cards, so view-transition names are keyed by item id (old tile -> new tile of the same item).
  const vtName = id => 'vs-' + id.replace(/[^A-Za-z0-9_-]/g, '_');
  function glide(update) {
    if (reduceMQ.matches || viewBusy || xOpen || !document.startViewTransition) {
      const old = new Map(nearCards().map(([c, r]) => [c.dataset.id, r])); update();
      if (reduceMQ.matches || xOpen) return;
      for (const [c, r] of nearCards()) { const o = old.get(c.dataset.id);
        if (o) c.animate([{ transform: `translate(${o.left - r.left}px, ${o.top - r.top}px) scale(${o.width / r.width}, ${o.height / r.height})`, transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }], { duration: SPR_VIEW.ms, easing: SPR_VIEW.ease });
        else c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 220, delay: 80, easing: 'ease-out', fill: 'backwards' }); }
      return;
    }
    closeMenu(); viewBusy = true;
    const named = [];
    const name = ([c]) => { if (!c.dataset.id) return; c.style.viewTransitionName = vtName(c.dataset.id); c.classList.add('vt-tile'); named.push(c); };
    nearCards().forEach(name); bar.style.viewTransitionName = 'vt-pill';
    const vt = document.startViewTransition(() => { named.forEach(c => { c.style.viewTransitionName = ''; c.classList.remove('vt-tile'); }); named.length = 0; update(); nearCards().forEach(name); });
    vt.finished.finally(() => { named.forEach(c => { c.style.viewTransitionName = ''; c.classList.remove('vt-tile'); }); bar.style.viewTransitionName = ''; viewBusy = false; });
  }
  function shuffle() {
    if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
    shuf.clear(); state.sort = 'shuffle'; try { localStorage.removeItem('dv-sort'); } catch {} // not persisted across reloads
    glide(() => { apply(); if (scrollY > 0) scrollTo(0, 0); });
  }
  $('#shbtn').addEventListener('click', shuffle);
  document.addEventListener('click', e => { if (menu && !xOpen && !menu.parentNode.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !xOpen) closeMenu(); });

  const rmBtn = $('#sendrm'), rmBox = $('#rmbox');
  function updRm() { if (!rmBtn) return; rmBtn.hidden = true; return; rmBtn.querySelector('b').textContent = removed.size; if (!removed.size) rmBox.hidden = true; }
  updRm();
  rmBtn.addEventListener('click', async () => {
    const txt = 'vault-removed: ' + [...removed].join(',');
    if (navigator.share && matchMedia('(pointer:coarse)').matches) { try { await navigator.share({ text: txt }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(txt); toast(`Copied ${removed.size} removal${removed.size > 1 ? 's' : ''}`); rmBox.hidden = true; }
    catch { rmBox.value = txt; rmBox.hidden = false; rmBox.focus(); rmBox.select(); toast('Copy the text below'); }
  });

  // ---- app updates: reload once when a new service worker takes control ----
  const curV = (document.querySelector('script[src*="app.js"]')?.src.match(/[?&]v=(\w+)/) || [])[1];
  if ('serviceWorker' in navigator) {
    const sw = navigator.serviceWorker, hadCtl = !!sw.controller;
    sw.addEventListener('controllerchange', () => {
      if (!hadCtl) return;                                   // first install: page is already current
      const nv = (sw.controller?.scriptURL.match(/[?&]v=(\w+)/) || [])[1] || 'x';
      if (nv === curV || sessionStorage.getItem('dv-swr') === nv) return;   // already current / loop guard
      sessionStorage.setItem('dv-swr', nv); location.reload();
    });
    const checkUpdate = async () => {
      try {
        const r = await sw.getRegistration(); if (r) r.update().catch(() => {});
        const html = await (await fetch('./?u=' + Date.now(), { cache: 'no-store' })).text();
        const nv = (html.match(/sw\.js\?v=(\w+)/) || [])[1];
        if (nv && curV && nv !== curV) await sw.register('sw.js?v=' + nv, { scope: './' });
      } catch {}
    };
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkUpdate(); });
    window.dvCheckUpdate = checkUpdate;
  }

  // ---- pull to refresh (touch, only when at the very top) ----
  const ptr = document.createElement('div'); ptr.className = 'ptr'; ptr.innerHTML = '<i></i>'; document.body.appendChild(ptr);
  let py0 = null, px0 = 0, pull = 0, pulling = false, refreshing = false;
  const PTR_T = 70;
  const blocked = t => xOpen || t.closest('.xv,.sheet,.bar,.tmenu,.toast,input,textarea') || !$('#sheet').hidden;
  addEventListener('touchstart', e => {
    if (refreshing || e.touches.length !== 1 || scrollY > 0 || blocked(e.target)) { py0 = null; return; }
    py0 = e.touches[0].clientY; px0 = e.touches[0].clientX; pull = 0; pulling = false;
  }, { passive: true });
  addEventListener('touchmove', e => {
    if (py0 == null) return;
    const dy = e.touches[0].clientY - py0, dx = Math.abs(e.touches[0].clientX - px0);
    if (!pulling) { if (dy > 12 && dy > dx * 1.5 && scrollY <= 0) pulling = true; else if (dy < 0 || dx > 12) { py0 = null; return; } else return; }
    e.preventDefault();
    pull = Math.min(120, (dy - 12) * 0.55);
    ptr.style.transform = `translate(-50%, ${pull}px)`; ptr.style.opacity = Math.min(1, pull / PTR_T);
    ptr.classList.toggle('armed', pull >= PTR_T); ptr.querySelector('i').style.transform = `rotate(${pull * 4}deg)`;
  }, { passive: false });
  const endPull = () => {
    if (py0 == null) return; py0 = null;
    if (pulling && pull >= PTR_T) {
      refreshing = true; ptr.classList.add('spin'); ptr.style.transform = `translate(-50%, ${PTR_T * 0.8}px)`;
      Promise.race([window.dvCheckUpdate ? window.dvCheckUpdate() : 0, new Promise(r => setTimeout(r, 1500))])
        .finally(() => location.reload());
    } else { ptr.style.transform = ''; ptr.style.opacity = 0; ptr.classList.remove('armed'); }
    pulling = false;
  };
  addEventListener('touchend', endPull); addEventListener('touchcancel', endPull);

  // ---- server overlay + owner mode ----
  const norm = it => ({ ...it, tags: it.tags || [] });
  const overlay = st => {
    if (!st) return;
    removed.clear(); (st.removed || []).forEach(id => removed.add(id));
    const have = new Set(all.map(x => x.id));
    const add = (st.approved || []).filter(x => x && x.id && !have.has(x.id))
      .map(x => norm({ ...x, date: x.approvedAt || x.date, savedDate: x.approvedAt || x.date, dateKind: 'added' }));
    if (add.length) all = [...add, ...all];
  };
  const send = (ops, revert) => api('action', { ops }).catch(e => {
    if (revert) revert();
    if (e.status === 401) { setOwner(false); toast('Signed out — sign in again'); } else toast('Not saved — ' + e.message);
  });
  const sugBtn = $('#sugbtn'), sugN = $('#sugn');
  const setMode = m => {
    own.mode = own.on ? m : 'vault';
    document.documentElement.classList.toggle('sug-on', own.mode === 'sug');
    if (sugBtn) { sugBtn.setAttribute('aria-pressed', own.mode === 'sug'); sugBtn.setAttribute('aria-label', own.mode === 'sug' ? 'Back to vault' : 'Suggested'); sugBtn.title = own.mode === 'sug' ? 'Back to vault' : 'Suggested'; }
    if (xOpen) collapse(true); closeMenu(); apply(); scrollTo(0, 0);
  };
  const updSug = () => { if (!sugN) return; sugN.hidden = !own.sug.length; sugN.textContent = own.sug.length; };
  function setOwner(on) {
    own.on = on; document.documentElement.classList.toggle('owner', on);
    if (sugBtn) sugBtn.hidden = !on;
    if (!on) { liked.clear(); own.sug = []; if (state.src === 'liked') state.src = 'all'; if (own.mode !== 'vault') setMode('vault'); }
    updSug();
  }
  async function loadOwner() {
    const o = await api('owner');
    overlay({ removed: Object.keys(o.removed || {}), approved: o.approvedItems || [] }); // fresh (uncached) owner view
    liked.clear(); Object.keys(o.likes || {}).forEach(id => liked.add(id));
    own.sug = (o.suggestions || []).map(norm);
    setOwner(true);
    // one-time migration of likes/removals made on this device before owner mode existed
    const ops = [...legacy.removed].filter(id => !removed.has(id)).map(id => ({ op: 'remove', id }))
      .concat([...legacy.liked].filter(id => !liked.has(id)).map(id => ({ op: 'like', id })));
    if (ops.length) {
      try { await api('action', { ops }); ops.forEach(o2 => (o2.op === 'remove' ? removed : liked).add(o2.id)); toast(`Synced ${ops.length} change${ops.length > 1 ? 's' : ''} from this device`); } catch {}
    }
    if (legacy.removed.size || legacy.liked.size) try { localStorage.removeItem('dv-removed'); localStorage.removeItem('dv-liked'); legacy.removed.clear(); legacy.liked.clear(); } catch {}
    apply();
  }
  function decide(id, a) {
    const i = own.sug.findIndex(x => x.id === id); if (i < 0) return;
    const it = own.sug[i];
    if (xOpen) collapse(true); closeMenu();
    own.sug.splice(i, 1); if (a === 'approve') all = [norm({ ...it, date: new Date().toISOString(), savedDate: new Date().toISOString(), dateKind: 'added' }), ...all.filter(x => x.id !== id)];
    const back = () => { all = all.filter(x => x.id !== id || a !== 'approve'); if (!own.sug.some(x => x.id === id)) own.sug.splice(Math.min(i, own.sug.length), 0, it); updSug(); apply(); };
    updSug(); const y = scrollY; apply(); scrollTo(0, y);
    send([{ op: a, id }], back);
    toast(a === 'approve' ? 'Added to vault' : 'Rejected — won’t be suggested again', () => { back(); send([{ op: 'undecide', id }]); });
  }
  if (sugBtn) sugBtn.addEventListener('click', () => setMode(own.mode === 'sug' ? 'vault' : 'sug'));

  // ---- passkey sign-in (owner) ----
  const b64u = {
    enc: buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0)).buffer,
  };
  async function passkey(mode, extra = {}) {
    if (!window.PublicKeyCredential) throw new Error('Passkeys are not supported in this browser');
    const { options: o, flow } = await api('auth/options', { mode, ...extra });
    let cred;
    if (mode === 'register') {
      cred = await navigator.credentials.create({ publicKey: { ...o, challenge: b64u.dec(o.challenge), user: { ...o.user, id: b64u.dec(o.user.id) },
        excludeCredentials: (o.excludeCredentials || []).map(c => ({ ...c, id: b64u.dec(c.id) })) } });
    } else {
      cred = await navigator.credentials.get({ publicKey: { ...o, challenge: b64u.dec(o.challenge), allowCredentials: (o.allowCredentials || []).map(c => ({ ...c, id: b64u.dec(c.id) })) } });
    }
    const r = cred.response, out = { id: cred.id, rawId: b64u.enc(cred.rawId), type: cred.type, clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {}, authenticatorAttachment: cred.authenticatorAttachment || undefined, response: { clientDataJSON: b64u.enc(r.clientDataJSON) } };
    if (mode === 'register') { out.response.attestationObject = b64u.enc(r.attestationObject); out.response.transports = r.getTransports ? r.getTransports() : []; }
    else { out.response.authenticatorData = b64u.enc(r.authenticatorData); out.response.signature = b64u.enc(r.signature); if (r.userHandle) out.response.userHandle = b64u.enc(r.userHandle); }
    return api('auth/verify', { response: out, flow });
  }
  const acct = document.createElement('div'); acct.className = 'acct'; acct.hidden = true; acct.setAttribute('role', 'dialog'); acct.setAttribute('aria-label', 'Owner sign-in');
  document.body.appendChild(acct);
  const closeAcct = () => { acct.hidden = true; if (/^#(signin|enroll=)/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search); };
  function openAcct(enroll) {
    acct.innerHTML = own.on
      ? `<div class="acct-t">Signed in</div><p>Remove, like and Suggested sync to all your devices.</p><button data-k="add">Add another device</button><button data-k="out" class="ghost">Sign out</button><button data-k="x" class="ghost">Close</button>`
      : enroll ? `<div class="acct-t">Set up owner sign-in</div><p>Create a passkey for this device (Face ID / Touch ID). One-time link.</p><button data-k="reg">Create passkey</button><button data-k="x" class="ghost">Not now</button>`
      : `<div class="acct-t">Owner sign-in</div><p>Sign in with your passkey.</p><button data-k="in">Sign in with passkey</button><button data-k="x" class="ghost">Close</button>`;
    acct.hidden = false;
    acct.onclick = async e => {
      const k = e.target.closest('button')?.dataset.k; if (!k) return;
      if (k === 'x') return closeAcct();
      const btn = e.target.closest('button'); btn.disabled = true;
      try {
        if (k === 'in' || k === 'reg') {
          await passkey(k === 'reg' ? 'register' : 'login', k === 'reg' ? { enroll, label: /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'device' } : {});
          closeAcct(); await loadOwner().catch(() => new Promise(r => setTimeout(r, 1200)).then(loadOwner)); toast('Signed in');
        } else if (k === 'out') { await api('auth/logout', {}); setOwner(false); apply(); closeAcct(); toast('Signed out'); }
        else if (k === 'add') {
          const { url } = await api('auth/enroll', {});
          if (navigator.share && matchMedia('(pointer:coarse)').matches) { try { await navigator.share({ url }); } catch {} }
          else { try { await navigator.clipboard.writeText(url); toast('Link copied — open it on the other device within 24h'); } catch { prompt('Open this on the other device (24h):', url); } }
        }
      } catch (err) { btn.disabled = false; if (err && err.name !== 'NotAllowedError' && err.name !== 'AbortError') toast(err.message || 'Sign-in failed'); }
    };
  }
  // long-press the logo (or open #signin) for the owner sheet
  { const brand = $('.brand'); let lp = null, fired = false;
    brand.addEventListener('pointerdown', () => { fired = false; clearTimeout(lp); lp = setTimeout(() => { fired = true; openAcct(); }, 600); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => brand.addEventListener(t, () => clearTimeout(lp)));
    brand.addEventListener('click', e => { if (fired) { e.preventDefault(); e.stopImmediatePropagation(); fired = false; } }, true);
    brand.addEventListener('contextmenu', e => e.preventDefault()); }
  const hashAuth = () => { const m = location.hash.match(/^#enroll=([\w-]+)/); if (m) openAcct(m[1]); else if (location.hash === '#signin') openAcct(); };
  addEventListener('hashchange', hashAuth);

  Promise.all([
    fetch('data/items.json', { cache: 'no-store' }).then(r => r.json()),
    fetch(API + 'state', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null),
  ]).then(([items, st]) => {
    all = items.map(norm); overlay(st); apply();
    api('me').then(m => { if (m.owner) return loadOwner(); }).catch(() => {}).finally(hashAuth);
  }).catch(err => { grid.innerHTML = `<div class="empty">Could not load data/items.json — open via a local server (see README).<br>${esc(err)}</div>`; });
})();
