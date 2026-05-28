/* ============================================================
   YouTune — YouTube channel browser for GitHub Pages
   Uses YouTube Data API v3
   ============================================================ */

const API_KEY = 'AIzaSyBl6W_JwgjkcIaKYO1c5cSY62V7coKBUM8';
const API_BASE = 'https://www.googleapis.com/youtube/v3';

// ── Local state ───────────────────────────────────────────────
let subscriptions = JSON.parse(localStorage.getItem('yt_subscriptions') || '[]');
let savedVideos   = JSON.parse(localStorage.getItem('yt_saved_videos')  || '[]');
let currentPage   = 'home';
let trendingLoaded = false;

// ── DOM helpers ───────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

// ── Persist ───────────────────────────────────────────────────
function saveSubs() {
  localStorage.setItem('yt_subscriptions', JSON.stringify(subscriptions));
}
function saveSavedVideos() {
  localStorage.setItem('yt_saved_videos', JSON.stringify(savedVideos));
}

// ── Toast ─────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  const t = el('div', `toast ${type}`,
    `<span class="toast-dot"></span>${msg}`);
  $('toast-container').appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ── Format helpers ────────────────────────────────────────────
function formatDuration(iso) {
  if (!iso) return '';
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '';
  const h = parseInt(m[1] || 0), min = parseInt(m[2] || 0), s = parseInt(m[3] || 0);
  if (h > 0) return `${h}:${String(min).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${min}:${String(s).padStart(2,'0')}`;
}

function durationSeconds(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1]||0)*3600) + (parseInt(m[2]||0)*60) + parseInt(m[3]||0);
}

function isShort(video) {
  const dur = durationSeconds(video.contentDetails?.duration);
  // Shorts are ≤ 60 seconds OR explicitly marked
  if (dur > 0 && dur <= 60) return true;
  const title = (video.snippet?.title || '').toLowerCase();
  if (title.includes('#shorts') || title.includes('#short')) return true;
  // Check dimension (vertical = likely short)
  const dim = video.contentDetails?.dimension;
  if (dim === 'short') return true;
  return false;
}

function formatViews(n) {
  if (!n) return '';
  n = parseInt(n);
  if (n >= 1e9) return (n/1e9).toFixed(1) + 'G views';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M views';
  if (n >= 1e3) return (n/1e3).toFixed(0) + 'K views';
  return n + ' views';
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60) return 'zojuist';
  if (diff < 3600) return Math.floor(diff/60) + ' min geleden';
  if (diff < 86400) return Math.floor(diff/3600) + ' uur geleden';
  if (diff < 2592000) return Math.floor(diff/86400) + ' dagen geleden';
  if (diff < 31536000) return Math.floor(diff/2592000) + ' mnd geleden';
  return Math.floor(diff/31536000) + ' jaar geleden';
}

function formatSubs(n) {
  if (!n) return '';
  n = parseInt(n);
  if (n >= 1e9) return (n/1e9).toFixed(1) + 'B abonnees';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M abonnees';
  if (n >= 1e3) return (n/1e3).toFixed(0) + 'K abonnees';
  return n + ' abonnees';
}

// ── API ───────────────────────────────────────────────────────
async function api(endpoint, params) {
  const url = new URL(`${API_BASE}/${endpoint}`);
  url.searchParams.set('key', API_KEY);
  Object.entries(params).forEach(([k,v]) => url.searchParams.set(k,v));
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'API error');
  }
  return res.json();
}

// Search channels only (type=channel)
async function searchChannels(query) {
  const data = await api('search', {
    q: query,
    type: 'channel',
    part: 'snippet',
    maxResults: 8
  });
  const ids = data.items.map(i => i.id.channelId || i.snippet.channelId).join(',');
  if (!ids) return [];
  const details = await api('channels', {
    id: ids,
    part: 'snippet,statistics',
    maxResults: 8
  });
  return details.items;
}

// Get latest videos from a channel (no shorts)
async function getChannelVideos(channelId, maxResults = 10) {
  // Use search to get latest uploads
  const search = await api('search', {
    channelId,
    part: 'snippet',
    order: 'date',
    type: 'video',
    maxResults: maxResults + 5 // fetch extra to account for filtered shorts
  });

  if (!search.items?.length) return [];

  const videoIds = search.items.map(i => i.id.videoId).join(',');
  const details = await api('videos', {
    id: videoIds,
    part: 'snippet,contentDetails,statistics'
  });

  return (details.items || []).filter(v => !isShort(v));
}

// Get trending videos
async function getTrendingVideos(regionCode = 'NL', maxResults = 24) {
  const data = await api('videos', {
    part: 'snippet,contentDetails,statistics',
    chart: 'mostPopular',
    regionCode,
    maxResults: maxResults + 8,
    videoCategoryId: ''
  });
  return (data.items || []).filter(v => !isShort(v)).slice(0, maxResults);
}

// ── Navigation ────────────────────────────────────────────────
function navigateTo(page) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`)?.classList.add('active');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  $(`page-${page}`)?.classList.add('active');
  currentPage = page;
  hideSearch();

  if (page === 'home') loadHomeFeed();
  if (page === 'subscriptions') renderSubscriptions();
  if (page === 'trending' && !trendingLoaded) loadTrending();
  if (page === 'saved') renderSaved();
}

// ── Sidebar ───────────────────────────────────────────────────
function renderSidebarChannels() {
  const list = $('subscribed-list');
  const label = $('subscribed-section-label');
  const badge = $('sub-count');
  list.innerHTML = '';

  if (subscriptions.length === 0) {
    label.style.display = 'none';
    badge.style.display = 'none';
    return;
  }

  label.style.display = '';
  badge.style.display = '';
  badge.textContent = subscriptions.length;

  subscriptions.forEach(ch => {
    const item = el('div', 'subscribed-channel-item');
    item.innerHTML = `
      <img src="${ch.thumbnail}" alt="${ch.title}" onerror="this.src='https://via.placeholder.com/24'">
      <span class="subscribed-channel-name">${ch.title}</span>
    `;
    item.onclick = () => {
      navigateTo('home');
      scrollToChannel(ch.id);
    };
    list.appendChild(item);
  });
}

function scrollToChannel(channelId) {
  const section = document.querySelector(`[data-channel-id="${channelId}"]`);
  if (section) section.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Subscribe / Unsubscribe ───────────────────────────────────
function isSubscribed(channelId) {
  return subscriptions.some(s => s.id === channelId);
}

function subscribe(channel) {
  if (isSubscribed(channel.id)) return;
  const entry = {
    id: channel.id,
    title: channel.snippet.title,
    thumbnail: channel.snippet.thumbnails?.medium?.url || channel.snippet.thumbnails?.default?.url || '',
    description: channel.snippet.description
  };
  subscriptions.unshift(entry);
  saveSubs();
  renderSidebarChannels();
  updateSubtitle();
  toast(`Geabonneerd op ${channel.snippet.title}`, 'success');
  // Reload home if on home page
  if (currentPage === 'home') loadHomeFeed();
}

function unsubscribe(channelId) {
  const ch = subscriptions.find(s => s.id === channelId);
  subscriptions = subscriptions.filter(s => s.id !== channelId);
  saveSubs();
  renderSidebarChannels();
  updateSubtitle();
  toast(`Afgemeld van ${ch?.title || 'kanaal'}`, 'error');
  if (currentPage === 'home') loadHomeFeed();
  if (currentPage === 'subscriptions') renderSubscriptions();
}

function updateSubtitle() {
  const el = $('sub-subtitle');
  if (el) el.textContent = `${subscriptions.length} kanaal${subscriptions.length !== 1 ? 'en' : ''}`;
}

// ── Home feed ─────────────────────────────────────────────────
async function loadHomeFeed() {
  const feed = $('home-feed');
  const empty = $('home-empty');

  if (subscriptions.length === 0) {
    feed.innerHTML = '';
    feed.appendChild(empty);
    empty.style.display = 'flex';
    return;
  }

  empty.style.display = 'none';
  feed.innerHTML = '';

  // Render a section per subscribed channel
  for (const ch of subscriptions) {
    const section = el('div', 'channel-section');
    section.setAttribute('data-channel-id', ch.id);

    const header = el('div', 'section-header');
    header.innerHTML = `
      <span class="section-title">
        <img src="${ch.thumbnail}" class="section-channel-avatar" alt="${ch.title}">
        ${ch.title}
      </span>
      <span class="section-see-all" data-ch="${ch.id}">Alles bekijken ›</span>
    `;
    section.appendChild(header);

    // Shimmer while loading
    const grid = el('div', 'video-grid');
    const shimContainer = el('div', 'loading-shimmer-grid');
    shimContainer.innerHTML = Array(4).fill(`
      <div class="shimmer-card">
        <div class="shimmer thumb"></div>
        <div class="shimmer-info">
          <div class="shimmer line short"></div>
          <div class="shimmer line"></div>
        </div>
      </div>`).join('');
    grid.appendChild(shimContainer);
    section.appendChild(grid);
    feed.appendChild(section);

    // Load videos async
    getChannelVideos(ch.id, 8).then(videos => {
      shimContainer.remove();
      if (!videos.length) {
        grid.innerHTML = '<p class="no-videos-msg">Geen recente video\'s gevonden.</p>';
        return;
      }
      videos.slice(0, 6).forEach(v => {
        grid.appendChild(createVideoCard(v, ch));
      });
    }).catch(() => {
      shimContainer.remove();
      grid.innerHTML = '<p class="no-videos-msg">Kon video\'s niet laden.</p>';
    });
  }
}

// ── Subscriptions page ────────────────────────────────────────
function renderSubscriptions() {
  const grid = $('subscriptions-grid');
  grid.innerHTML = '';
  updateSubtitle();

  if (subscriptions.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 00-3-3.87"/>
            <path d="M16 3.13a4 4 0 010 7.75"/>
          </svg>
        </div>
        <h3>Geen abonnementen</h3>
        <p>Zoek kanalen om je op te abonneren.</p>
      </div>`;
    return;
  }

  subscriptions.forEach(ch => {
    const card = el('div', 'channel-card');
    card.innerHTML = `
      <img src="${ch.thumbnail}" class="channel-card-avatar" alt="${ch.title}" onerror="this.src='https://via.placeholder.com/72'">
      <div class="channel-card-name">${ch.title}</div>
      ${ch.description ? `<p class="channel-card-desc">${ch.description}</p>` : ''}
      <button class="unsubscribe-btn" data-id="${ch.id}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/>
          <path d="M13.73 21a2 2 0 01-3.46 0"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
        Afmelden
      </button>
    `;
    card.querySelector('.unsubscribe-btn').onclick = e => {
      e.stopPropagation();
      unsubscribe(ch.id);
    };
    grid.appendChild(card);
  });
}

// ── Trending ──────────────────────────────────────────────────
async function loadTrending() {
  const feed = $('trending-feed');
  const loadingEl = $('trending-loading');

  try {
    const videos = await getTrendingVideos();
    if (loadingEl) loadingEl.remove();
    videos.forEach(v => feed.appendChild(createVideoCard(v)));
    trendingLoaded = true;
  } catch (err) {
    if (loadingEl) loadingEl.remove();
    feed.innerHTML = `<div class="empty-state"><h3>Laden mislukt</h3><p>${err.message}</p></div>`;
  }
}

// ── Saved videos ──────────────────────────────────────────────
function renderSaved() {
  const feed = $('saved-feed');
  feed.innerHTML = '';

  if (savedVideos.length === 0) {
    feed.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
          </svg>
        </div>
        <h3>Geen opgeslagen video's</h3>
        <p>Sla video's op door op het bookmark-icoon te klikken.</p>
      </div>`;
    return;
  }

  savedVideos.forEach(v => {
    const card = createVideoCard(v);
    feed.appendChild(card);
  });
}

// ── Video card ────────────────────────────────────────────────
function createVideoCard(video, channelOverride) {
  const id = video.id?.videoId || video.id;
  const snippet = video.snippet;
  const thumb = snippet.thumbnails?.maxres?.url ||
                snippet.thumbnails?.high?.url ||
                snippet.thumbnails?.medium?.url || '';
  const title = snippet.title;
  const channelTitle = snippet.channelTitle || channelOverride?.title || '';
  const channelThumb = channelOverride?.thumbnail || '';
  const publishedAt = snippet.publishedAt;
  const duration = formatDuration(video.contentDetails?.duration);
  const views = formatViews(video.statistics?.viewCount);
  const isSaved = savedVideos.some(s => (s.id?.videoId || s.id) === id);

  const card = el('div', 'video-card');
  card.setAttribute('data-video-id', id);
  card.innerHTML = `
    <div class="video-thumb">
      <img src="${thumb}" alt="${title}" loading="lazy" onerror="this.src=''">
      ${duration ? `<span class="video-duration">${duration}</span>` : ''}
      <div class="video-play-overlay">
        <div class="play-btn-circle">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M5 3l14 9L5 21V3z"/>
          </svg>
        </div>
      </div>
      <button class="save-btn ${isSaved ? 'saved' : ''}" data-id="${id}" title="${isSaved ? 'Verwijder' : 'Opslaan'}">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="${isSaved ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>
        </svg>
      </button>
    </div>
    <div class="video-info">
      ${channelThumb ? `<img src="${channelThumb}" class="channel-avatar-sm" alt="${channelTitle}" onerror="this.style.display='none'">` : ''}
      <div class="video-text">
        <div class="video-title">${title}</div>
        <div class="video-meta-line">
          <span>${channelTitle}</span>
          ${views ? `<span class="dot">·</span><span>${views}</span>` : ''}
          ${publishedAt ? `<span class="dot">·</span><span>${timeAgo(publishedAt)}</span>` : ''}
        </div>
      </div>
    </div>
  `;

  card.querySelector('.save-btn').addEventListener('click', e => {
    e.stopPropagation();
    toggleSave(video);
    const btn = e.currentTarget;
    const saved = savedVideos.some(s => (s.id?.videoId || s.id) === id);
    btn.classList.toggle('saved', saved);
    btn.querySelector('svg').setAttribute('fill', saved ? 'currentColor' : 'none');
    btn.title = saved ? 'Verwijder' : 'Opslaan';
  });

  card.querySelector('.video-thumb').addEventListener('click', () => openVideoModal(video, channelOverride));
  card.querySelector('.video-text').addEventListener('click', () => openVideoModal(video, channelOverride));

  return card;
}

function toggleSave(video) {
  const id = video.id?.videoId || video.id;
  const idx = savedVideos.findIndex(s => (s.id?.videoId || s.id) === id);
  if (idx >= 0) {
    savedVideos.splice(idx, 1);
    toast('Verwijderd uit opgeslagen', 'error');
  } else {
    savedVideos.unshift(video);
    toast('Opgeslagen!', 'success');
  }
  saveSavedVideos();
  if (currentPage === 'saved') renderSaved();
}

// ── Video modal ───────────────────────────────────────────────
function openVideoModal(video, channelOverride) {
  const id = video.id?.videoId || video.id;
  const snippet = video.snippet;
  const channelThumb = channelOverride?.thumbnail || '';
  const channelTitle = snippet.channelTitle || channelOverride?.title || '';

  $('video-player-wrap').innerHTML = `
    <iframe
      src="https://www.youtube.com/embed/${id}?autoplay=1&rel=0"
      allow="autoplay; encrypted-media; picture-in-picture"
      allowfullscreen
    ></iframe>`;

  $('video-meta').innerHTML = `
    <h3>${snippet.title}</h3>
    <div class="video-meta-info">
      <div class="video-meta-channel">
        ${channelThumb ? `<img src="${channelThumb}" alt="${channelTitle}">` : ''}
        <span>${channelTitle}</span>
        ${snippet.publishedAt ? `<span style="color:var(--text3)">· ${timeAgo(snippet.publishedAt)}</span>` : ''}
      </div>
      <a href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener" class="open-yt-btn">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
        </svg>
        Op YouTube
      </a>
    </div>`;

  $('video-modal').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeVideoModal() {
  $('video-modal').classList.remove('active');
  $('video-player-wrap').innerHTML = '';
  document.body.style.overflow = '';
}

// ── Search ────────────────────────────────────────────────────
async function doSearch(query) {
  if (!query.trim()) return;
  showSearchPanel();
  const list = $('search-results-list');
  list.innerHTML = `<div class="loading-spinner"><div class="spinner"></div></div>`;

  try {
    const channels = await searchChannels(query);
    list.innerHTML = '';

    if (!channels.length) {
      list.innerHTML = '<p style="color:var(--text3);padding:20px 0">Geen kanalen gevonden.</p>';
      return;
    }

    channels.forEach(ch => {
      const thumb = ch.snippet.thumbnails?.medium?.url || ch.snippet.thumbnails?.default?.url || '';
      const subs = formatSubs(ch.statistics?.subscriberCount);
      const subscribed = isSubscribed(ch.id);

      const item = el('div', 'search-channel-item');
      item.innerHTML = `
        <img src="${thumb}" alt="${ch.snippet.title}" onerror="this.style.display='none'">
        <div class="search-channel-info">
          <div class="search-channel-name">${ch.snippet.title}</div>
          ${subs ? `<div class="search-channel-subs">${subs}</div>` : ''}
          <div class="search-channel-desc">${ch.snippet.description || ''}</div>
        </div>
        <button class="subscribe-btn ${subscribed ? 'subscribed' : ''}" data-id="${ch.id}">
          ${subscribed
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Afgemeld`
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Abonneer`
          }
        </button>
      `;

      const btn = item.querySelector('.subscribe-btn');
      btn.addEventListener('click', () => {
        if (isSubscribed(ch.id)) {
          unsubscribe(ch.id);
          btn.classList.add('subscribed');
          btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Afgemeld`;
          // toggle back
          btn.classList.remove('subscribed');
          btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Abonneer`;
        } else {
          subscribe(ch);
          btn.classList.add('subscribed');
          btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg> Geabonneerd`;
        }
      });

      list.appendChild(item);
    });
  } catch (err) {
    list.innerHTML = `<p style="color:var(--accent);padding:20px 0">Fout: ${err.message}</p>`;
  }
}

function showSearchPanel() {
  $('search-results-panel').classList.add('active');
}

function hideSearch() {
  $('search-results-panel').classList.remove('active');
}

// ── Mobile sidebar ────────────────────────────────────────────
function openSidebar() {
  $('sidebar').classList.add('open');
  $('sidebar-overlay').classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('active');
  document.body.style.overflow = '';
}

// ── Event listeners ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Nav
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(item.dataset.page);
      closeSidebar();
    });
  });

  // Search
  $('search-btn').addEventListener('click', () => doSearch($('search-input').value));
  $('search-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doSearch($('search-input').value);
  });
  $('close-search').addEventListener('click', hideSearch);

  // Modal
  $('modal-close').addEventListener('click', closeVideoModal);
  $('video-modal-bg').addEventListener('click', closeVideoModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeVideoModal();
      hideSearch();
      closeSidebar();
    }
  });

  // Mobile
  $('menu-btn').addEventListener('click', openSidebar);
  $('sidebar-overlay').addEventListener('click', closeSidebar);

  // Init
  renderSidebarChannels();
  loadHomeFeed();
  updateSubtitle();
});
