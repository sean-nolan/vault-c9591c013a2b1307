(() => {
  const PAGE = 120;
  const $ = s => document.querySelector(s);
  const grid = $('#grid'), tagsEl = $('#tags'), q = $('#q');
  const state = { src: 'all', tags: new Set(), q: '', sort: 'newest', tq: '', allTags: false };
  const TOP = 24;
  let all = [], view = [], shown = 0;
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

  // Lazy video play: only play visible videos
  const vio = new IntersectionObserver(es => es.forEach(e => {
    const v = e.target;
    if (e.isIntersecting) {
      if (!v.getAttribute('src') && v.dataset.src) { v.src = v.dataset.src; v.load(); }
      const pr = v.play(); if (pr) pr.catch(() => {}); // autoplay may be refused (Low Power Mode); the poster stays visible
    } else if (!v.paused) v.pause();
  }), { rootMargin: '200px' });

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
      a.innerHTML = `<video class="${ar ? 'ph' : ''}" style="${ar};${bg}" muted loop playsinline webkit-playsinline disableremoteplayback referrerpolicy="no-referrer" preload="${it.posterUrl ? 'none' : 'metadata'}" ${it.posterUrl ? `poster="${esc(it.posterUrl)}"` : ''} data-src="${esc(tileSrc(it))}"${tileSrc(it) !== it.mediaUrl ? ` data-full="${esc(it.mediaUrl)}"` : ''}></video>
        <span class="badge">video</span>
        <div class="meta"><div class="t">${esc(label(it))}</div><div class="s">${subH}</div></div>`;
      vio.observe(a.querySelector('video'));
    } else {
      a.className = 'card link';
      a.innerHTML = `<span class="badge">${esc(src)}</span><div class="t">${esc(label(it))}</div>
        ${it.text && it.text !== it.title ? `<div class="txt">${esc(it.text)}</div>` : ''}<div class="s">${esc(host(it.url))}</div>`;
    }
    const m = a.querySelector('img,video');
    if (m) m.addEventListener('error', () => {
      if (m.tagName === 'VIDEO' && it.posterUrl && !a.dataset.fb) { // fall back to poster image
        a.dataset.fb = 1; const img = document.createElement('img'); img.src = it.posterUrl; img.referrerPolicy = 'no-referrer';
        img.onerror = () => a.classList.add('broken'); m.replaceWith(img); return;
      }
      a.classList.add('broken');
    });
    a.dataset.id = it.id;
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
    if (state.sort === 'shuffle') view = view.map(v => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(v => v[1]);
    if (state.sort === 'media') view = [...view].sort((a, b) => (b.mediaUrl ? 1 : 0) - (a.mediaUrl ? 1 : 0));
    grid.querySelectorAll('video').forEach(v => vio.unobserve(v));
    grid.innerHTML = ''; shown = 0; more();
    $('#empty').hidden = view.length > 0;
    $('#count').textContent = own.mode === 'sug' ? `${view.length} suggested` : `${view.length} / ${all.length - removed.size}`;
    $('#empty').textContent = own.mode === 'sug' ? 'No suggestions waiting. New picks arrive with the morning and evening digests.' : 'Nothing here yet.';
    renderTags();
  }

  function more() {
    const frag = document.createDocumentFragment();
    view.slice(shown, shown + PAGE).forEach(it => frag.appendChild(card(it)));
    shown = Math.min(view.length, shown + PAGE);
    grid.appendChild(frag);
  }
  new IntersectionObserver(es => { if (es[0].isIntersecting && shown < view.length) more(); }, { rootMargin: '1200px' }).observe($('#sentinel'));

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
  const vbtn = $('#vbtn');
  const setView = single => { grid.classList.toggle('single', single); vbtn.setAttribute('aria-pressed', single); vbtn.setAttribute('aria-label', single ? 'Grid view' : 'Single column view'); vbtn.title = single ? 'Grid view' : 'Single column'; try { localStorage.setItem('dv-view', single ? 'single' : 'grid'); } catch {} };
  let saved = null; try { saved = localStorage.getItem('dv-view'); } catch {}
  setView(saved === 'single');
  vbtn.addEventListener('click', () => setView(!grid.classList.contains('single')));

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

  // ---- expanded view (multi-column grid): FLIP the tile to a full-width view ----
  const xv = document.createElement('div'); xv.className = 'xv'; xv.hidden = true;
  xv.innerHTML = '<div class="xv-bg"></div><div class="xv-scroll"><div class="xv-wrap"></div></div>';
  document.body.appendChild(xv);
  const xbg = xv.querySelector('.xv-bg'), xsc = xv.querySelector('.xv-scroll'), xwrap = xv.querySelector('.xv-wrap');
  let xOpen = null, xAnim = false;
  const EASE = 'cubic-bezier(.2,.8,.2,1)', DUR = 320;
  const flipFrom = (el, r) => { const f = el.getBoundingClientRect(), k = r.width / f.width;
    return `translate(${r.left - f.left}px, ${r.top - f.top}px) scale(${k})`; };
  function expand(tile) {
    if (xOpen || xAnim) return; closeMenu();
    const r = tile.getBoundingClientRect();
    const el = tile.cloneNode(true); el.classList.add('xcard'); el.classList.remove('menu-on'); el.removeAttribute('title');
    const v = el.querySelector('video');
    if (v) { const tv = tile.querySelector('video'); v.src = (tv && tv.dataset.full) || (tv && (tv.currentSrc || tv.src)) || v.dataset.src; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'auto';
      v.setAttribute('referrerpolicy', 'no-referrer'); const t0 = tv ? tv.currentTime : 0;
      if (t0) v.addEventListener('loadedmetadata', () => { try { v.currentTime = t0; } catch {} }, { once: true });
      const pr = v.play(); if (pr) pr.catch(() => {}); }
    xwrap.replaceChildren(el); xv.hidden = false; xsc.scrollTop = 0;
    document.documentElement.classList.add('xv-on');
    xOpen = { tile, el }; tile.style.visibility = 'hidden';
    openMenu(el); xwrap.appendChild(menu); menu.classList.add('xm'); el.classList.remove('menu-on');
    xAnim = true;
    const m = el.animate([{ transform: flipFrom(el, r), transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }], { duration: DUR, easing: EASE });
    xbg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR, easing: 'ease-out' });
    menu.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR, delay: DUR * .5, fill: 'backwards' });
    m.onfinish = () => { xAnim = false; };
  }
  function collapse(instant) {
    if (!xOpen) return; const { tile, el } = xOpen;
    const done = () => { tile.style.visibility = ''; xv.hidden = true; xwrap.replaceChildren(); el.style.transform = '';
      document.documentElement.classList.remove('xv-on'); xOpen = null; xAnim = false; menu = null; };
    el.querySelector('video')?.pause();
    if (instant || !tile.isConnected) return done();
    xAnim = true; xwrap.querySelector('.tmenu')?.remove();
    const cur = el.style.transform; el.style.transform = '';
    const to = flipFrom(el, tile.getBoundingClientRect());
    const m = el.animate([{ transform: cur || 'none', transformOrigin: '0 0' }, { transform: to, transformOrigin: '0 0' }], { duration: DUR - 40, easing: EASE, fill: 'forwards' });
    xbg.animate([{ opacity: getComputedStyle(xbg).opacity }, { opacity: 0 }], { duration: DUR - 40, fill: 'forwards' });
    m.onfinish = done;
  }
  xv.addEventListener('click', e => {
    const b = e.target.closest('.tmenu button');
    if (b && xOpen) { e.stopPropagation(); return act(xOpen.el, b, xOpen.tile); }
    if (e.target.closest('.xcard')) { e.preventDefault(); e.stopPropagation(); return; }
    e.stopPropagation(); collapse();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && xOpen) collapse(); }, true);
  // swipe down (from the top of the expanded view) to collapse
  let sy0 = null, sdy = 0;
  xsc.addEventListener('touchstart', e => { sy0 = (xsc.scrollTop <= 0 && e.touches.length === 1 && !xAnim) ? e.touches[0].clientY : null; sdy = 0; }, { passive: true });
  xsc.addEventListener('touchmove', e => {
    if (sy0 == null || !xOpen) return; sdy = e.touches[0].clientY - sy0;
    if (sdy <= 0) { xOpen.el.style.transform = ''; return; }
    e.preventDefault();
    const k = 1 - Math.min(sdy, 300) / 1200; xOpen.el.style.transform = `translateY(${sdy * .6}px) scale(${k})`;
    xbg.style.opacity = 1 - Math.min(sdy, 300) / 450;
  }, { passive: false });
  xsc.addEventListener('touchend', () => {
    if (sy0 == null || !xOpen) return; sy0 = null;
    if (sdy > 90) collapse(); else { xOpen.el.animate([{ transform: xOpen.el.style.transform || 'none' }, { transform: 'none' }], { duration: 180, easing: EASE }); xOpen.el.style.transform = ''; xbg.style.opacity = ''; }
  });
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
      .map(x => norm({ ...x, date: x.date || x.approvedAt, savedDate: x.approvedAt, dateKind: 'added' }));
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
