/* ════════════════════════════════════════════════════════════
   YouTune — Main App Logic
   YouTube Data API v3 | LocalStorage persistence
   ════════════════════════════════════════════════════════════ */
'use strict';

const API_KEY  = 'AIzaSyBl6W_JwgjkcIaKYO1c5cSY62V7coKBUM8';
const YT_API   = 'https://www.googleapis.com/youtube/v3';

/* ══════════════════════════════
   STATE
   ══════════════════════════════ */
const S = {
  subs:        load('yt_subs', []),
  saved:       load('yt_saved', []),
  view:        'home',
  viewStack:   [],
  searchType:  'video',       // 'video' | 'channel'
  chCache:     {},            // channelId → channel API object
};

function load(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function save() {
  localStorage.setItem('yt_subs',  JSON.stringify(S.subs));
  localStorage.setItem('yt_saved', JSON.stringify(S.saved));
}

/* ══════════════════════════════
   TINY HELPERS
   ══════════════════════════════ */
const $ = id => document.getElementById(id);

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls)  e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

/* Video ID from different structures */
function vid(v)  { return typeof v.id === 'string' ? v.id : v.id?.videoId ?? ''; }

/* Thumbnail — always works for any YouTube video */
function thumb(videoId, q = 'mq') {
  return `https://i.ytimg.com/vi/${videoId}/${q}default.jpg`;
}

/* Duration ISO → seconds */
function durSec(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return m ? (+( m[1]||0)*3600 + +(m[2]||0)*60 + +(m[3]||0)) : 0;
}

/* Duration ISO → "m:ss" or "h:mm:ss" */
function durFmt(iso) {
  if (!iso) return '';
  const s = durSec(iso), h = Math.floor(s/3600), m = Math.floor(s%3600/60), sec = s%60;
  return h ? `${h}:${p(m)}:${p(sec)}` : `${m}:${p(sec)}`;
}

function p(n) { return String(n).padStart(2,'0'); }

/* Detect YouTube Shorts */
function isShort(v) {
  const s  = durSec(v.contentDetails?.duration);
  if (s > 0 && s <= 61) return true;
  const t = (v.snippet?.title||'').toLowerCase();
  return t.includes('#shorts') || t.includes('#short');
}

/* Format numbers */
function fmtN(n) {
  n = +n;
  if (!n) return '';
  if (n >= 1e9) return (n/1e9).toFixed(1)+'B';
  if (n >= 1e6) return (n/1e6).toFixed(1)+'M';
  if (n >= 1e3) return Math.round(n/1e3)+'K';
  return String(n);
}

function fmtSubs(n) {
  const s = fmtN(n);
  return s ? s + ' abonnees' : '';
}

/* Time-ago in Dutch */
function ago(d) {
  const s = (Date.now() - new Date(d)) / 1000;
  if (s < 60)      return 'zojuist';
  if (s < 3600)    return `${Math.floor(s/60)} min geleden`;
  if (s < 86400)   return `${Math.floor(s/3600)} uur geleden`;
  if (s < 2592e3)  return `${Math.floor(s/86400)} dagen geleden`;
  if (s < 31536e3) return `${Math.floor(s/2592e3)} mnd geleden`;
  return `${Math.floor(s/31536e3)} jr geleden`;
}

/* ══════════════════════════════
   SHIMMER PLACEHOLDER
   ══════════════════════════════ */
function shimmer(n) {
  return Array(n).fill(`
    <div class="shimmer-card">
      <div class="shim thumb"></div>
      <div class="shim-body">
        <div class="shim line"></div>
        <div class="shim line short"></div>
      </div>
    </div>`).join('');
}

/* ══════════════════════════════
   TOAST
   ══════════════════════════════ */
function toast(msg, type = 'ok') {
  const t = el('div', `toast ${type}`, msg);
  $('toasts').appendChild(t);
  setTimeout(() => t.classList.add('out'), 2700);
  setTimeout(() => t.remove(), 3100);
}

/* ══════════════════════════════
   YOUTUBE API
   ══════════════════════════════ */
async function yt(endpoint, params) {
  const url = new URL(`${YT_API}/${endpoint}`);
  url.searchParams.set('key', API_KEY);
  for (const [k,v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'YouTube API fout');
  return j;
}

/* Get full video details (incl. duration) and filter out Shorts */
async function videoDetails(ids) {
  if (!ids.length) return [];
  const d = await yt('videos', {
    id: ids.join(','),
    part: 'snippet,contentDetails,statistics',
  });
  return (d.items || []).filter(v => !isShort(v));
}

/* Channel videos by order */
async function channelVideos(channelId, order = 'date', maxResults = 20) {
  const s = await yt('search', {
    channelId, type: 'video', order,
    part: 'snippet',
    maxResults: maxResults + 6,          // extra for short-filtering
  });
  if (!s.items?.length) return [];
  const ids = s.items.map(i => i.id.videoId).filter(Boolean);
  return (await videoDetails(ids)).slice(0, maxResults);
}

/* Search videos */
async function searchVideos(q, maxResults = 20) {
  const s = await yt('search', {
    q, type: 'video', part: 'snippet',
    maxResults: maxResults + 6,
  });
  if (!s.items?.length) return [];
  const ids = s.items.map(i => i.id.videoId).filter(Boolean);
  return (await videoDetails(ids)).slice(0, maxResults);
}

/* Search channels */
async function searchChannels(q) {
  const s = await yt('search', { q, type: 'channel', part: 'snippet', maxResults: 10 });
  if (!s.items?.length) return [];
  const ids = s.items.map(i => i.snippet.channelId || i.id.channelId).filter(Boolean).join(',');
  const d = await yt('channels', { id: ids, part: 'snippet,statistics' });
  return d.items || [];
}

/* Full channel info */
async function fetchChannel(channelId) {
  if (S.chCache[channelId]) return S.chCache[channelId];
  const d = await yt('channels', {
    id: channelId,
    part: 'snippet,statistics,brandingSettings',
  });
  const ch = d.items?.[0];
  if (!ch) throw new Error('Kanaal niet gevonden');
  S.chCache[channelId] = ch;
  return ch;
}

/* ══════════════════════════════
   NAVIGATION
   ══════════════════════════════ */
function navigate(viewId, data = null) {
  S.viewStack.push({ id: S.view });
  S.view = viewId;
  showView(viewId, data);
}

function goBack() {
  const prev = S.viewStack.pop();
  if (!prev) return;
  S.view = prev.id;
  showView(prev.id, null, true);
}

function showView(viewId, data, isBack = false) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  $(`view-${viewId}`)?.classList.add('active');

  // Update sidebar nav highlight
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-view="${viewId}"]`)?.classList.add('active');

  // Render content
  if (viewId === 'home')          renderHome();
  else if (viewId === 'subscriptions') renderSubs();
  else if (viewId === 'saved')    renderSaved();
  else if (viewId === 'search')   renderSearch(data);
  else if (viewId === 'channel')  renderChannel(data);
}

/* ══════════════════════════════
   SIDEBAR CHANNELS
   ══════════════════════════════ */
function renderSidebar() {
  const list  = $('sidebar-channels');
  const label = $('sb-ch-label');
  const div   = $('sb-divider');
  const subB  = $('sub-badge');
  const savB  = $('saved-badge');

  list.innerHTML = '';

  // Badges
  if (S.subs.length) { subB.textContent = S.subs.length; subB.style.display=''; }
  else               { subB.style.display='none'; }
  if (S.saved.length) { savB.textContent = S.saved.length; savB.style.display=''; }
  else                { savB.style.display='none'; }

  if (!S.subs.length) { label.style.display='none'; div.style.display='none'; return; }
  label.style.display=''; div.style.display='';

  S.subs.forEach(ch => {
    const item = el('div', 'sb-ch');
    item.innerHTML = `
      <img src="${ch.thumb}" alt="${ch.title}"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <span class="sb-ch-init">${ch.title.charAt(0).toUpperCase()}</span>
      <span class="sb-ch-name">${ch.title}</span>`;
    item.onclick = () => { closeSidebar(); navigate('channel', ch.id); };
    list.appendChild(item);
  });
}

/* ══════════════════════════════
   SUBSCRIBE / UNSUBSCRIBE
   ══════════════════════════════ */
function isSub(id)  { return S.subs.some(s => s.id === id); }

function subscribe(ch) {
  if (isSub(ch.id)) return;
  S.subs.unshift({
    id:    ch.id,
    title: ch.snippet.title,
    thumb: ch.snippet.thumbnails?.medium?.url || ch.snippet.thumbnails?.default?.url || '',
    desc:  ch.snippet.description || '',
    subs:  ch.statistics?.subscriberCount || 0,
  });
  save(); renderSidebar();
  toast(`Geabonneerd op ${ch.snippet.title}`, 'ok');
  if (S.view === 'home') renderHome();
}

function unsubscribe(id) {
  const ch = S.subs.find(s => s.id === id);
  S.subs = S.subs.filter(s => s.id !== id);
  save(); renderSidebar();
  toast(`Afgemeld van ${ch?.title || 'kanaal'}`, 'del');
  if (S.view === 'subscriptions') renderSubs();
  if (S.view === 'home') renderHome();
}

/* ══════════════════════════════
   SAVE / UNSAVE
   ══════════════════════════════ */
function isSaved(id)  { return S.saved.some(s => vid(s) === id); }

function toggleSave(video, btns = []) {
  const id = vid(video);
  const wasSaved = isSaved(id);

  if (wasSaved) {
    S.saved = S.saved.filter(s => vid(s) !== id);
    toast('Verwijderd uit opgeslagen', 'del');
  } else {
    S.saved.unshift(video);
    toast('Opgeslagen!', 'ok');
  }

  save();
  renderSidebar(); // update badge

  // Update all buttons with this video id
  document.querySelectorAll(`[data-save="${id}"]`).forEach(btn => {
    const nowSaved = isSaved(id);
    btn.classList.toggle('active', nowSaved);
    const svgFill = nowSaved ? 'currentColor' : 'none';
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', svgFill);
    if (btn.querySelector('.save-label')) {
      btn.querySelector('.save-label').textContent = nowSaved ? 'Opgeslagen' : 'Opslaan';
    }
  });

  if (S.view === 'saved') renderSaved();
}

/* ══════════════════════════════
   VIDEO CARD
   ══════════════════════════════ */
function createVideoCard(video, chData) {
  const id       = vid(video);
  const s        = video.snippet;
  const dur      = durFmt(video.contentDetails?.duration);
  const imgMq    = thumb(id, 'mq');
  const imgHq    = thumb(id, 'hq');
  const chThumb  = chData?.thumb || s.channelThumbnail || '';
  const chName   = s.channelTitle || chData?.title || '';
  const chId     = s.channelId || '';
  const views    = fmtN(video.statistics?.viewCount);
  const saved    = isSaved(id);

  const card = el('div', 'video-card');
  card.dataset.videoId = id;
  card.innerHTML = `
    <div class="thumb-wrap">
      <img src="${imgMq}" alt="${s.title}"
        onerror="this.src='${imgHq}';this.onerror=null" loading="lazy">
      ${dur ? `<span class="dur-badge">${dur}</span>` : ''}
      <div class="play-ov">
        <div class="play-circle">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5.14v14l11-7-11-7z"/>
          </svg>
        </div>
      </div>
    </div>
    <div class="card-body">
      ${chThumb
        ? `<img class="ch-avatar-sm" src="${chThumb}" alt="${chName}"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
        : ''}
      <span class="ch-init-sm">${chName.charAt(0).toUpperCase()}</span>
      <div class="card-text">
        <div class="card-title">${s.title}</div>
        <div class="card-meta">
          <span class="card-ch">${chName}</span>
          ${views  ? `<span class="dot">·</span><span>${views} weergaven</span>` : ''}
          ${s.publishedAt ? `<span class="dot">·</span><span>${ago(s.publishedAt)}</span>` : ''}
        </div>
      </div>
      <button class="save-btn${saved?' active':''}" data-save="${id}"
        title="${saved?'Verwijder uit opgeslagen':'Opslaan'}">
        <svg width="16" height="16" viewBox="0 0 24 24"
          fill="${saved?'currentColor':'none'}"
          stroke="currentColor" stroke-width="2.5"
          stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
        </svg>
      </button>
    </div>`;

  // Click thumb/title → open modal
  card.querySelector('.thumb-wrap').addEventListener('click', () => openModal(video, chData));
  card.querySelector('.card-text').addEventListener('click', () => openModal(video, chData));

  // Save button
  card.querySelector('.save-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleSave(video);
  });

  // Channel name/avatar → channel page
  const chAv  = card.querySelector('.ch-avatar-sm');
  const chNEl = card.querySelector('.card-ch');
  const goChannel = e => { e.stopPropagation(); if (chId) navigate('channel', chId); };
  if (chAv)  { chAv.style.cursor='pointer'; chAv.addEventListener('click', goChannel); }
  if (chNEl) chNEl.addEventListener('click', goChannel);

  return card;
}

/* ══════════════════════════════
   VIDEO MODAL
   ══════════════════════════════ */
function openModal(video, chData) {
  const id    = vid(video);
  const s     = video.snippet;
  const saved = isSaved(id);
  const chThumb = chData?.thumb || '';
  const chName  = s.channelTitle || chData?.title || '';
  const chId    = s.channelId || chData?.id || '';

  $('modal-player').innerHTML = `
    <iframe src="https://www.youtube.com/embed/${id}?autoplay=1&rel=0&modestbranding=1"
      allow="autoplay; encrypted-media; picture-in-picture; web-share"
      allowfullscreen></iframe>`;

  $('modal-info').innerHTML = `
    <div class="modal-title">${s.title}</div>
    <div class="modal-bottom">
      <div class="modal-ch-info" data-chid="${chId}">
        ${chThumb ? `<img src="${chThumb}" alt="${chName}" onerror="this.style.display='none'">` : ''}
        <span class="modal-ch-name">${chName}</span>
        ${s.publishedAt ? `<span class="modal-date">${ago(s.publishedAt)}</span>` : ''}
      </div>
      <div class="modal-actions">
        <button class="modal-save-btn${saved?' active':''}" data-save="${id}">
          <svg width="14" height="14" viewBox="0 0 24 24"
            fill="${saved?'currentColor':'none'}"
            stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
          </svg>
          <span class="save-label">${saved?'Opgeslagen':'Opslaan'}</span>
        </button>
        <a href="https://youtu.be/${id}" target="_blank" rel="noopener" class="modal-yt-link">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          YouTube
        </a>
      </div>
    </div>`;

  // Save from modal
  $('modal-info').querySelector('.modal-save-btn').addEventListener('click', () => {
    toggleSave(video);
  });

  // Go to channel from modal
  $('modal-info').querySelector('.modal-ch-info').addEventListener('click', () => {
    if (chId) { closeModal(); navigate('channel', chId); }
  });

  $('modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  $('modal').classList.remove('active');
  $('modal-player').innerHTML = '';
  document.body.style.overflow = '';
}

/* ══════════════════════════════
   HOME VIEW
   ══════════════════════════════ */
function renderHome() {
  const c = $('home-content');
  c.innerHTML = '';

  if (!S.subs.length) {
    c.innerHTML = `
      <div class="empty-state">
        <div class="empty-ico">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
            <polyline points="9 22 9 12 15 12 15 22"/>
          </svg>
        </div>
        <h3>Nog geen abonnementen</h3>
        <p>Zoek een kanaal en abonneer je om de laatste video's hier te zien.</p>
        <button class="btn-prim" onclick="document.getElementById('search-input').focus()">
          Kanaal of video zoeken
        </button>
      </div>`;
    return;
  }

  S.subs.forEach(ch => {
    const section = el('section', 'ch-section');
    section.innerHTML = `
      <div class="ch-row">
        <div class="ch-row-left" style="cursor:pointer">
          <img src="${ch.thumb}" alt="${ch.title}"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <span class="ch-row-init">${ch.title.charAt(0).toUpperCase()}</span>
          <span class="ch-row-name">${ch.title}</span>
        </div>
        <button class="see-all-btn">Meer video's ›</button>
      </div>
      <div class="video-grid" id="grid-${ch.id}">${shimmer(4)}</div>`;

    section.querySelector('.ch-row-left').addEventListener('click', () => navigate('channel', ch.id));
    section.querySelector('.see-all-btn').addEventListener('click', () => navigate('channel', ch.id));
    c.appendChild(section);

    // Load async
    channelVideos(ch.id, 'date', 8).then(videos => {
      const grid = $(`grid-${ch.id}`);
      if (!grid) return;
      grid.innerHTML = '';
      if (!videos.length) {
        grid.innerHTML = `<p class="no-vids">Geen recente video's gevonden.</p>`;
        return;
      }
      videos.slice(0, 6).forEach(v => grid.appendChild(createVideoCard(v, ch)));
    }).catch(err => {
      const grid = $(`grid-${ch.id}`);
      if (grid) grid.innerHTML = `<p class="no-vids">Laden mislukt: ${err.message}</p>`;
    });
  });
}

/* ══════════════════════════════
   SUBSCRIPTIONS VIEW
   ══════════════════════════════ */
function renderSubs() {
  const g   = $('subs-grid');
  const sub = $('subs-sub');
  if (sub) sub.textContent = `${S.subs.length} kanaal${S.subs.length !== 1 ? 'en' : ''}`;
  g.innerHTML = '';

  if (!S.subs.length) {
    g.innerHTML = `
      <div class="empty-state">
        <div class="empty-ico">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
        </div>
        <h3>Geen abonnementen</h3>
        <p>Zoek kanalen met de zoekbalk om je op te abonneren.</p>
      </div>`;
    return;
  }

  S.subs.forEach(ch => {
    const card = el('div', 'ch-card');
    card.innerHTML = `
      <div class="ch-card-avatar-wrap">
        <img class="ch-card-avatar" src="${ch.thumb}" alt="${ch.title}"
          onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <span class="ch-init-lg">${ch.title.charAt(0).toUpperCase()}</span>
      </div>
      <div class="ch-card-name">${ch.title}</div>
      ${ch.subs ? `<div class="ch-card-subs">${fmtSubs(ch.subs)}</div>` : ''}
      ${ch.desc ? `<div class="ch-card-desc">${ch.desc}</div>` : ''}
      <div class="ch-card-btns">
        <button class="btn-view">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
          </svg>
          Bekijk
        </button>
        <button class="btn-unsub" data-id="${ch.id}">Afmelden</button>
      </div>`;

    card.querySelector('.ch-card-avatar-wrap').addEventListener('click', () => navigate('channel', ch.id));
    card.querySelector('.btn-view').addEventListener('click', () => navigate('channel', ch.id));
    card.querySelector('.btn-unsub').addEventListener('click', () => unsubscribe(ch.id));
    g.appendChild(card);
  });
}

/* ══════════════════════════════
   SAVED VIEW
   ══════════════════════════════ */
function renderSaved() {
  const g   = $('saved-grid');
  const sub = $('saved-sub');
  if (sub) sub.textContent = `${S.saved.length} video${S.saved.length !== 1 ? "'s" : ''}`;
  g.innerHTML = '';

  if (!S.saved.length) {
    g.innerHTML = `
      <div class="empty-state">
        <div class="empty-ico">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
          </svg>
        </div>
        <h3>Geen opgeslagen video's</h3>
        <p>Klik op het bladwijzer-icoon op een video om hem hier op te slaan.</p>
      </div>`;
    return;
  }

  S.saved.forEach(v => {
    const chData = S.subs.find(s => s.id === v.snippet?.channelId);
    g.appendChild(createVideoCard(v, chData));
  });
}

/* ══════════════════════════════
   SEARCH VIEW
   ══════════════════════════════ */
async function doSearch(q) {
  q = q.trim();
  if (!q) return;
  navigate('search', { q, type: S.searchType });
}

async function renderSearch(data) {
  if (!data) return;
  const { q, type } = data;

  $('search-title').textContent = `"${q}"`;
  $('search-sub').textContent   = type === 'channel' ? 'Kanalen' : 'Video\'s';

  const c = $('search-content');
  c.innerHTML = `<div class="spin-wrap"><div class="spin"></div></div>`;

  try {
    if (type === 'channel') {
      const channels = await searchChannels(q);
      c.innerHTML = '';
      if (!channels.length) {
        c.innerHTML = '<p class="no-vids">Geen kanalen gevonden.</p>';
        return;
      }
      const wrap = el('div', 'channel-results');
      channels.forEach(ch => wrap.appendChild(createChannelRow(ch)));
      c.appendChild(wrap);
    } else {
      const videos = await searchVideos(q);
      c.innerHTML = '';
      if (!videos.length) {
        c.innerHTML = '<p class="no-vids">Geen video\'s gevonden (Shorts worden gefilterd).</p>';
        return;
      }
      const grid = el('div', 'video-grid');
      videos.forEach(v => grid.appendChild(createVideoCard(v)));
      c.appendChild(grid);
    }
  } catch(err) {
    c.innerHTML = `<p class="err-msg">Fout: ${err.message}</p>`;
  }
}

/* Channel row in search results */
function createChannelRow(ch) {
  const avatar  = ch.snippet.thumbnails?.medium?.url || ch.snippet.thumbnails?.default?.url || '';
  const name    = ch.snippet.title;
  const subCnt  = fmtSubs(ch.statistics?.subscriberCount);
  const desc    = (ch.snippet.description || '').substring(0, 100);
  const subbed  = isSub(ch.id);

  const row = el('div', 'ch-result-row');
  row.innerHTML = `
    <div class="ch-result-avatar-wrap">
      <img class="ch-result-avatar" src="${avatar}" alt="${name}"
        onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
      <span class="ch-init-md">${name.charAt(0).toUpperCase()}</span>
    </div>
    <div class="ch-result-info">
      <div class="ch-result-name">${name}</div>
      ${subCnt ? `<div class="ch-result-subs">${subCnt}</div>` : ''}
      ${desc ? `<div class="ch-result-desc">${desc}</div>` : ''}
    </div>
    <button class="sub-toggle-btn${subbed?' subbed':''}" data-id="${ch.id}">
      ${subbed
        ? `<svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm3.93 5.71L9 12.64 6.07 9.71a1 1 0 00-1.41 1.41l3.5 3.5a1 1 0 001.41 0l5.5-5.5a1 1 0 00-1.41-1.41z"/></svg>Geabonneerd`
        : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Abonneer`
      }
    </button>`;

  row.querySelector('.ch-result-avatar-wrap').addEventListener('click', () => navigate('channel', ch.id));
  row.querySelector('.ch-result-info').addEventListener('click', () => navigate('channel', ch.id));

  const btn = row.querySelector('.sub-toggle-btn');
  btn.addEventListener('click', () => {
    if (isSub(ch.id)) {
      unsubscribe(ch.id);
      btn.classList.remove('subbed');
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Abonneer`;
    } else {
      subscribe(ch);
      btn.classList.add('subbed');
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm3.93 5.71L9 12.64 6.07 9.71a1 1 0 00-1.41 1.41l3.5 3.5a1 1 0 001.41 0l5.5-5.5a1 1 0 00-1.41-1.41z"/></svg>Geabonneerd`;
    }
  });

  return row;
}

/* ══════════════════════════════
   CHANNEL DETAIL VIEW
   ══════════════════════════════ */
async function renderChannel(channelId) {
  const c = $('channel-content');
  c.innerHTML = `
    <div class="ch-top-back">
      <button class="back-btn" onclick="goBack()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
      </button>
    </div>
    <div class="spin-wrap"><div class="spin"></div></div>`;

  try {
    const ch = await fetchChannel(channelId);
    const s  = ch.snippet;
    const banner  = ch.brandingSettings?.image?.bannerExternalUrl;
    const avatar  = s.thumbnails?.medium?.url || s.thumbnails?.default?.url || '';
    const subCnt  = fmtSubs(ch.statistics?.subscriberCount);
    const vidCnt  = ch.statistics?.videoCount
      ? `${(+ch.statistics.videoCount).toLocaleString('nl')} video's` : '';
    const subbed  = isSub(channelId);
    const subStore = S.subs.find(x => x.id === channelId) || { id: channelId, title: s.title, thumb: avatar };

    c.innerHTML = `
      <div class="ch-top-back">
        <button class="back-btn" onclick="goBack()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
      </div>
      ${banner
        ? `<div class="ch-banner" style="background-image:url('${banner}=w1440-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj')"></div>`
        : '<div class="ch-banner-empty"></div>'}
      <div class="ch-info-bar">
        <div class="ch-avatar-xl-wrap">
          <img class="ch-avatar-xl" src="${avatar}" alt="${s.title}"
            onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
          <span class="ch-init-xl">${s.title.charAt(0).toUpperCase()}</span>
        </div>
        <div class="ch-details-text">
          <h2 class="ch-name">${s.title}</h2>
          <p class="ch-meta-line">${[subCnt, vidCnt].filter(Boolean).join(' · ')}</p>
          ${s.description
            ? `<p class="ch-desc-preview">${s.description.substring(0,180)}${s.description.length>180?'…':''}</p>`
            : ''}
        </div>
        <button class="ch-sub-btn${subbed?' subbed':''}" id="ch-sub-btn" data-id="${channelId}">
          ${subbed
            ? `<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm3.93 5.71L9 12.64 6.07 9.71a1 1 0 00-1.41 1.41l3.5 3.5a1 1 0 001.41 0l5.5-5.5a1 1 0 00-1.41-1.41z"/></svg>Geabonneerd`
            : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Abonneer`
          }
        </button>
      </div>

      <div class="ch-tabs">
        <button class="ch-tab active" data-tab="newest">Nieuwst</button>
        <button class="ch-tab" data-tab="popular">Populair</button>
      </div>
      <div class="ch-tab-content">
        <div class="video-grid" id="ch-videos">${shimmer(8)}</div>
      </div>`;

    // Subscribe button
    const subBtn = $('ch-sub-btn');
    subBtn.addEventListener('click', () => {
      if (isSub(channelId)) {
        unsubscribe(channelId);
        subBtn.classList.remove('subbed');
        subBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Abonneer`;
      } else {
        subscribe(ch);
        subBtn.classList.add('subbed');
        subBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 100 16A8 8 0 0010 2zm3.93 5.71L9 12.64 6.07 9.71a1 1 0 00-1.41 1.41l3.5 3.5a1 1 0 001.41 0l5.5-5.5a1 1 0 00-1.41-1.41z"/></svg>Geabonneerd`;
      }
    });

    // Tabs
    const tabs = c.querySelectorAll('.ch-tab');
    let activeTab = 'newest';
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        if (tab.dataset.tab === activeTab) return;
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        activeTab = tab.dataset.tab;
        loadChTab(channelId, activeTab, subStore);
      });
    });

    // Load default tab
    loadChTab(channelId, 'newest', subStore);

  } catch(err) {
    c.innerHTML = `
      <div class="ch-top-back">
        <button class="back-btn" onclick="goBack()">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
        </button>
      </div>
      <div style="padding:40px 24px"><p class="err-msg">Laden mislukt: ${err.message}</p></div>`;
  }
}

async function loadChTab(channelId, tab, chStore) {
  const grid = $('ch-videos');
  if (!grid) return;
  grid.innerHTML = shimmer(8);

  try {
    const order  = tab === 'popular' ? 'viewCount' : 'date';
    const videos = await channelVideos(channelId, order, 20);
    grid.innerHTML = '';
    if (!videos.length) {
      grid.innerHTML = `<p class="no-vids">Geen video's gevonden.</p>`;
      return;
    }
    videos.forEach(v => grid.appendChild(createVideoCard(v, chStore)));
  } catch(err) {
    grid.innerHTML = `<p class="no-vids">Laden mislukt: ${err.message}</p>`;
  }
}

/* ══════════════════════════════
   MOBILE SIDEBAR
   ══════════════════════════════ */
function openSidebar()  {
  $('sidebar').classList.add('open');
  $('sidebar-overlay').classList.add('active');
}
function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('active');
}

/* ══════════════════════════════
   INIT
   ══════════════════════════════ */
window.addEventListener('DOMContentLoaded', () => {

  // Sidebar nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      S.viewStack = [];         // reset back-stack when clicking main nav
      S.view = item.dataset.view;
      showView(item.dataset.view);
      closeSidebar();
    });
  });

  // Search type toggle
  document.querySelectorAll('.stoggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.stoggle-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.searchType = btn.dataset.type;
      $('search-input').placeholder =
        S.searchType === 'video' ? "Zoek video's…" : 'Zoek een kanaal…';
    });
  });

  // Search
  $('search-btn').addEventListener('click', () => doSearch($('search-input').value));
  $('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch($('search-input').value);
  });

  // Back button in search view
  $('search-back').addEventListener('click', goBack);

  // Modal close
  $('modal-close').addEventListener('click', closeModal);
  $('modal-bg').addEventListener('click', closeModal);

  // Mobile sidebar
  $('menu-btn').addEventListener('click', openSidebar);
  $('sidebar-overlay').addEventListener('click', closeSidebar);

  // ESC
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); closeSidebar(); }
  });

  // Boot
  renderSidebar();
  renderHome();
});
