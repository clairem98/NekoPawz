// ── State ──────────────────────────────────────────────────────────────────
let currentUser = null;

// ── Config & Google Maps ───────────────────────────────────────────────────
let appConfig = {};
let googleMapsPromise = null;
let googleMapsLoaded = false;

async function initConfig() {
  try {
    appConfig = await fetch((window.API_BASE || '') + '/api/config').then(r => r.json());
    if (appConfig.mapsKey) {
      // Start loading Maps in background so it's ready when registration opens
      googleMapsPromise = new Promise((resolve, reject) => {
        window.__googleMapsReady = () => { googleMapsLoaded = true; resolve(); };
        const s = document.createElement('script');
        s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(appConfig.mapsKey)}&libraries=places&callback=__googleMapsReady`;
        s.onerror = reject;
        document.head.appendChild(s);
      });
      googleMapsPromise.catch(() => {}); // suppress unhandled-rejection if Maps fails
    }
  } catch {}
}

async function waitForGoogleMaps() {
  if (googleMapsLoaded) return true;
  if (!googleMapsPromise) return false;
  try { await googleMapsPromise; return true; }
  catch { return false; }
}
let currentPage = 'landing';
let browseTypeFilter = 'all';
let browseDateFilter = 'all';
let browseLocationFilter = 'building'; // 'building' or a miles string like '0.5'
let myRequestsTab = 'posted';

// ── Avatar helper ──────────────────────────────────────────────────────────
function avatarHtml(name, avatarUrl, cls = 'neighbor-avatar') {
  if (avatarUrl) {
    // Cloudinary / absolute URLs must NOT have API_BASE prepended
    const src = avatarUrl.startsWith('http') ? avatarUrl : (window.API_BASE || '') + avatarUrl;
    return `<img src="${src}" class="${cls} ${cls}-img" alt="${name || ''}" />`;
  }
  return `<div class="${cls}">${name ? name[0].toUpperCase() : '?'}</div>`;
}

// ── API helper ─────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  const fbUser = firebase.auth().currentUser;
  if (fbUser) headers['Authorization'] = `Bearer ${await fbUser.getIdToken()}`;
  const res = await fetch((window.API_BASE || '') + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data;
  try {
    data = await res.json();
  } catch {
    // Server returned HTML (502 gateway, deploy restart, etc.) instead of JSON
    throw new Error(`Server unavailable (${res.status}). Please try again in a moment.`);
  }
  if (!res.ok) {
    const err = new Error(data?.error || 'Request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

// ── Router ─────────────────────────────────────────────────────────────────
function navigate(page, param) {
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const el = document.getElementById(`page-${page}`);
  if (el) el.classList.remove('hidden');
  currentPage = page;
  window.scrollTo(0, 0);

  document.querySelectorAll('.nav-links a').forEach(a => {
    a.classList.toggle('active', a.dataset.page === page);
  });

  if (page === 'dashboard') loadDashboard();
  else if (page === 'browse') loadBrowse();
  else if (page === 'messages') loadMessages();
  else if (page === 'new-request') loadNewRequestPage(param || null);
  else if (page === 'profile') loadProfile();
  else if (page === 'neighbors') loadNeighbors();
  else if (page === 'my-requests') loadMyRequests();
  else if (page === 'request-detail') loadRequestDetail(param);
  else if (page === 'user-profile') loadUserProfile(param);
  else if (page === 'settings') loadSettings();
  else if (page === 'contact') loadContact();
}

// ── Auth ───────────────────────────────────────────────────────────────────
// Prevents onAuthStateChanged from interfering while a sign-in flow is active
let authFlowActive = false;

// Cache user profile in localStorage so returning users see the app instantly
function cacheUser(user) {
  try { localStorage.setItem('neko_user', JSON.stringify(user)); } catch {}
}
function getCachedUser() {
  try { return JSON.parse(localStorage.getItem('neko_user')); } catch { return null; }
}
function clearCachedUser() {
  try { localStorage.removeItem('neko_user'); } catch {}
}

function checkAuth() {
  // If we have a cached user, show the app immediately — don't wait for the network
  const cached = getCachedUser();
  if (cached) {
    currentUser = cached;
    showApp();
    navigate('dashboard');
  }

  firebase.auth().onAuthStateChanged(async fbUser => {
    if (authFlowActive) return;
    if (fbUser) {
      try {
        const fresh = await api('GET', '/api/me');
        currentUser = fresh;
        cacheUser(fresh);
        // If we didn't already show the app from cache, show it now
        if (!cached) { showApp(); navigate('dashboard'); }
        else { updateNavCredits(); } // refresh credits/name in case they changed
      } catch (e) {
        if (!e.status || e.status === 401) { clearCachedUser(); showLanding(); }
        // For transient errors leave the cached view visible — don't boot the user
      }
    } else {
      clearCachedUser();
      if (!cached) showLanding(); // already showing landing, nothing to do
      else showLanding(); // was showing cached app but Firebase says no session
    }
  });
}

function showApp() {
  document.getElementById('navbar').classList.remove('hidden');
  updateNavCredits();
  pollNotifications();
  setInterval(pollNotifications, 30000);
}

// ── Notifications Bell ─────────────────────────────────────────────────────
async function pollNotifications() {
  try {
    const [{ unread }, supportMsgs] = await Promise.all([
      api('GET', '/api/notifications'),
      api('GET', '/api/support-messages').catch(() => []),
    ]);
    const supportUnread = Array.isArray(supportMsgs) ? supportMsgs.filter(m => !m.read).length : 0;
    const totalUnread = unread + supportUnread;
    const badge = document.getElementById('bell-badge');
    if (totalUnread > 0) {
      badge.textContent = totalUnread > 9 ? '9+' : totalUnread;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch {}
}

// ── Support Messages ───────────────────────────────────────────────────────
async function loadSupportMessages() {
  const section = document.getElementById('support-messages-section');
  const list = document.getElementById('support-messages-list');
  if (!section || !list) return;
  try {
    const msgs = await api('GET', '/api/support-messages');
    if (!msgs || !msgs.length) {
      section.style.display = 'none';
      return;
    }
    section.style.display = 'block';
    list.innerHTML = msgs.map(m => `
      <div id="smsg-${m.id}" class="bell-item${m.read ? '' : ' unread'}" style="${m.read ? '' : 'background:#f0faf4;'}">
        <div class="bell-item-icon">✉️</div>
        <div class="bell-item-text" style="flex:1">
          <div class="bell-item-title" style="font-weight:${m.read ? '400' : '600'}">${escHtml(m.subject)}</div>
          <div class="bell-item-body">${escHtml(m.body)}</div>
          <div class="bell-item-time">${timeAgo(m.created_at)}</div>
          ${!m.read ? `<button onclick="markSupportMessageRead('${m.id}')" style="margin-top:4px;font-size:11px;padding:2px 8px;border:1px solid var(--green-accent,#40916c);background:transparent;color:var(--green-accent,#40916c);border-radius:4px;cursor:pointer;">Mark as read</button>` : ''}
        </div>
      </div>
    `).join('');
  } catch {
    section.style.display = 'none';
  }
}

async function markSupportMessageRead(id) {
  try {
    await api('PUT', `/api/support-messages/${id}/read`);
    await loadSupportMessages();
    await pollNotifications();
  } catch {}
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.getElementById('bell-btn').addEventListener('click', async () => {
  const dropdown = document.getElementById('bell-dropdown');
  if (!dropdown.classList.contains('hidden')) {
    dropdown.classList.add('hidden');
    return;
  }
  try {
    const { notifications } = await api('GET', '/api/notifications');
    await api('POST', '/api/notifications/read-all');
    // Rebuild the notification items area (leave support-messages-section intact)
    const section = document.getElementById('support-messages-section');
    // Remove existing notif items (everything before the support section)
    Array.from(dropdown.childNodes).forEach(n => {
      if (n !== section) n.parentNode && n.parentNode.removeChild(n);
    });
    const notifContainer = document.createElement('div');
    if (!notifications.length) {
      notifContainer.innerHTML = '<div class="bell-empty">No notifications yet</div>';
    } else {
      notifContainer.innerHTML = notifications.slice(0, 10).map(n => `
        <div class="bell-item ${n.read ? '' : 'unread'}" ${n.request_id ? `onclick="navigate('request-detail','${n.request_id}');document.getElementById('bell-dropdown').classList.add('hidden')"` : ''}>
          <div class="bell-item-icon">${notifIcon(n.type)}</div>
          <div class="bell-item-text">
            <div class="bell-item-title">${n.title}</div>
            <div class="bell-item-body">${n.body}</div>
            <div class="bell-item-time">${timeAgo(n.created_at)}</div>
          </div>
        </div>
      `).join('');
    }
    dropdown.insertBefore(notifContainer, section);
    // Load support messages into the section
    await loadSupportMessages();
    // Update badge (support messages not yet read are still unread at this point)
    await pollNotifications();
    dropdown.classList.remove('hidden');
  } catch {}
});

document.addEventListener('click', e => {
  if (!e.target.closest('.nav-bell')) {
    document.getElementById('bell-dropdown')?.classList.add('hidden');
  }
});

function notifIcon(type) {
  return { message: '💬', accepted: '✅', completed: '🎉', reminder: '⏰' }[type] || '🔔';
}

function timeAgo(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function showLanding() {
  document.getElementById('navbar').classList.add('hidden');
  navigate('landing');
}

function updateNavCredits() {
  if (currentUser) {
    document.getElementById('nav-credits').textContent = `${currentUser.credits} credits`;
  }
}

// ── Dashboard ──────────────────────────────────────────────────────────────
async function loadDashboard() {
  const firstName = currentUser.name.split(' ')[0];
  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const greeting = document.getElementById('dashboard-greeting');
  greeting.innerHTML = `${timeGreeting}, <span>${firstName}</span> 👋`;
  document.getElementById('credits-num').textContent = currentUser.credits;

  // Activity
  try {
    const activity = await api('GET', '/api/activity');
    const list = document.getElementById('activity-list');
    if (!activity.length) {
      list.innerHTML = `
        <div class="dash-empty-activity">
          <p>No activity yet.</p>
          <p class="dash-empty-hint">Credits are earned by helping neighbors and spent when you receive help.</p>
          <a href="#" data-page="browse" class="dash-empty-link">Browse open requests →</a>
        </div>`;
    } else {
      list.innerHTML = activity.slice(0, 5).map(t => {
        const earned = t.to_user_id === currentUser.id;
        const other  = earned ? t.from_name : t.to_name;
        return `
          <div class="activity-item">
            <div class="activity-dot ${earned ? 'earned' : 'spent'}"></div>
            <div class="activity-text">
              <div class="activity-label">${earned ? `Helped ${other}` : `Care from ${other}`}</div>
              <div class="activity-sub">${t.request_title || ''} · ${timeAgo(t.created_at)}</div>
            </div>
            <div class="activity-credit ${earned ? 'earned' : 'spent'}">${earned ? '+' : '−'}${t.credits} cr</div>
          </div>`;
      }).join('');
    }
  } catch {}

  // Reminders + onboarding banner
  const remindersEl = document.getElementById('dashboard-reminders');
  if (remindersEl) {
    // Upcoming sits
    try {
      const upcoming = await api('GET', '/api/upcoming');
      if (upcoming.length && currentUser.notif_reminders !== 0) {
        remindersEl.innerHTML = upcoming.map(r => {
          const isHelper = r.helper_id === currentUser.id;
          const label = isHelper ? `You're helping with "${r.title}"` : `"${r.title}" is coming up`;
          return `<div class="reminder-item" onclick="navigate('request-detail','${r.id}')">
            ⏰ <strong>${label}</strong> — ${formatRequestDate(r.date)}${r.time_window ? ', ' + r.time_window : ''}
          </div>`;
        }).join('');
        return; // Skip onboarding if there are real reminders
      }
    } catch {}

    // Onboarding checklist for new users
    const hasActivity   = currentUser.credits > 1;
    const hasPets       = currentUser.pets?.length > 0;
    const hasProfilePic = !!currentUser.avatar_url;
    if (!hasActivity && !hasPets && !hasProfilePic) {
      remindersEl.innerHTML = `
        <div class="onboarding-card">
          <div class="onboarding-title">👋 Welcome to NekoPawz! Here's how to get started:</div>
          <div class="onboarding-steps">
            <div class="ob-step ${hasProfilePic ? 'ob-done' : ''}">
              <span class="ob-check">${hasProfilePic ? '✓' : '1'}</span>
              <div class="ob-body">
                <strong>Set up your profile</strong>
                <span>Add a photo so neighbors recognize you</span>
              </div>
              ${!hasProfilePic ? `<button class="btn-outline btn-sm" onclick="navigate('profile')">Go →</button>` : ''}
            </div>
            <div class="ob-step ${hasPets ? 'ob-done' : ''}">
              <span class="ob-check">${hasPets ? '✓' : '2'}</span>
              <div class="ob-body">
                <strong>Add your pet</strong>
                <span>Helpers want to know who they'll be caring for</span>
              </div>
              ${!hasPets ? `<button class="btn-outline btn-sm" onclick="navigate('profile')">Add pet →</button>` : ''}
            </div>
            <div class="ob-step">
              <span class="ob-check">3</span>
              <div class="ob-body">
                <strong>Help a neighbor first</strong>
                <span>Earn a credit, then post your own request</span>
              </div>
              <button class="btn-outline btn-sm" data-page="browse">Browse →</button>
            </div>
          </div>
        </div>`;
    }
  }

  // Open requests nearby
  try {
    const requests = await api('GET', '/api/requests?status=open');
    const grid = document.getElementById('dashboard-requests');
    if (!requests.length) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">🏘️</div>
          <h3>No open requests nearby</h3>
          <p>Your neighbors haven't posted any requests yet. Be the first to help — or post your own request and see who volunteers.</p>
          <div class="es-actions">
            <button class="btn-primary" data-page="new-request">Post a request</button>
            <button class="btn-outline" data-page="neighbors">Meet your neighbors</button>
          </div>
        </div>`;
    } else {
      grid.innerHTML = requests.slice(0, 6).map(r => requestCard(r)).join('');
    }
  } catch {}
}

// ── Browse ─────────────────────────────────────────────────────────────────
function dateFilterMatch(dateStr, filter) {
  if (filter === 'all') return true;
  const today = new Date(); today.setHours(0,0,0,0);
  const d = new Date(dateStr + 'T00:00:00');
  if (filter === 'today') return d.getTime() === today.getTime();
  if (filter === 'tomorrow') {
    const tom = new Date(today); tom.setDate(tom.getDate() + 1);
    return d.getTime() === tom.getTime();
  }
  if (filter === 'week') {
    const end = new Date(today); end.setDate(end.getDate() + 7);
    return d >= today && d <= end;
  }
  if (filter === 'weekend') {
    // next Saturday and Sunday
    const day = today.getDay(); // 0=Sun,6=Sat
    const daysToSat = (6 - day + 7) % 7 || 7;
    const sat = new Date(today); sat.setDate(today.getDate() + daysToSat);
    const sun = new Date(sat); sun.setDate(sat.getDate() + 1);
    return d.getTime() === sat.getTime() || d.getTime() === sun.getTime();
  }
  return true;
}

async function loadBrowse() {
  try {
    const radiusParam = browseLocationFilter !== 'building' ? `&radius=${browseLocationFilter}` : '';
    const requests = await api('GET', `/api/requests?status=open${radiusParam}`);
    let filtered = requests;
    if (browseTypeFilter !== 'all') filtered = filtered.filter(r => r.type === browseTypeFilter);
    filtered = filtered.filter(r => dateFilterMatch(r.date, browseDateFilter));

    const grid = document.getElementById('browse-requests');
    const countEl = document.getElementById('browse-count');
    if (!filtered.length) {
      countEl.textContent = '';
      grid.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">🔍</div>
          <h3>No requests match these filters</h3>
          <p>Try expanding your distance filter or checking back later. You can also be the first to post a request!</p>
          <div class="es-actions">
            <button class="btn-primary" data-page="new-request">Post a request</button>
            <button class="btn-outline" onclick="browseLocationFilter='1';loadBrowse()">Widen to 1 mile</button>
          </div>
        </div>`;
    } else {
      countEl.textContent = `${filtered.length} request${filtered.length !== 1 ? 's' : ''} found`;
      grid.innerHTML = filtered.map(r => requestCard(r)).join('');
    }
  } catch (e) {
    document.getElementById('browse-requests').innerHTML = `<p class="error-msg">${e.message}</p>`;
  }
}

// ── New Request Page ───────────────────────────────────────────────────────
async function loadNewRequestPage(directedTo = null) {
  const me = await api('GET', '/api/me');
  currentUser = me;
  document.getElementById('hint-credits').textContent = me.credits;

  // Pet checkboxes
  const petsList = document.getElementById('req-pets-list');
  if (me.pets && me.pets.length) {
    petsList.innerHTML = me.pets.map(p => `
      <label class="pet-checkbox">
        <input type="checkbox" name="req-pet-ids" value="${p.id}" />
        <span class="pet-checkbox-label">${petEmoji(p.type)} ${p.name}</span>
      </label>
    `).join('');
  } else {
    petsList.innerHTML = `<p style="font-size:.85rem;color:var(--text-muted)">No pets added yet. <a href="#" onclick="navigate('profile');return false">Add a pet</a> first.</p>`;
  }

  document.getElementById('req-date').min = new Date().toISOString().split('T')[0];

  // Load neighbors for the picker
  try {
    const neighbors = await api('GET', '/api/neighbors');
    const pickerList = document.getElementById('neighbor-picker-list');
    if (neighbors.length) {
      pickerList.innerHTML = neighbors.map(n => `
        <button type="button" class="neighbor-pick-item" onclick="setRecipient('${n.id}','${n.name.replace(/'/g,"\\'")}','${(n.building||'').replace(/'/g,"\\'")}')">
          <span class="neighbor-pick-avatar">${n.name[0].toUpperCase()}</span>
          <span class="neighbor-pick-info">
            <span class="neighbor-pick-name">${n.name}</span>
            <span class="neighbor-pick-sub">${n.sameBuilding ? 'In your building' : 'Nearby'}</span>
          </span>
        </button>
      `).join('');
    } else {
      pickerList.innerHTML = '<p class="picker-empty">No neighbors found nearby.</p>';
    }
  } catch {}

  // Set recipient from directedTo param
  if (directedTo) {
    try {
      const sitter = await api('GET', `/api/users/${directedTo}`);
      setRecipient(sitter.id, sitter.name, sitter.building);
    } catch {}
  } else {
    setRecipient(null);
  }

  // Credits stepper
  const hidden = document.getElementById('req-credits');
  const display = document.getElementById('req-credits-display');
  document.getElementById('credits-minus').onclick = () => {
    const v = Math.max(1, parseInt(hidden.value) - 1);
    hidden.value = v; display.textContent = v;
  };
  document.getElementById('credits-plus').onclick = () => {
    const v = Math.min(me.credits, parseInt(hidden.value) + 1);
    hidden.value = v; display.textContent = v;
  };
}

// ── Date helpers ───────────────────────────────────────────────────────────
// "2025-04-18" → "Fri, Apr 18"
function formatRequestDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  const today = new Date(); today.setHours(0,0,0,0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  if (d.getTime() === today.getTime())    return 'Today';
  if (d.getTime() === tomorrow.getTime()) return 'Tomorrow';
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// ── Profile ────────────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

async function loadProfile() {
  // Show loading placeholder so the card never looks blank
  const hero = document.getElementById('profile-hero');
  if (hero) hero.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted)">Loading…</div>';
  try {
    const [me, activity] = await Promise.all([
      api('GET', '/api/me'),
      api('GET', '/api/activity')
    ]);
    currentUser = me;
    updateNavCredits();

    // ── Hero ────────────────────────────────────────────────────────────
    document.getElementById('profile-hero').innerHTML = `
      <button class="profile-hero-avatar-btn" onclick="openEditProfileModal()"
              title="Edit profile" aria-label="Edit profile">
        ${avatarHtml(me.name, me.avatar_url, 'profile-hero-avatar')}
        <span class="profile-hero-camera">📷</span>
      </button>
      <div class="profile-hero-info">
        <h2 class="profile-hero-name">${me.name}</h2>
        <p class="profile-hero-sub">
          ${[me.unit ? 'Unit ' + me.unit : '', me.building_name || me.building].filter(Boolean).join(' · ')}
        </p>
        ${me.bio
          ? `<p class="profile-hero-bio">${me.bio}</p>`
          : `<button class="profile-hero-bio-prompt" onclick="openEditProfileModal()">+ Add a bio</button>`}
      </div>
      <button class="btn-outline btn-sm profile-hero-edit-btn" onclick="openEditProfileModal()">Edit profile</button>
    `;

    // ── Stats strip ─────────────────────────────────────────────────────
    const earned = activity.filter(t => t.to_user_id   === me.id).reduce((s, t) => s + t.credits, 0);
    const spent  = activity.filter(t => t.from_user_id === me.id).reduce((s, t) => s + t.credits, 0);
    document.getElementById('profile-stats').innerHTML = `
      <div class="ps-stat">
        <div class="ps-num">${me.credits}</div>
        <div class="ps-label">available</div>
      </div>
      <div class="ps-divider"></div>
      <div class="ps-stat">
        <div class="ps-num ps-earned">+${earned}</div>
        <div class="ps-label">earned</div>
      </div>
      <div class="ps-divider"></div>
      <div class="ps-stat">
        <div class="ps-num ps-spent">−${spent}</div>
        <div class="ps-label">spent</div>
      </div>
    `;

    // ── Credit history ───────────────────────────────────────────────────
    const histEl = document.getElementById('profile-credit-history');
    if (!activity.length) {
      histEl.innerHTML = `
        <div class="ch-empty">
          <div class="ch-empty-icon">🐾</div>
          <p>No credit history yet.</p>
          <p style="font-size:.82rem;color:var(--text-muted);margin-top:4px">Credits appear here when you give or receive help.</p>
        </div>`;
    } else {
      histEl.innerHTML = `
        <div class="credit-history-list">
          ${activity.map(t => {
            const isEarned = t.to_user_id === me.id;
            const other    = isEarned ? t.from_name : t.to_name;
            const label    = isEarned ? `Helped ${other}` : `Care from ${other}`;
            const icon     = isEarned ? petEmoji(t.request_type || 'other') : '🐾';
            const dateStr  = formatDate(t.created_at);
            const agoStr   = timeAgo(t.created_at);
            return `
              <div class="ch-item">
                <div class="ch-icon ${isEarned ? 'ch-icon--earned' : 'ch-icon--spent'}">${icon}</div>
                <div class="ch-body">
                  <div class="ch-label">${label}</div>
                  ${t.request_title ? `<div class="ch-sub">${t.request_title}</div>` : ''}
                  <div class="ch-date"><span class="ch-date-full">${dateStr}</span><span class="ch-date-ago">${agoStr}</span></div>
                </div>
                <div class="ch-badge ${isEarned ? 'ch-earned' : 'ch-spent'}">
                  ${isEarned ? '+' : '−'}${t.credits} cr
                </div>
              </div>
            `;
          }).join('')}
        </div>
      `;
    }

    renderPets(me.pets);
  } catch (e) {
    console.error('loadProfile error:', e);
    const h = document.getElementById('profile-hero');
    if (h) h.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-muted)">Couldn't load profile — ${e.message}. <button class="btn-outline btn-sm" onclick="loadProfile()" style="margin-top:8px">Retry</button></div>`;
  }
}

// ── Profile edit modal ──────────────────────────────────────────────────────
function openEditProfileModal() {
  const me = currentUser || {};
  openModal(`
    <h3 style="margin:0 0 18px">Edit Profile</h3>
    <div style="display:flex;flex-direction:column;align-items:center;margin-bottom:20px">
      <div class="profile-avatar-edit-tap" id="profile-edit-avatar-wrap"
           onclick="document.getElementById('profile-edit-photo-input').click()" title="Change photo">
        ${avatarHtml(me.name, me.avatar_url, 'profile-avatar')}
        <span class="profile-avatar-edit-overlay">📷</span>
      </div>
      <input type="file" id="profile-edit-photo-input"
             accept="image/jpeg,image/png,image/gif,image/webp"
             style="display:none" onchange="uploadAvatarFromModal(this)" />
      <p style="font-size:.76rem;color:var(--text-muted);margin-top:6px">Tap to change photo</p>
    </div>
    <div class="form-row">
      <label>Name</label>
      <input type="text" id="profile-edit-name" value="${me.name || ''}" />
    </div>
    <div class="form-row">
      <label>Bio</label>
      <textarea id="profile-edit-bio" rows="3" placeholder="Tell neighbors a little about yourself…">${me.bio || ''}</textarea>
    </div>
    <div id="profile-edit-error" class="error-msg hidden"></div>
    <div style="display:flex;gap:10px;margin-top:20px">
      <button class="btn-outline" style="flex:1" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" style="flex:2" onclick="saveProfileEdit()">Save changes</button>
    </div>
  `);
}

async function uploadAvatarFromModal(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { alert('Image must be under 8 MB'); input.value = ''; return; }
  const formData = new FormData();
  formData.append('avatar', file);
  const fbUser = firebase.auth().currentUser;
  const headers = {};
  if (fbUser) headers['Authorization'] = `Bearer ${await fbUser.getIdToken()}`;
  try {
    const res = await fetch((window.API_BASE || '') + '/api/avatar', { method: 'POST', headers, body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    currentUser.avatar_url = data.avatar_url;
    // Swap avatar inside modal
    const wrap = document.getElementById('profile-edit-avatar-wrap');
    if (wrap) wrap.innerHTML = avatarHtml(currentUser.name, data.avatar_url, 'profile-avatar') +
      `<span class="profile-avatar-edit-overlay">📷</span>`;
  } catch (e) { alert('Upload failed: ' + e.message); }
}

async function saveProfileEdit() {
  const name = document.getElementById('profile-edit-name')?.value?.trim();
  const bio  = document.getElementById('profile-edit-bio')?.value?.trim();
  const err  = document.getElementById('profile-edit-error');
  if (!name) { err.textContent = 'Name is required'; err.classList.remove('hidden'); return; }
  try {
    await api('PUT', '/api/settings', { name, bio });
    closeModal();
    loadProfile();
  } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); }
}

function renderPets(pets) {
  const list = document.getElementById('pets-list');
  if (!pets.length) {
    list.innerHTML = `
      <div class="pets-empty">
        <div class="pets-empty-icon">🐾</div>
        <p>No pets added yet.</p>
        <p style="font-size:.82rem;color:var(--text-muted);margin-top:4px">Add your pet so neighbors know who they'll be caring for.</p>
      </div>`;
    return;
  }
  list.innerHTML = `<div class="pet-card-grid">${pets.map(p => `
    <div class="pet-card" id="pet-item-${p.id}">
      <div class="pet-card-photo-wrap">
        ${p.photo_url
          ? `<img src="${p.photo_url}" class="pet-card-photo" alt="${p.name}" />`
          : `<div class="pet-card-photo pet-card-photo--placeholder">${petEmoji(p.type)}</div>`}
        <label class="pet-card-camera" title="Change photo" for="pet-photo-${p.id}">📷</label>
        <input type="file" id="pet-photo-${p.id}" accept="image/jpeg,image/png,image/gif,image/webp"
          style="display:none" onchange="uploadPetPhoto('${p.id}', this)" />
      </div>
      <div class="pet-card-body">
        <div class="pet-card-name">${p.name}</div>
        <div class="pet-card-desc">${[p.type, p.breed, p.age ? p.age + ' yrs' : ''].filter(Boolean).join(' · ')}</div>
        ${p.notes ? `<div class="pet-card-notes">${p.notes}</div>` : ''}
      </div>
      <button class="pet-card-delete" onclick="deletePet('${p.id}')" title="Remove pet">✕</button>
    </div>
  `).join('')}</div>`;
}

async function uploadPetPhoto(petId, input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { alert('Image must be under 8 MB'); input.value = ''; return; }
  const formData = new FormData();
  formData.append('photo', file);
  const headers = {};
  const fbUser = firebase.auth().currentUser;
  if (fbUser) headers['Authorization'] = `Bearer ${await fbUser.getIdToken()}`;
  try {
    const res = await fetch((window.API_BASE || '') + `/api/pets/${petId}/photo`, { method: 'POST', headers, body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    // Update photo in-place without full re-render
    const wrap = document.querySelector(`#pet-item-${petId} .pet-card-photo-wrap`);
    if (wrap) {
      const existing = wrap.querySelector('.pet-card-photo');
      if (existing) {
        if (existing.tagName === 'IMG') {
          existing.src = data.photo_url;
        } else {
          // Replace placeholder div with an img
          const img = document.createElement('img');
          img.src = data.photo_url;
          img.className = 'pet-card-photo';
          img.alt = existing.textContent;
          existing.replaceWith(img);
        }
      }
    }
    currentUser = await api('GET', '/api/me'); cacheUser(currentUser);
  } catch (e) { alert('Upload failed: ' + e.message); }
}

async function deletePet(id) {
  if (!confirm('Remove this pet?')) return;
  try {
    await api('DELETE', `/api/pets/${id}`);
    const me = await api('GET', '/api/me');
    currentUser = me;
    renderPets(me.pets);
  } catch (e) { alert(e.message); }
}

// ── Neighbors ──────────────────────────────────────────────────────────────
// ── Messages inbox ────────────────────────────────────────────────────────
async function loadMessages() {
  const list = document.getElementById('messages-list');
  list.innerHTML = '<div class="loading">Loading…</div>';
  try {
    const convos = await api('GET', '/api/conversations');
    if (!convos.length) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">💬</div>
          <h3>No messages yet</h3>
          <p>Conversations appear here once a request is accepted — either yours or one you've volunteered to help with. Messages let you coordinate keys, timing, and pet details.</p>
          <div class="es-actions">
            <button class="btn-primary" data-page="browse">Volunteer to help</button>
            <button class="btn-outline" data-page="new-request">Post a request</button>
          </div>
        </div>`;
      return;
    }
    const statusLabels = { open: 'Open', accepted: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };
    list.innerHTML = convos.map(c => {
      const otherName = c.requester_id === currentUser.id ? (c.helper_name || 'Helper') : c.requester_name;
      const firstName = (otherName || '?').split(' ')[0];
      const isMine  = c.last_sender_id === currentUser.id;
      const preview = c.last_message ? (isMine ? `You: ${c.last_message}` : c.last_message) : 'No messages yet — say hello!';
      const unread  = !isMine && c.unread_count > 0;
      return `
        <div class="convo-item ${unread ? 'convo-unread' : ''}" onclick="navigate('request-detail','${c.id}')">
          <div class="convo-avatar">${firstName[0].toUpperCase()}</div>
          <div class="convo-body">
            <div class="convo-top">
              <span class="convo-name">${firstName}</span>
              <span class="convo-time">${c.last_message_at ? timeAgo(c.last_message_at) : ''}</span>
            </div>
            <div class="convo-title">${typeLabel(c.type)} · ${c.title}</div>
            <div class="convo-preview">${preview}</div>
          </div>
          <div class="convo-right">
            <span class="req-status status-${c.status}">${statusLabels[c.status] || c.status}</span>
            ${unread ? `<span class="convo-unread-dot"></span>` : ''}
          </div>
        </div>
      `;
    }).join('');
  } catch (e) {
    list.innerHTML = `<p class="error-msg">${e.message}</p>`;
  }
}

async function loadNeighbors() {
  try {
    const neighbors = await api('GET', '/api/neighbors');
    const grid = document.getElementById('neighbors-grid');
    if (!neighbors.length) {
      grid.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">🏘️</div>
          <h3>No neighbors yet</h3>
          <p>You're one of the first NekoPawz members in your area! Share the link with neighbors to grow your community. The more neighbors join, the more help you can all give and receive.</p>
          <div class="es-actions">
            <button class="btn-primary" onclick="navigator.clipboard.writeText('https://www.nekopawz.com').then(()=>this.textContent='✓ Copied!').catch(()=>{})">Copy invite link</button>
          </div>
        </div>`;
      return;
    }
    grid.innerHTML = neighbors.map(n => {
      const firstName = n.name.split(' ')[0];
      const locationLabel = n.sameBuilding ? 'In your building' : (n.distanceMiles != null ? `${n.distanceMiles.toFixed(1)} mi away` : 'Nearby');
      return `
        <div class="neighbor-card">
          <div class="neighbor-header" onclick="navigate('user-profile','${n.id}')" style="cursor:pointer">
            ${avatarHtml(n.name, n.avatar_url, 'neighbor-avatar')}
            <div>
              <div class="neighbor-name">${firstName}</div>
              <div class="neighbor-unit">${locationLabel}</div>
            </div>
          </div>
          ${n.pets_summary ? `<div class="neighbor-pets">🐾 ${n.pets_summary}</div>` : ''}
          <button class="btn-outline btn-sm" onclick="navigate('new-request','${n.id}')">Request ${firstName}</button>
        </div>
      `;
    }).join('');
  } catch {}
}

// ── My Requests ────────────────────────────────────────────────────────────
async function loadMyRequests() {
  const list = document.getElementById('my-requests-list');
  if (list) list.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted)">Loading…</div>';
  try {
    const url = myRequestsTab === 'posted' ? '/api/requests?mine=true' : '/api/requests?helping=true';
    const requests = await api('GET', url);
    if (!requests.length) {
      const isPosted = myRequestsTab === 'posted';
      list.innerHTML = `
        <div class="empty-state">
          <div class="es-icon">${isPosted ? '📋' : '🤝'}</div>
          <h3>${isPosted ? "You haven't posted any requests yet" : "You haven't helped anyone yet"}</h3>
          <p>${isPosted
            ? "Post a request when you need help with your pet — dog walks, cat check-ins, or anything else. You'll be matched with a neighbor who volunteers."
            : "Browse open requests nearby and volunteer to help. When a neighbor accepts you, the request moves here and you can message each other."}</p>
          <div class="es-actions">
            <button class="btn-primary" data-page="${isPosted ? 'new-request' : 'browse'}">${isPosted ? 'Post a request' : 'Browse requests'}</button>
          </div>
        </div>`;
    } else {
      list.innerHTML = requests.map(r => requestCard(r, true)).join('');
    }
  } catch (e) {
    if (list) list.innerHTML = `<div class="error-msg">Couldn't load requests — ${e.message}. <button class="btn-ghost btn-sm" onclick="loadMyRequests()">Retry</button></div>`;
  }
}

// ── Request Detail ─────────────────────────────────────────────────────────
async function loadRequestDetail(id) {
  const el = document.getElementById('request-detail-content');
  if (el) el.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted)">Loading…</div>';
  try {
    const r = await api('GET', `/api/requests/${id}`);
    const el = document.getElementById('request-detail-content');
    const isRequester = r.requester_id === currentUser.id;
    const isHelper = r.helper_id === currentUser.id;

    let actions = '';
    if (r.status === 'open' && !isRequester) {
      if (r.myApplication === 'pending') {
        actions += `<span class="apply-pending">Application sent — waiting for approval</span>`;
      } else if (r.myApplication === 'declined') {
        actions += `<span class="apply-declined">Your application was not selected for this request</span>`;
      } else if (!r.myApplication) {
        actions += `<button class="btn-primary" onclick="applyRequest('${r.id}')">Volunteer to help</button>`;
      }
    }
    if (r.status === 'open' && isRequester) {
      if (r.applications && r.applications.length) {
        actions += `<div class="applicants-section"><h3>Volunteers (${r.applications.length})</h3>${
          r.applications.map(a => {
            const starsHtml = a.avg_rating
              ? Array.from({length:5},(_,i)=>`<span class="star ${i<Math.round(a.avg_rating)?'active':''}">★</span>`).join('')
              : '';
            return `<div class="applicant-card">
              <div class="applicant-info">
                <div class="mini-avatar">${a.name[0].toUpperCase()}</div>
                <div>
                  <div class="applicant-name"><a href="#" onclick="navigate('user-profile','${a.id}');return false">${a.name}</a></div>
                  <div class="applicant-rating">${a.avg_rating ? `<div class="stars">${starsHtml}</div> <span>${a.avg_rating} (${a.review_count})</span>` : '<span style="color:var(--text-muted);font-size:.8rem">No ratings yet</span>'}</div>
                  <div class="applicant-distance">${a.sameBuilding ? 'In your building' : (a.distanceLabel ? a.distanceLabel + ' away' : '')}</div>
                </div>
              </div>
              <div class="applicant-actions">
                <button class="btn-primary btn-sm-inline" onclick="approveApplicant('${r.id}','${a.id}')">Approve</button>
                <button class="btn-ghost btn-sm-inline" onclick="declineApplicant('${r.id}','${a.id}')">Decline</button>
              </div>
            </div>`;
          }).join('')
        }</div>`;
      } else {
        actions += `<p class="no-volunteers">No volunteers yet — your request is visible to neighbors.</p>`;
      }
    }
    if (r.status === 'accepted' && isRequester) {
      actions += `<button class="btn-primary" onclick="completeRequest('${r.id}')">Mark as completed</button>`;
    }
    if (r.status === 'completed' && isRequester) {
      if (r.alreadyReviewed) {
        const stars = '★'.repeat(r.alreadyReviewed) + '☆'.repeat(5 - r.alreadyReviewed);
        actions += `<span class="review-done">${stars} You rated this sitter</span>`;
      } else {
        actions += `<button class="btn-outline" onclick="openReviewModal('${r.id}','${r.helper_id}','${(r.helper_name||'').replace(/'/g,"\\'")}')">⭐ Rate your sitter</button>`;
      }
    }
    if (['open', 'accepted'].includes(r.status) && isRequester) {
      actions += `<button class="btn-ghost" onclick="cancelRequest('${r.id}')">Cancel request</button>`;
    }

    // Unit/address is only revealed once a visit is confirmed (accepted or beyond)
    const isInvolved = isRequester || isHelper;
    const confirmed = isInvolved && r.status !== 'open';
    const sameBuilding = r.requester_building === currentUser.building;
    let locationDisplay;
    if (confirmed) {
      locationDisplay = sameBuilding
        ? `Unit ${r.requester_unit} · Same building`
        : (r.requester_address || r.building);
    } else if (sameBuilding) {
      locationDisplay = `Same building <span class="location-lock" style="margin-left:6px">Unit revealed after confirmation</span>`;
    } else {
      locationDisplay = `<span class="location-hidden">📍 Nearby &nbsp;<span class="location-lock">Address revealed after confirmation</span></span>`;
    }

    el.innerHTML = `
      <a href="#" onclick="history.back();return false" style="color:var(--text-muted);font-size:.9rem">← Back</a>
      <div class="detail-header">
        <div style="display:flex;gap:8px;align-items:center;margin-top:12px">
          <span class="req-type-badge">${typeLabel(r.type)}</span>
          <span class="req-status status-${r.status}">${r.status}</span>
        </div>
        <h1>${r.title}</h1>
        <div style="font-size:.9rem;color:var(--text-muted)">
          Posted by <a href="#" onclick="navigate('user-profile','${r.requester_id}');return false">${r.requester_name}</a>
          · ${locationDisplay}
        </div>
      </div>
      <div class="detail-section">
        <h3>Details</h3>
        <div class="detail-row"><label>Date</label><span>${r.date}</span></div>
        ${r.time_window ? `<div class="detail-row"><label>Time window</label><span>${r.time_window}</span></div>` : ''}
        ${r.duration ? `<div class="detail-row"><label>Duration</label><span>${r.duration}</span></div>` : ''}
        <div class="detail-row"><label>Credits</label><span style="font-weight:700;color:var(--amber)">${r.credits} credit${r.credits !== 1 ? 's' : ''}</span></div>
        ${r.description ? `<div class="detail-row"><label>Notes</label><span>${r.description}</span></div>` : ''}
      </div>
      ${(r.pets && r.pets.length) ? `
        <div class="detail-section">
          <h3>Pet${r.pets.length > 1 ? 's' : ''}</h3>
          ${r.pets.map(p => `
            <div class="detail-row"><label>${p.name}</label><span>${petEmoji(p.type)} ${p.type}${p.breed ? ` · ${p.breed}` : ''}${p.notes ? ` · ${p.notes}` : ''}</span></div>
          `).join('')}
        </div>
      ` : r.pet_name ? `
        <div class="detail-section">
          <h3>Pet</h3>
          <div class="detail-row"><label>Name</label><span>${petEmoji(r.pet_type)} ${r.pet_name}</span></div>
          ${r.pet_breed ? `<div class="detail-row"><label>Breed</label><span>${r.pet_breed}</span></div>` : ''}
          ${r.pet_notes ? `<div class="detail-row"><label>Notes</label><span>${r.pet_notes}</span></div>` : ''}
        </div>
      ` : ''}
      ${r.helper_id ? `
        <div class="detail-section">
          <h3>Helper</h3>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
            <div class="mini-avatar">${(r.helper_name||'?')[0].toUpperCase()}</div>
            <div>
              <div style="font-weight:600">${r.helper_name || 'Helper'}</div>
              ${r.helper_avg_rating ? `<div class="stars" style="font-size:.9rem">${Array.from({length:5},(_,i)=>`<span class="star ${i<Math.round(r.helper_avg_rating)?'active':''}">★</span>`).join('')} <span style="color:var(--text-muted);font-size:.8rem">${r.helper_avg_rating} (${r.helper_review_count})</span></div>` : '<div style="font-size:.8rem;color:var(--text-muted)">No ratings yet</div>'}
            </div>
          </div>
          <a href="#" onclick="navigate('user-profile','${r.helper_id}');return false" style="font-size:.875rem">View profile →</a>
        </div>
      ` : ''}
      <div class="action-bar">${actions}</div>
    `;

    // Show chat for accepted/completed requests when the viewer is involved
    const isInvolved2 = isRequester || isHelper;
    if (['accepted', 'completed'].includes(r.status) && isInvolved2) {
      loadChat(id);
    } else {
      // Make sure chat is hidden and polling stopped
      clearInterval(chatPollInterval);
      chatPollInterval = null;
      const cs = document.getElementById('chat-section');
      if (cs) cs.classList.add('hidden');
    }
  } catch (e) {
    document.getElementById('request-detail-content').innerHTML = `<p class="error-msg">${e.message}</p>`;
  }
}

async function applyRequest(id) {
  try {
    await api('POST', `/api/requests/${id}/apply`);
    loadRequestDetail(id);
  } catch (e) { alert(e.message); }
}

async function approveApplicant(requestId, applicantId) {
  try {
    await api('POST', `/api/requests/${requestId}/approve/${applicantId}`);
    loadRequestDetail(requestId);
    refreshUser();
  } catch (e) { alert(e.message); }
}

async function declineApplicant(requestId, applicantId) {
  try {
    await api('POST', `/api/requests/${requestId}/decline/${applicantId}`);
    loadRequestDetail(requestId);
  } catch (e) { alert(e.message); }
}

async function completeRequest(id) {
  if (!confirm('Mark this request as completed? Credits will be transferred to the helper.')) return;
  try {
    await api('POST', `/api/requests/${id}/complete`);
    loadRequestDetail(id);
    refreshUser();
  } catch (e) { alert(e.message); }
}

async function cancelRequest(id) {
  if (!confirm('Cancel this request?')) return;
  try {
    await api('POST', `/api/requests/${id}/cancel`);
    loadRequestDetail(id);
  } catch (e) { alert(e.message); }
}

async function refreshUser() {
  currentUser = await api('GET', '/api/me'); cacheUser(currentUser);
  updateNavCredits();
  document.getElementById('credits-num').textContent = currentUser.credits;
}

// ── User Profile ───────────────────────────────────────────────────────────
async function loadUserProfile(id) {
  try {
    const u = await api('GET', `/api/users/${id}`);
    const el = document.getElementById('user-profile-content');
    const starsHtml = u.avgRating
      ? Array.from({length:5}, (_,i) => `<span class="star ${i < Math.round(u.avgRating) ? 'active' : ''}">★</span>`).join('')
      : '';
    el.innerHTML = `
      <a href="#" onclick="history.back();return false" style="color:var(--text-muted);font-size:.9rem">← Back</a>
      <div class="profile-card" style="margin-top:16px">
        <div class="profile-avatar-wrap">
          ${avatarHtml(u.name, u.avatar_url, 'profile-avatar')}
        </div>
        <div class="profile-info">
          <h2>${u.name.split(' ')[0]}</h2>
          <p>${u.building}</p>
          ${u.bio ? `<p style="margin-top:6px">${u.bio}</p>` : ''}
          ${u.avgRating ? `<div class="rating-row" style="margin-top:8px"><div class="stars">${starsHtml}</div><span>${u.avgRating} (${u.reviews.length} reviews)</span></div>` : ''}
          <button class="btn-primary" style="margin-top:16px" onclick="navigate('new-request','${u.id}')">Request ${u.name.split(' ')[0]}</button>
        </div>
      </div>
      ${u.pets.length ? `
        <div class="section-header mt-m"><h2>Pets</h2></div>
        ${u.pets.map(p => `
          <div class="pet-item">
            <div class="pet-info">
              <div class="pet-photo-wrap pet-photo-wrap--readonly">
                ${p.photo_url
                  ? `<img src="${p.photo_url}" class="pet-photo" alt="${p.name}" />`
                  : `<div class="pet-photo pet-photo-placeholder">${petEmoji(p.type)}</div>`}
              </div>
              <div>
                <div class="pet-name">${p.name}</div>
                <div class="pet-desc">${[p.type, p.breed, p.age ? p.age + ' yrs' : ''].filter(Boolean).join(' · ')}</div>
                ${p.notes ? `<div class="pet-desc">${p.notes}</div>` : ''}
              </div>
            </div>
          </div>`).join('')}
      ` : ''}
      ${u.reviews.length ? `
        <div class="section-header mt-m"><h2>Reviews</h2></div>
        <div class="detail-section">
          ${u.reviews.map(r => `
            <div class="review-item">
              <div class="review-meta">
                <span class="review-author">${r.reviewer_name}</span>
                <div class="stars">${Array.from({length:5},(_,i)=>`<span class="star ${i<r.rating?'active':''}" style="font-size:.9rem">★</span>`).join('')}</div>
              </div>
              ${r.comment ? `<div class="review-comment">${r.comment}</div>` : ''}
            </div>`).join('')}
        </div>
      ` : ''}
    `;
  } catch (e) {
    document.getElementById('user-profile-content').innerHTML = `<p class="error-msg">${e.message}</p>`;
  }
}

// ── Modals ─────────────────────────────────────────────────────────────────
function openModal(html) {
  document.getElementById('modal-content').innerHTML = html;
  document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ── Google Sign-In ─────────────────────────────────────────────────────────
async function signInWithGoogle() {
  authFlowActive = true;
  const provider = new firebase.auth.GoogleAuthProvider();
  let cred;
  try {
    cred = await firebase.auth().signInWithPopup(provider);
  } catch (ex) {
    authFlowActive = false;
    return { error: ex.message };
  }
  // Check if this Google user already has a backend profile
  try {
    currentUser = await api('GET', '/api/me'); cacheUser(currentUser);
    authFlowActive = false;
    closeModal();
    showApp();
    navigate('dashboard');
  } catch (e) {
    authFlowActive = false;
    // Only ask for address info when the user genuinely has no profile (401)
    if (e.status === 401) {
      openCompleteProfileModal(cred.user.displayName || '');
    } else {
      // Returning user hit a transient error — show it, don't wipe their profile
      return { error: e.message || 'Sign-in failed. Please try again.' };
    }
  }
}

function openCompleteProfileModal(prefillName) {
  openModal(`
    <h2>Almost there!</h2>
    <p style="color:var(--text-muted);margin-bottom:20px;font-size:.9rem">We just need a few more details to set up your NekoPawz profile.</p>
    <form id="cp-form" class="form-card" style="padding:0;border:none;box-shadow:none">
      <div class="form-row">
        <label>Full name</label>
        <input type="text" id="cp-name" value="${prefillName}" placeholder="Jane Smith" required />
      </div>
      <div class="form-row">
        <label>Address</label>
        <input type="text" id="cp-address" placeholder="123 Main St, City, State" required />
      </div>
      <div class="form-row">
        <label>Building / complex name <span style="color:var(--text-muted)">(optional)</span></label>
        <input type="text" id="cp-building-name" placeholder="The Pines Apartments" />
      </div>
      <div class="form-row">
        <label>Unit <span style="color:var(--text-muted)">(optional)</span></label>
        <input type="text" id="cp-unit" placeholder="4B" />
      </div>
      <div class="form-row">
        <label>Date of birth <span style="color:var(--text-muted)">(must be 18+)</span></label>
        <input type="date" id="cp-dob" required />
        <small style="color:var(--text-muted)">You must be at least 18 years old to create an account.</small>
      </div>
      <div class="form-row">
        <label class="tos-label">
          <input type="checkbox" id="cp-tos" />
          I have read and agree to the <a href="#" onclick="openTosModal();return false">Terms of Service</a>. I understand that NekoPawz is a neighbor-to-neighbor exchange platform and is not liable for any damages, injuries, losses, or incidents arising from pet care arrangements made through this platform.
        </label>
      </div>
      <div id="cp-error" class="error-msg hidden"></div>
      <button type="submit" class="btn-primary full-width">Complete sign-up</button>
    </form>
  `);

  document.getElementById('cp-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('cp-error');
    const address = document.getElementById('cp-address').value;
    const dob = document.getElementById('cp-dob').value;
    if (!dob) { err.textContent = 'Please enter your date of birth.'; err.classList.remove('hidden'); return; }
    const ageYears = (Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (ageYears < 18) { err.textContent = 'You must be at least 18 years old.'; err.classList.remove('hidden'); return; }
    if (!document.getElementById('cp-tos').checked) { err.textContent = 'You must agree to the Terms of Service.'; err.classList.remove('hidden'); return; }
    try {
      await api('POST', '/api/register', {
        name: document.getElementById('cp-name').value,
        building: address,
        building_name: document.getElementById('cp-building-name').value,
        address,
        unit: document.getElementById('cp-unit').value,
        dob
      });
      currentUser = await api('GET', '/api/me'); cacheUser(currentUser);
      closeModal();
      showApp();
      navigate('dashboard');
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });
}

function openLoginModal() {
  openModal(`
    <h2>Welcome back</h2>
    <form id="login-form" class="form-card" style="padding:0;border:none;box-shadow:none">
      <button type="button" id="google-signin-btn" class="btn-google full-width">
        <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="18" height="18" alt="" />
        Continue with Google
      </button>
      <div class="auth-divider"><span>or</span></div>
      <div class="form-row">
        <label>Email</label>
        <input type="email" id="l-email" placeholder="you@email.com" autocomplete="email" required />
      </div>
      <div class="form-row">
        <label>Password</label>
        <input type="password" id="l-password" placeholder="Password" autocomplete="current-password" required />
      </div>
      <label class="remember-me-row">
        <input type="checkbox" id="l-remember" checked />
        <span>Keep me signed in</span>
      </label>
      <div id="login-error" class="error-msg hidden"></div>
      <button type="submit" class="btn-primary full-width">Sign in</button>
      <p style="text-align:center;margin-top:16px;font-size:.85rem;color:var(--text-muted)">
        No account? <a href="#" data-open="register-modal">Create one →</a>
      </p>
    </form>
  `);

  // Helper: set Firebase persistence based on the checkbox
  async function applyPersistence() {
    const remember = document.getElementById('l-remember')?.checked !== false;
    await firebase.auth().setPersistence(
      remember ? firebase.auth.Auth.Persistence.LOCAL
               : firebase.auth.Auth.Persistence.SESSION
    );
  }

  document.getElementById('google-signin-btn').addEventListener('click', async () => {
    await applyPersistence();
    const result = await signInWithGoogle();
    if (result?.error) {
      const err = document.getElementById('login-error');
      if (err) { err.textContent = result.error; err.classList.remove('hidden'); }
    }
  });
  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('login-error');
    authFlowActive = true;
    try {
      await applyPersistence();
      await firebase.auth().signInWithEmailAndPassword(
        document.getElementById('l-email').value,
        document.getElementById('l-password').value
      );
      currentUser = await api('GET', '/api/me'); cacheUser(currentUser);
      authFlowActive = false;
      closeModal();
      showApp();
      navigate('dashboard');
    } catch (ex) {
      authFlowActive = false;
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });
}

// ── Address input — Google Places (if key configured) or Nominatim fallback ──
// Attaches to an existing <input> and populates hidden lat/lng/building fields.
// The user must SELECT from the dropdown (or use GPS) before the fields are set,
// which guarantees accurate coordinates instead of an unvalidated free-text string.
// setupAddressInput — attaches autocomplete + GPS to any address input.
// Nominatim is wired up SYNCHRONOUSLY so listeners are always ready immediately.
// Google Places is attached asynchronously in the background as an upgrade.
// Validation uses data-dirty/data-confirmed attributes, not lat/lng presence.
function setupAddressInput(inputId, latId, lngId, buildingId, statusId) {
  const input    = document.getElementById(inputId);
  const statusEl = document.getElementById(statusId);
  if (!input) return;

  function setConfirmed(lat, lng, displayAddr, buildingKey) {
    document.getElementById(latId).value      = lat;
    document.getElementById(lngId).value      = lng;
    document.getElementById(buildingId).value = buildingKey;
    input.value = displayAddr;
    input.dataset.dirty     = 'false';
    input.dataset.confirmed = 'true';
    if (statusEl) { statusEl.textContent = '✓ Address confirmed'; statusEl.className = 'addr-status addr-ok'; }
  }

  function clearConfirmed() {
    document.getElementById(latId).value      = '';
    document.getElementById(lngId).value      = '';
    document.getElementById(buildingId).value = '';
    input.dataset.dirty     = 'true';
    input.dataset.confirmed = 'false';
    if (statusEl) { statusEl.textContent = 'Select your address from the list below'; statusEl.className = 'addr-status'; }
  }

  function buildPlaceKey(comp) {
    const streetNum = comp.find(c => c.types.includes('street_number'))?.long_name || '';
    const route     = comp.find(c => c.types.includes('route'))?.long_name           || '';
    const locality  = comp.find(c => c.types.includes('locality'))?.long_name        || '';
    const state     = comp.find(c => c.types.includes('administrative_area_level_1'))?.short_name || '';
    return [streetNum, route, locality, state].filter(Boolean).join(', ').toLowerCase();
  }

  // ── GPS button (works with either geocoder) ───────────────────────────────
  function setupGpsButton(useGoogle) {
    const btn     = document.getElementById('detect-location-btn');
    const icon    = document.getElementById('detect-icon');
    const dstatus = document.getElementById('detect-status');
    if (!btn) return;
    // Remove any previous listener by cloning
    const fresh = btn.cloneNode(true);
    btn.parentNode.replaceChild(fresh, btn);
    fresh.addEventListener('click', () => {
      fresh.disabled = true;
      document.getElementById('detect-icon').textContent = '⏳';
      if (dstatus) { dstatus.textContent = 'Detecting your location…'; dstatus.className = 'detect-status detecting'; }
      navigator.geolocation.getCurrentPosition(async pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        try {
          let displayAddr, buildingKey;
          if (useGoogle && window.google?.maps) {
            const geocoder = new google.maps.Geocoder();
            const { results } = await geocoder.geocode({ location: { lat, lng } });
            if (!results?.length) throw new Error('No results');
            displayAddr = results[0].formatted_address;
            buildingKey = buildPlaceKey(results[0].address_components || []);
          } else {
            const res  = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`, { headers: { 'Accept-Language': 'en' } });
            const data = await res.json();
            displayAddr = data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
            buildingKey = displayAddr;
          }
          setConfirmed(lat, lng, displayAddr, buildingKey);
          document.getElementById('detect-icon').textContent = '✅';
          if (dstatus) { dstatus.textContent = '✓ Location detected — confirm your address above looks right.'; dstatus.className = 'detect-status success'; }
        } catch {
          document.getElementById('detect-icon').textContent = '📍';
          if (dstatus) { dstatus.textContent = 'Could not fetch address. Try typing it above.'; dstatus.className = 'detect-status error'; }
          fresh.disabled = false;
        }
      }, () => {
        document.getElementById('detect-icon').textContent = '📍';
        if (dstatus) { dstatus.textContent = 'Location access denied. Please type your address.'; dstatus.className = 'detect-status error'; }
        fresh.disabled = false;
      });
    });
  }

  // ── Nominatim — set up IMMEDIATELY (synchronous) ─────────────────────────
  const suggestionsBox = document.getElementById('address-suggestions');
  let debounceTimer;

  input.addEventListener('input', () => {
    clearConfirmed();
    clearTimeout(debounceTimer);
    if (!suggestionsBox) return;
    const q = input.value.trim();
    if (q.length < 4) { suggestionsBox.classList.add('hidden'); return; }
    debounceTimer = setTimeout(async () => {
      // Skip if Google Places has since taken over (it manages its own dropdown)
      if (input.dataset.mapsActive === 'true') return;
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=6`, { headers: { 'Accept-Language': 'en' } });
        const results = await res.json();
        if (!results.length) { suggestionsBox.classList.add('hidden'); return; }
        suggestionsBox.innerHTML = results.map(r =>
          `<div class="suggestion-item" data-lat="${r.lat}" data-lng="${r.lon}" data-display="${encodeURIComponent(r.display_name)}">
            <span class="suggestion-icon">${suggestionIcon(r.type, r.class)}</span>
            <span>${r.display_name}</span>
          </div>`
        ).join('');
        suggestionsBox.classList.remove('hidden');
      } catch {}
    }, 350);
  });

  if (suggestionsBox) {
    suggestionsBox.addEventListener('click', e => {
      const item = e.target.closest('.suggestion-item');
      if (!item) return;
      setConfirmed(item.dataset.lat, item.dataset.lng, decodeURIComponent(item.dataset.display), decodeURIComponent(item.dataset.display));
      suggestionsBox.classList.add('hidden');
    });
    document.addEventListener('click', e => {
      if (!e.target.closest('#' + inputId) && !e.target.closest('#address-suggestions'))
        suggestionsBox.classList.add('hidden');
    });
  }

  setupGpsButton(false); // start with Nominatim GPS

  // ── Google Places — upgrade asynchronously in background ─────────────────
  waitForGoogleMaps().then(ready => {
    if (!ready || !document.getElementById(inputId)) return; // page may have changed
    input.dataset.mapsActive = 'true'; // suppress Nominatim dropdown
    input.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });

    const autocomplete = new google.maps.places.Autocomplete(input, {
      types: ['address'],
      fields: ['formatted_address', 'geometry', 'address_components'],
    });
    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace();
      if (!place.geometry) return;
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();
      const buildingKey = buildPlaceKey(place.address_components || []);
      setConfirmed(lat, lng, place.formatted_address || '', buildingKey);
    });

    setupGpsButton(true); // upgrade GPS to use Google Geocoder
  });
}

function openRegisterModal() {
  openModal(`
    <h2>Join NekoPawz</h2>
    <div style="background:var(--green-ghost);border:1px solid var(--green-pale);border-radius:var(--radius-sm);padding:12px 14px;margin-bottom:20px;font-size:.85rem;color:var(--green-deep);display:flex;gap:10px;align-items:flex-start">
      <span style="font-size:1.1rem">🔒</span>
      <span>Identity verification keeps the community safe. You'll receive <strong>1 free credit</strong> after verifying.</span>
    </div>
    <button type="button" id="google-register-btn" class="btn-google full-width" style="margin-bottom:8px">
      <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" width="18" height="18" alt="" />
      Sign up with Google
    </button>
    <div class="auth-divider"><span>or sign up with email</span></div>
    <form id="reg-form" class="form-card" style="padding:0;border:none;box-shadow:none">
      <div class="form-row">
        <label>Full name</label>
        <input type="text" id="r-name" placeholder="Jane Smith" required />
      </div>
      <div class="form-row">
        <label>Email</label>
        <input type="email" id="r-email" placeholder="you@email.com" required />
      </div>
      <div class="form-row">
        <label>Password</label>
        <input type="password" id="r-password" placeholder="Choose a password" required />
      </div>
      <div class="form-row" style="position:relative">
        <label>Street address</label>
        <p style="font-size:.78rem;color:var(--text-muted);margin:-4px 0 6px">Start typing and select your address from the list — this lets us show you neighbors nearby.</p>
        <div class="address-input-wrap">
          <input type="text" id="r-address" placeholder="e.g. 123 Main St, Brooklyn…" autocomplete="off" required />
          <button type="button" class="detect-location-btn" id="detect-location-btn" title="Use my current location">
            <span id="detect-icon">📍</span>
          </button>
        </div>
        <div id="address-suggestions" class="address-suggestions hidden"></div>
        <div id="addr-confirm-status" class="addr-status"></div>
        <div id="detect-status" class="detect-status hidden"></div>
        <input type="hidden" id="r-building" />
        <input type="hidden" id="r-lat" />
        <input type="hidden" id="r-lng" />
      </div>
      <div class="form-row">
        <label>Unit / apt number <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
        <input type="text" id="r-unit" placeholder="e.g. 4B, Apt 12" />
      </div>
      <div class="form-row">
        <label>Building name <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
        <input type="text" id="r-building-name" placeholder="e.g. The Waverly, Sunrise Apartments" />
      </div>
      <div class="form-row">
        <label>Government ID <span style="font-weight:400;color:var(--text-muted)">(for verification)</span></label>
        <select id="r-id-type" style="margin-bottom:8px">
          <option value="">Select ID type…</option>
          <option value="drivers_license">Driver's license</option>
          <option value="passport">Passport</option>
          <option value="state_id">State ID</option>
        </select>
        <input type="text" id="r-id-number" placeholder="ID number" required />
        <p style="font-size:.75rem;color:var(--text-muted);margin-top:5px">🔐 Your ID is used only to verify identity and is never shared.</p>
      </div>
      <div class="form-row">
        <label>Date of birth <span style="font-weight:400;color:var(--text-muted)">(must be 18+)</span></label>
        <input type="date" id="r-dob" required />
        <p style="font-size:.75rem;color:var(--text-muted);margin-top:4px">You must be at least 18 years old to create an account.</p>
      </div>
      <div class="form-row">
        <label>Short bio <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
        <input type="text" id="r-bio" placeholder="Dog lover, work from home…" />
      </div>
      <div class="form-row">
        <label class="tos-label">
          <input type="checkbox" id="r-tos" />
          <span>I have read and agree to the <a href="#" onclick="openTosModal();return false">Terms of Service</a>. I understand that NekoPawz is a neighbor-to-neighbor exchange platform and is not liable for any damages, injuries, losses, or incidents arising from pet care arrangements made through this platform.</span>
        </label>
      </div>
      <div id="reg-error" class="error-msg hidden"></div>
      <button type="submit" class="btn-primary full-width">Create account &amp; verify ID — get 1 free credit</button>
      <p style="text-align:center;margin-top:16px;font-size:.85rem;color:var(--text-muted)">
        Already have an account? <a href="#" data-open="login-modal">Sign in →</a>
      </p>
    </form>
  `);

  // Address input — Google Places if available, Nominatim fallback
  setupAddressInput('r-address', 'r-lat', 'r-lng', 'r-building', 'addr-confirm-status');

  document.getElementById('google-register-btn').addEventListener('click', () => signInWithGoogle());

  document.getElementById('reg-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('reg-error');
    const building = document.getElementById('r-building').value;
    const address  = document.getElementById('r-address').value;
    const lat      = document.getElementById('r-lat').value;
    const lng      = document.getElementById('r-lng').value;
    if (!address) { err.textContent = 'Please enter your street address.'; err.classList.remove('hidden'); return; }
    if (!lat || !lng) {
      err.textContent = 'Please select your address from the dropdown — or tap the 📍 button to use your current location.';
      err.classList.remove('hidden');
      document.getElementById('r-address').focus();
      return;
    }
    const dob = document.getElementById('r-dob').value;
    if (!dob) { err.textContent = 'Please enter your date of birth.'; err.classList.remove('hidden'); return; }
    const ageMs = Date.now() - new Date(dob).getTime();
    const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
    if (ageYears < 18) { err.textContent = 'You must be at least 18 years old to create an account.'; err.classList.remove('hidden'); return; }
    if (!document.getElementById('r-tos').checked) { err.textContent = 'You must agree to the Terms of Service.'; err.classList.remove('hidden'); return; }
    try {
      // Create Firebase account first, then register profile on backend
      await firebase.auth().createUserWithEmailAndPassword(
        document.getElementById('r-email').value,
        document.getElementById('r-password').value
      );
      try {
        await api('POST', '/api/register', {
          name: document.getElementById('r-name').value,
          building,
          building_name: document.getElementById('r-building-name').value,
          address,
          unit: document.getElementById('r-unit').value,
          bio: document.getElementById('r-bio').value,
          lat: lat || null,
          lng: lng || null,
          dob
        });
      } catch (profileErr) {
        // Backend profile creation failed — delete the Firebase account so the user can retry
        await firebase.auth().currentUser?.delete();
        throw profileErr;
      }
      currentUser = await api('GET', '/api/me'); cacheUser(currentUser);
      closeModal();
      showApp();
      navigate('dashboard');
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });
}

function suggestionIcon(type, cls) {
  if (cls === 'building' || type === 'apartments' || type === 'residential') return '🏢';
  if (cls === 'highway' || type === 'residential') return '🛣️';
  if (type === 'house' || type === 'detached') return '🏠';
  return '📍';
}

function openTosModal() {
  openModal(`
    <h2>Terms of Service</h2>
    <div style="max-height:60vh;overflow-y:auto;font-size:.9rem;line-height:1.6;color:var(--text)">
      <p><strong>Last updated: April 2026</strong></p>
      <p>Welcome to NekoPawz. By creating an account and using this platform, you agree to the following terms.</p>
      <h3 style="margin-top:1rem">1. Nature of the Platform</h3>
      <p>NekoPawz is a neighbor-to-neighbor exchange platform that facilitates connections between pet owners and neighbors willing to provide pet care services. NekoPawz does not employ, screen, or supervise any users. All arrangements are made directly between neighbors at their own discretion.</p>
      <h3 style="margin-top:1rem">2. Limitation of Liability</h3>
      <p>NekoPawz is not liable for any damages, injuries, losses, illnesses, accidents, property damage, or incidents of any kind arising from or related to pet care arrangements made through this platform. This includes but is not limited to: injury to pets, injury to people, lost or escaped animals, property damage, and disputes between users.</p>
      <h3 style="margin-top:1rem">3. User Responsibility</h3>
      <p>You are solely responsible for vetting any neighbor you engage with through this platform. You agree to use good judgment and take all reasonable precautions when arranging care for your pets or caring for another person's pets.</p>
      <h3 style="margin-top:1rem">4. Age Requirement</h3>
      <p>You must be at least 18 years old to create an account or use this platform.</p>
      <h3 style="margin-top:1rem">5. Credits</h3>
      <p>NekoPawz credits have no monetary value and cannot be exchanged for cash. They exist solely as a community exchange mechanism within the platform.</p>
      <h3 style="margin-top:1rem">6. Modifications</h3>
      <p>NekoPawz reserves the right to modify these terms at any time. Continued use of the platform constitutes acceptance of updated terms.</p>
      <p style="margin-top:1.5rem;color:var(--text-muted)">By checking the agreement box on registration, you acknowledge that you have read, understood, and agree to these Terms of Service.</p>
    </div>
    <div style="margin-top:1.5rem;text-align:right">
      <button class="btn btn-primary" onclick="closeModal()">Close</button>
    </div>
  `);
}

function openAddPetModal() {
  openModal(`
    <h2>Add a pet</h2>
    <form id="pet-form" class="form-card" style="padding:0;border:none;box-shadow:none">
      <div class="form-row">
        <label>Pet name</label>
        <input type="text" id="p-name" placeholder="Buddy" required />
      </div>
      <div class="form-row">
        <label>Type</label>
        <select id="p-type">
          <option value="dog">Dog</option>
          <option value="cat">Cat</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div class="form-row">
        <label>Breed <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
        <input type="text" id="p-breed" placeholder="Golden Retriever" />
      </div>
      <div class="form-row">
        <label>Age <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
        <input type="text" id="p-age" placeholder="3" />
      </div>
      <div class="form-row">
        <label>Notes for helpers</label>
        <textarea id="p-notes" rows="2" placeholder="Friendly, loves fetch, no small dogs…"></textarea>
      </div>
      <div id="pet-error" class="error-msg hidden"></div>
      <button type="submit" class="btn-primary full-width">Add pet</button>
    </form>
  `);
  document.getElementById('pet-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('pet-error');
    try {
      await api('POST', '/api/pets', {
        name: document.getElementById('p-name').value,
        type: document.getElementById('p-type').value,
        breed: document.getElementById('p-breed').value,
        age: document.getElementById('p-age').value,
        notes: document.getElementById('p-notes').value
      });
      closeModal();
      loadProfile();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  });
}

let selectedRating = 0;
function openReviewModal(requestId, revieweeId, revieweeName) {
  selectedRating = 0;
  openModal(`
    <h2>Rate your sitter</h2>
    ${revieweeName ? `<p style="color:var(--text-muted);margin-bottom:16px">How was your experience with <strong>${revieweeName}</strong>?</p>` : ''}
    <div class="form-card" style="padding:0;border:none;box-shadow:none">
      <div class="form-row">
        <label>Rating</label>
        <div class="stars review-stars-big" id="review-stars">
          ${[1,2,3,4,5].map(n => `<span class="star" data-val="${n}" onclick="setRating(${n})">★</span>`).join('')}
        </div>
      </div>
      <div class="form-row">
        <label>Comment <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
        <textarea id="rev-comment" rows="3" placeholder="Great neighbor, very reliable…"></textarea>
      </div>
      <div id="rev-error" class="error-msg hidden"></div>
      <button class="btn-primary full-width" onclick="submitReview('${requestId}','${revieweeId}')">Submit</button>
    </div>
  `);
}

function setRating(val) {
  selectedRating = val;
  document.querySelectorAll('#review-stars .star').forEach((s, i) => {
    s.classList.toggle('active', i < val);
  });
}

async function submitReview(requestId, revieweeId) {
  const err = document.getElementById('rev-error');
  if (!selectedRating) { err.textContent = 'Please select a rating'; err.classList.remove('hidden'); return; }
  try {
    await api('POST', '/api/reviews', {
      request_id: requestId,
      reviewee_id: revieweeId,
      rating: selectedRating,
      comment: document.getElementById('rev-comment').value
    });
    closeModal();
    loadRequestDetail(requestId); // Refresh to show "Reviewed ✓" state
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
function requestCard(r, showStatus = false) {
  const isInvolved  = r.requester_id === currentUser?.id || r.helper_id === currentUser?.id;
  const confirmed   = isInvolved && r.status !== 'open';
  const sameBuilding = r.distanceLabel === 'Same building' || r.req_building === currentUser?.building;

  let locationHint;
  if (confirmed) {
    locationHint = sameBuilding
      ? `<span class="req-meta-tag">🏢 Same building · Unit ${r.requester_unit}</span>`
      : `<span class="req-meta-tag">📍 ${r.requester_address || r.distanceLabel}</span>`;
  } else {
    locationHint = sameBuilding
      ? `<span class="req-meta-tag">🏢 Same building</span>`
      : `<span class="req-meta-tag" title="Exact address revealed after confirmation">📍 ${r.distanceLabel || 'Nearby'}</span>`;
  }

  const posterName = r.requester_id !== currentUser?.id
    ? (r.requester_name || '').split(' ')[0]
    : null;

  const statusLabels = { open: 'Open', accepted: 'In progress', completed: 'Completed', cancelled: 'Cancelled' };

  return `
    <div class="request-card" onclick="navigate('request-detail','${r.id}')">
      <div class="req-header">
        <span class="req-type-badge">${typeLabel(r.type)}</span>
        <div class="req-header-right">
          ${r.directed_to ? `<span class="directed-badge">For you</span>` : ''}
          ${showStatus ? `<span class="req-status status-${r.status}">${statusLabels[r.status] || r.status}</span>` : ''}
          <span class="req-credits-badge">${r.credits || 1} cr</span>
        </div>
      </div>
      <div class="req-title">${r.title}</div>
      ${posterName ? `<div class="req-poster">Posted by <strong>${posterName}</strong></div>` : ''}
      <div class="req-meta">
        <span class="req-meta-tag req-date-tag">📅 ${formatRequestDate(r.date)}</span>
        ${r.time_window ? `<span class="req-meta-tag">🕐 ${r.time_window}</span>` : ''}
        ${r.duration    ? `<span class="req-meta-tag">⏱ ${r.duration}</span>`    : ''}
        ${(r.petNames || r.pet_name) ? `<span class="req-meta-tag">${petEmoji(r.pet_type || r.type)} ${r.petNames || r.pet_name}</span>` : ''}
        ${locationHint}
      </div>
      ${r.pet_notes ? `<div class="req-pet-notes">"${r.pet_notes}"</div>` : ''}
    </div>
  `;
}

function typeLabel(type) {
  return { dog_walk: '🐕 Dog walk', cat_checkin: '🐱 Cat check-in', other: '🐾 Other' }[type] || type;
}

function petEmoji(type) {
  return { dog: '🐕', cat: '🐱', other: '🐾' }[type] || '🐾';
}

// ── Recipient picker ───────────────────────────────────────────────────────
function setRecipient(id, name, building) {
  const directedInput = document.getElementById('req-directed-to');
  const recipientCard = document.getElementById('req-recipient-card');
  const submitBtn = document.getElementById('req-submit-btn');
  const heading = document.getElementById('new-request-heading');
  const anyoneBtn = document.getElementById('recip-anyone-btn');
  const specificBtn = document.getElementById('recip-specific-btn');
  const pickerList = document.getElementById('neighbor-picker-list');

  if (id) {
    directedInput.value = id;
    heading.textContent = `Request ${name.split(' ')[0]}`;
    submitBtn.textContent = `Send to ${name.split(' ')[0]}`;
    recipientCard.classList.remove('hidden');
    recipientCard.innerHTML = `
      <div class="recipient-avatar">${name[0].toUpperCase()}</div>
      <div class="recipient-info">
        <div class="recipient-label">Sending directly to</div>
        <div class="recipient-name">${name}</div>
        <div class="recipient-sub">${building || 'Neighbor'}</div>
      </div>
      <button type="button" class="recipient-remove" onclick="setRecipient(null)" title="Remove">✕</button>
    `;
    anyoneBtn?.classList.remove('active');
    specificBtn?.classList.add('active');
    pickerList?.classList.add('hidden');
  } else {
    directedInput.value = '';
    heading.textContent = 'Post a request';
    submitBtn.textContent = 'Post request';
    recipientCard.classList.add('hidden');
    anyoneBtn?.classList.add('active');
    specificBtn?.classList.remove('active');
    pickerList?.classList.add('hidden');
  }
}

function toggleNeighborPicker() {
  const list = document.getElementById('neighbor-picker-list');
  const specificBtn = document.getElementById('recip-specific-btn');
  const isOpen = !list.classList.contains('hidden');
  if (isOpen) {
    list.classList.add('hidden');
  } else {
    list.classList.remove('hidden');
    specificBtn.classList.add('active');
    document.getElementById('recip-anyone-btn').classList.remove('active');
  }
}

// ── Chat ───────────────────────────────────────────────────────────────────
let chatPollInterval = null;
let chatRequestId = null;

async function loadChat(requestId) {
  chatRequestId = requestId;
  const section = document.getElementById('chat-section');
  section.classList.remove('hidden');
  await refreshChat(requestId);
  clearInterval(chatPollInterval);
  chatPollInterval = setInterval(() => refreshChat(requestId), 8000);
}

async function refreshChat(requestId) {
  try {
    const messages = await api('GET', `/api/requests/${requestId}/messages`);
    const box = document.getElementById('chat-messages');
    if (!box) return;
    box.innerHTML = messages.length ? messages.map(m => {
      const mine = m.sender_id === currentUser.id;
      return `<div class="chat-msg ${mine ? 'mine' : 'theirs'}">
        ${!mine ? `<div class="chat-sender">${m.sender_name}</div>` : ''}
        ${m.image_url ? `<img src="${m.image_url}" class="chat-img" onclick="window.open('${m.image_url}')" />` : ''}
        ${m.body ? `<div class="chat-bubble">${m.body}</div>` : ''}
        <div class="chat-time">${timeAgo(m.created_at)}</div>
      </div>`;
    }).join('') : '<div class="chat-empty">No messages yet. Say hi!</div>';
    box.scrollTop = box.scrollHeight;
  } catch {}
}

async function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const body = input.value.trim();
  if (!body || !chatRequestId) return;
  input.value = '';
  try {
    await api('POST', `/api/requests/${chatRequestId}/messages`, { body });
    await refreshChat(chatRequestId);
  } catch (e) { alert(e.message); }
}

async function sendChatImage(file) {
  if (!file || !chatRequestId) return;
  const formData = new FormData();
  formData.append('image', file);
  const headers = {};
  const fbUser = firebase.auth().currentUser;
  if (fbUser) headers['Authorization'] = `Bearer ${await fbUser.getIdToken()}`;
  try {
    const res = await fetch((window.API_BASE || '') + `/api/requests/${chatRequestId}/messages/image`, {
      method: 'POST', headers, body: formData
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    await refreshChat(chatRequestId);
  } catch (e) { alert(e.message); }
}

// ── Settings ───────────────────────────────────────────────────────────────
// Navigate to a page that's accessible without login (shows a back-to-home link)
function navigatePublic(page) {
  document.getElementById('navbar').classList.add('hidden');
  document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  const el = document.getElementById(`page-${page}`);
  if (el) el.classList.remove('hidden');
  currentPage = page;
  window.scrollTo(0, 0);
  if (page === 'contact') loadContact();
}

function loadContact() {
  const el = document.getElementById('contact-content');
  const prefillEmail = currentUser?.email || '';
  const prefillName  = currentUser?.name  || '';
  const backLink = !currentUser
    ? `<div class="contact-back"><a href="#" onclick="showLanding();return false">← Back to home</a></div>`
    : '';
  el.innerHTML = `${backLink}
    <div class="form-card">
      <div id="contact-success" class="contact-success hidden">
        <div class="contact-success-icon">✓</div>
        <h3>Message sent!</h3>
        <p>Thanks for reaching out. We'll get back to you as soon as possible.</p>
        <button class="btn-outline mt-s" onclick="loadContact()">Send another message</button>
      </div>
      <div id="contact-form-wrap">
        <div class="form-row">
          <label>Your name</label>
          <input type="text" id="c-name" value="${prefillName.replace(/"/g,'&quot;')}" placeholder="Jane Smith" required />
        </div>
        <div class="form-row">
          <label>Your email</label>
          <input type="email" id="c-email" value="${prefillEmail.replace(/"/g,'&quot;')}" placeholder="you@example.com" required />
        </div>
        <div class="form-row">
          <label>Subject <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
          <input type="text" id="c-subject" placeholder="Question about my account…" />
        </div>
        <div class="form-row">
          <label>Message</label>
          <textarea id="c-message" rows="5" placeholder="How can we help?" required></textarea>
        </div>
        <div id="contact-error" class="error-msg hidden"></div>
        <button class="btn-primary full-width" onclick="submitContact()">Send message</button>
      </div>
    </div>
  `;
}

async function submitContact() {
  const err = document.getElementById('contact-error');
  const name    = document.getElementById('c-name').value.trim();
  const email   = document.getElementById('c-email').value.trim();
  const subject = document.getElementById('c-subject').value.trim();
  const message = document.getElementById('c-message').value.trim();

  err.classList.add('hidden');
  if (!name)    { err.textContent = 'Please enter your name.';    err.classList.remove('hidden'); return; }
  if (!email)   { err.textContent = 'Please enter your email.';   err.classList.remove('hidden'); return; }
  if (!message) { err.textContent = 'Please enter a message.';    err.classList.remove('hidden'); return; }

  const btn = document.querySelector('#contact-form-wrap .btn-primary');
  btn.textContent = 'Sending…';
  btn.disabled = true;

  try {
    await api('POST', '/api/contact', { name, email, subject, message });
    document.getElementById('contact-form-wrap').classList.add('hidden');
    document.getElementById('contact-success').classList.remove('hidden');
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
    btn.textContent = 'Send message';
    btn.disabled = false;
  }
}

async function loadSettings() {
  try {
    const s = await api('GET', '/api/settings');
    const el = document.getElementById('settings-content');
    el.innerHTML = `
      <div class="settings-section">
        <h2>Profile</h2>
        <div class="form-card">
          <div class="form-row avatar-upload-row">
            <div class="avatar-upload-preview" id="avatar-preview">
              ${avatarHtml(s.name, s.avatar_url, 'settings-avatar')}
            </div>
            <div>
              <label class="btn-outline btn-sm" for="avatar-input" style="cursor:pointer">Change photo</label>
              <input type="file" id="avatar-input" accept="image/jpeg,image/png,image/gif,image/webp" style="display:none" onchange="uploadAvatar(this)" />
              <p style="font-size:.78rem;color:var(--text-muted);margin-top:4px">JPG, PNG or GIF · max 8 MB</p>
            </div>
          </div>
          <div class="form-row">
            <label>Display name</label>
            <input type="text" id="s-name" value="${s.name}" />
          </div>
          <div class="form-row">
            <label>Bio</label>
            <textarea id="s-bio" rows="2">${s.bio || ''}</textarea>
          </div>
          <div class="form-row">
            <label>Unit number</label>
            <input type="text" id="s-unit" value="${s.unit || ''}" placeholder="4B" />
          </div>
          <div class="form-row" style="position:relative">
            <label>Street address</label>
            <p style="font-size:.78rem;color:var(--text-muted);margin:-4px 0 6px">Select from the dropdown to confirm your location.</p>
            <div class="address-input-wrap">
              <input type="text" id="s-address" value="${(s.address || s.building || '').replace(/"/g,'&quot;')}" autocomplete="off" />
              <button type="button" class="detect-location-btn" id="detect-location-btn" title="Use my current location"><span id="detect-icon">📍</span></button>
            </div>
            <div id="address-suggestions" class="address-suggestions hidden"></div>
            <div id="addr-confirm-status" class="addr-status addr-ok">${s.lat && s.lng ? '✓ Address confirmed' : ''}</div>
            <div id="detect-status" class="detect-status hidden"></div>
            <input type="hidden" id="s-building" value="${(s.building || '').replace(/"/g,'&quot;')}" />
            <input type="hidden" id="s-lat"      value="${s.lat || ''}" />
            <input type="hidden" id="s-lng"      value="${s.lng || ''}" />
          </div>
          <button class="btn-primary" onclick="saveSettings(event)">Save profile</button>
        </div>
      </div>
      <div class="settings-section">
        <h2>Notifications</h2>
        <div class="form-card">
          <div class="setting-row">
            <div>
              <div class="setting-label">New messages</div>
              <div class="setting-sub">Get notified when your helper sends you a message</div>
            </div>
            <label class="toggle"><input type="checkbox" id="s-notif-messages" ${s.notif_messages ? 'checked' : ''} /><span class="toggle-track"></span></label>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">Request updates</div>
              <div class="setting-sub">Alerts when requests are accepted or completed</div>
            </div>
            <label class="toggle"><input type="checkbox" id="s-notif-accepted" ${s.notif_accepted ? 'checked' : ''} /><span class="toggle-track"></span></label>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">Upcoming sit reminders</div>
              <div class="setting-sub">Reminders on the dashboard for sits in the next 3 days</div>
            </div>
            <label class="toggle"><input type="checkbox" id="s-notif-reminders" ${s.notif_reminders ? 'checked' : ''} /><span class="toggle-track"></span></label>
          </div>
          <div class="setting-row">
            <div>
              <div class="setting-label">Browser notifications</div>
              <div class="setting-sub">Show desktop alerts for new messages and reminders</div>
            </div>
            <label class="toggle"><input type="checkbox" id="s-notif-browser" ${s.notif_browser ? 'checked' : ''} onchange="handleBrowserNotifToggle(this)" /><span class="toggle-track"></span></label>
          </div>
          <button class="btn-primary" style="margin-top:8px" onclick="saveSettings(event)">Save notifications</button>
        </div>
      </div>
      <div class="settings-section">
        <h2>Emergency contact</h2>
        <div class="form-card">
          <p class="settings-private-note">This information is private and only visible to the NekoPawz support team. It will never be shared with other users.</p>
          <div class="form-row">
            <label>Full name</label>
            <input type="text" id="s-ec-name" value="${s.ec_name || ''}" placeholder="Jane Smith" />
          </div>
          <div class="form-row">
            <label>Phone number</label>
            <input type="tel" id="s-ec-phone" value="${s.ec_phone || ''}" placeholder="+1 (555) 000-0000" />
          </div>
          <div class="form-row">
            <label>Relationship</label>
            <input type="text" id="s-ec-relation" value="${s.ec_relation || ''}" placeholder="Partner, parent, friend…" />
          </div>
          <button class="btn-primary" onclick="saveSettings(event)">Save emergency contact</button>
        </div>
      </div>
    `;
    // Wire up address autocomplete — pre-confirm existing coords so the green tick shows immediately
    setupAddressInput('s-address', 's-lat', 's-lng', 's-building', 'addr-confirm-status');
  } catch (e) { document.getElementById('settings-content').innerHTML = `<p class="error-msg">${e.message}</p>`; }
}

async function uploadAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) { alert('Image must be under 8 MB'); input.value = ''; return; }
  const formData = new FormData();
  formData.append('avatar', file);
  const fbUser = firebase.auth().currentUser;
  const headers = {};
  if (fbUser) headers['Authorization'] = `Bearer ${await fbUser.getIdToken()}`;
  try {
    const res = await fetch((window.API_BASE || '') + '/api/avatar', { method: 'POST', headers, body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    currentUser = await api('GET', '/api/me'); cacheUser(currentUser);
    const preview = document.getElementById('avatar-preview');
    if (preview) preview.innerHTML = avatarHtml(currentUser.name, currentUser.avatar_url, 'settings-avatar');
  } catch (e) { alert('Upload failed: ' + e.message); }
}

async function saveSettings(event) {
  const btn = event?.target;          // capture before any await — event is gone after
  const addrInput = document.getElementById('s-address');
  // Only validate if the user actually changed the address
  if (addrInput?.dataset.dirty === 'true') {
    alert('Please select your address from the dropdown — or tap 📍 to use your current location.');
    addrInput.focus();
    return;
  }

  try {
    const sLat     = document.getElementById('s-lat')?.value;
    const sLng     = document.getElementById('s-lng')?.value;
    const sAddress = addrInput?.value?.trim();
    const body = {
      name: document.getElementById('s-name')?.value,
      bio: document.getElementById('s-bio')?.value,
      unit: document.getElementById('s-unit')?.value,
      notif_messages: document.getElementById('s-notif-messages')?.checked ? 1 : 0,
      notif_accepted: document.getElementById('s-notif-accepted')?.checked ? 1 : 0,
      notif_reminders: document.getElementById('s-notif-reminders')?.checked ? 1 : 0,
      notif_browser: document.getElementById('s-notif-browser')?.checked ? 1 : 0,
      ec_name: document.getElementById('s-ec-name')?.value ?? '',
      ec_phone: document.getElementById('s-ec-phone')?.value ?? '',
      ec_relation: document.getElementById('s-ec-relation')?.value ?? '',
    };
    // Include address fields whenever we have confirmed coordinates
    if (sLat && sLng && sAddress) {
      body.address  = sAddress;
      body.building = document.getElementById('s-building')?.value || sAddress;
      body.lat = sLat;
      body.lng = sLng;
    }
    await api('PUT', '/api/settings', body);
    currentUser = await api('GET', '/api/me'); cacheUser(currentUser);
    updateNavCredits();
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = '✅ Saved!'; btn.disabled = true;
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
    }
  } catch (e) { alert(e.message); }
}

async function handleBrowserNotifToggle(checkbox) {
  if (checkbox.checked) {
    if (!('Notification' in window)) { alert('Browser notifications not supported.'); checkbox.checked = false; return; }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { checkbox.checked = false; }
  }
}

// ── Event listeners ────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const page = e.target.closest('[data-page]')?.dataset?.page;
  if (page) { e.preventDefault(); navigate(page); return; }

  const modal = e.target.closest('[data-open]')?.dataset?.open;
  if (modal === 'login-modal') { e.preventDefault(); openLoginModal(); return; }
  if (modal === 'register-modal') { e.preventDefault(); openRegisterModal(); return; }
});

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-overlay')) closeModal();
});

document.getElementById('gear-logout-btn').addEventListener('click', async () => {
  await firebase.auth().signOut();
  currentUser = null;
  clearCachedUser();
  closeGearMenu();
  showLanding();
});

function toggleGearMenu() {
  const dd = document.getElementById('gear-dropdown');
  dd.classList.toggle('hidden');
  if (!dd.classList.contains('hidden')) {
    // Close bell dropdown if open
    document.getElementById('bell-dropdown')?.classList.add('hidden');
  }
}

function closeGearMenu() {
  document.getElementById('gear-dropdown')?.classList.add('hidden');
}

// Close gear dropdown on outside click
document.addEventListener('click', e => {
  if (!document.getElementById('nav-gear')?.contains(e.target)) {
    closeGearMenu();
  }
});

// Browse filters — each filter-row is independent
document.addEventListener('click', e => {
  const btn = e.target.closest('.filter-btn[data-filter-type]');
  if (!btn) return;
  const filterType = btn.dataset.filterType;
  // Deactivate siblings in same row
  btn.closest('.filter-row').querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (filterType === 'type') browseTypeFilter = btn.dataset.filter;
  if (filterType === 'date') browseDateFilter = btn.dataset.filter;
  if (filterType === 'location') browseLocationFilter = btn.dataset.filter;
  if (currentPage === 'browse') loadBrowse();
});

// Type buttons in new request form
document.querySelectorAll('.type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('req-type').value = btn.dataset.type;
  });
});

// New request form
document.getElementById('new-request-form').addEventListener('submit', async e => {
  e.preventDefault();
  const err = document.getElementById('req-error');
  const btn = document.getElementById('req-submit-btn');
  err.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Posting…';
  try {
    const checkedPets = [...document.querySelectorAll('input[name="req-pet-ids"]:checked')].map(cb => cb.value);
    const result = await api('POST', '/api/requests', {
      type: document.getElementById('req-type').value,
      title: document.getElementById('req-title').value,
      pet_ids: checkedPets,
      date: document.getElementById('req-date').value,
      time_window: document.getElementById('req-time').value,
      duration: document.getElementById('req-duration').value,
      credits: document.getElementById('req-credits').value,
      description: document.getElementById('req-desc').value,
      directed_to: document.getElementById('req-directed-to').value || null,
    });
    await refreshUser();
    // Navigate to My Requests so the user can see their new request in the list
    navigate('my-requests');
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Post request';
  }
});

// Add pet button
document.getElementById('add-pet-btn').addEventListener('click', openAddPetModal);

// My requests tabs
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    myRequestsTab = tab.dataset.tab;
    loadMyRequests();
  });
});

// Chat send button
document.addEventListener('click', e => {
  if (e.target.id === 'chat-send') sendChatMessage();
});
document.addEventListener('keydown', e => {
  if (e.target.id === 'chat-input' && e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChatMessage();
  }
});
document.addEventListener('change', e => {
  if (e.target.id === 'chat-img-input' && e.target.files[0]) {
    sendChatImage(e.target.files[0]);
    e.target.value = '';
  }
});

// ── Init ───────────────────────────────────────────────────────────────────
initConfig(); // load app config + start pre-loading Google Maps in background
checkAuth();
