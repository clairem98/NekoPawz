// ── State ──────────────────────────────────────────────────────────────────
let currentUser = null;
let currentPage = 'landing';
let browseTypeFilter = 'all';
let browseDateFilter = 'all';
let browseLocationFilter = 'building'; // 'building' or a miles string like '0.5'
let myRequestsTab = 'posted';

// ── Avatar helper ──────────────────────────────────────────────────────────
function avatarHtml(name, avatarUrl, cls = 'neighbor-avatar') {
  if (avatarUrl) return `<img src="${(window.API_BASE||'')}${avatarUrl}" class="${cls} ${cls}-img" alt="${name}" />`;
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
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
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
function checkAuth() {
  firebase.auth().onAuthStateChanged(async fbUser => {
    if (fbUser) {
      try {
        currentUser = await api('GET', '/api/me');
        showApp();
        navigate('dashboard');
      } catch {
        showLanding();
      }
    } else {
      showLanding();
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
    const { unread } = await api('GET', '/api/notifications');
    const badge = document.getElementById('bell-badge');
    if (unread > 0) {
      badge.textContent = unread > 9 ? '9+' : unread;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch {}
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
    document.getElementById('bell-badge').classList.add('hidden');
    if (!notifications.length) {
      dropdown.innerHTML = '<div class="bell-empty">No notifications yet</div>';
    } else {
      dropdown.innerHTML = notifications.slice(0, 10).map(n => `
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
  const greeting = document.getElementById('dashboard-greeting');
  greeting.innerHTML = `Good to see you, <span>${currentUser.name.split(' ')[0]}</span> 👋`;
  document.getElementById('credits-num').textContent = currentUser.credits;

  // Activity
  try {
    const activity = await api('GET', '/api/activity');
    const list = document.getElementById('activity-list');
    if (!activity.length) {
      list.innerHTML = '<p style="color:var(--text-muted);font-size:.85rem">No activity yet.</p>';
    } else {
      list.innerHTML = activity.slice(0, 5).map(t => {
        const earned = t.to_user_id === currentUser.id;
        return `
          <div class="activity-item">
            <div class="activity-icon">${earned ? '✅' : '📤'}</div>
            <div class="activity-text">
              <div>${earned ? `Earned from <strong>${t.from_name}</strong>` : `Paid to <strong>${t.to_name}</strong>`}</div>
              <div style="font-size:.75rem;color:var(--text-muted)">${t.request_title || ''}</div>
            </div>
            <div class="activity-credit ${earned ? 'earned' : 'spent'}">${earned ? '+' : '-'}${t.credits}</div>
          </div>`;
      }).join('');
    }
  } catch {}

  // Upcoming sits reminder
  try {
    const upcoming = await api('GET', '/api/upcoming');
    if (upcoming.length && currentUser.notif_reminders !== 0) {
      const banner = upcoming.map(r => {
        const isHelper = r.helper_id === currentUser.id;
        const label = isHelper ? `You're helping with "${r.title}"` : `"${r.title}" is scheduled`;
        return `<div class="reminder-item" onclick="navigate('request-detail','${r.id}')">
          ⏰ <strong>${label}</strong> on ${r.date}${r.time_window ? ' · ' + r.time_window : ''}
        </div>`;
      }).join('');
      const remindersEl = document.getElementById('dashboard-reminders');
      if (remindersEl) remindersEl.innerHTML = banner;
    }
  } catch {}

  // Open requests nearby (not mine)
  try {
    const requests = await api('GET', '/api/requests?status=open');
    const grid = document.getElementById('dashboard-requests');
    if (!requests.length) {
      grid.innerHTML = '<div class="empty"><p>No open requests nearby right now.</p></div>';
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
      grid.innerHTML = '<div class="empty"><p>No open requests match these filters.</p></div>';
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

// ── Profile ────────────────────────────────────────────────────────────────
async function loadProfile() {
  try {
    const [me, activity] = await Promise.all([
      api('GET', '/api/me'),
      api('GET', '/api/activity')
    ]);
    currentUser = me;
    updateNavCredits();

    // Profile card
    document.getElementById('profile-card').innerHTML = `
      <div class="profile-avatar-wrap">
        ${avatarHtml(me.name, me.avatar_url, 'profile-avatar')}
      </div>
      <div class="profile-info">
        <h2>${me.name}</h2>
        <p>${me.unit ? 'Unit ' + me.unit + ' · ' : ''}${me.building_name || me.building}</p>
        ${me.bio ? `<p style="margin-top:6px;color:var(--text)">${me.bio}</p>` : ''}
      </div>
    `;

    // Credits summary card
    const earned = activity.filter(t => t.to_user_id === me.id).reduce((s, t) => s + t.credits, 0);
    const spent  = activity.filter(t => t.from_user_id === me.id).reduce((s, t) => s + t.credits, 0);
    document.getElementById('profile-credits-card').innerHTML = `
      <div class="pcredit-balance">
        <div class="pcredit-num">${me.credits}</div>
        <div class="pcredit-label">credits available</div>
      </div>
      <div class="pcredit-stats">
        <div class="pcredit-stat">
          <span class="pcredit-stat-val pcredit-earned">+${earned}</span>
          <span class="pcredit-stat-key">earned</span>
        </div>
        <div class="pcredit-divider"></div>
        <div class="pcredit-stat">
          <span class="pcredit-stat-val pcredit-spent">−${spent}</span>
          <span class="pcredit-stat-key">spent</span>
        </div>
      </div>
    `;

    // Credit history
    const histEl = document.getElementById('profile-credit-history');
    if (!activity.length) {
      histEl.innerHTML = '<p class="empty" style="padding:24px 0">No credit transactions yet.</p>';
    } else {
      histEl.innerHTML = `
        <div class="credit-history-list">
          ${activity.map(t => {
            const isEarned = t.to_user_id === me.id;
            const other = isEarned ? t.from_name : t.to_name;
            const label = isEarned
              ? `Earned from ${other}`
              : `Spent on care for ${other}`;
            const icon  = isEarned ? petEmoji(t.request_type || 'other') : '🐾';
            return `
              <div class="ch-item">
                <div class="ch-icon">${icon}</div>
                <div class="ch-body">
                  <div class="ch-label">${label}</div>
                  ${t.request_title ? `<div class="ch-sub">${t.request_title}</div>` : ''}
                  <div class="ch-date">${timeAgo(t.created_at)}</div>
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
  } catch (e) { console.error(e); }
}

function renderPets(pets) {
  const list = document.getElementById('pets-list');
  if (!pets.length) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:.9rem">No pets added yet.</p>';
    return;
  }
  list.innerHTML = pets.map(p => `
    <div class="pet-item">
      <div class="pet-info">
        <div class="pet-emoji">${petEmoji(p.type)}</div>
        <div>
          <div class="pet-name">${p.name}</div>
          <div class="pet-desc">${[p.type, p.breed, p.age ? p.age + ' yrs' : ''].filter(Boolean).join(' · ')}</div>
          ${p.notes ? `<div class="pet-desc">${p.notes}</div>` : ''}
        </div>
      </div>
      <button class="delete-btn" onclick="deletePet('${p.id}')">✕</button>
    </div>
  `).join('');
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
      list.innerHTML = '<div class="empty"><p>No conversations yet. Conversations start once a request is accepted.</p></div>';
      return;
    }
    list.innerHTML = convos.map(c => {
      const otherId = c.requester_id === currentUser.id ? c.helper_id : c.requester_id;
      const otherName = c.requester_id === currentUser.id ? (c.helper_name || 'Helper') : c.requester_name;
      const isMine = c.last_sender_id === currentUser.id;
      const preview = isMine ? `You: ${c.last_message}` : c.last_message;
      return `
        <div class="convo-item" onclick="navigate('request-detail','${c.id}')">
          <div class="convo-avatar">${otherName[0].toUpperCase()}</div>
          <div class="convo-body">
            <div class="convo-top">
              <span class="convo-name">${otherName}</span>
              <span class="convo-time">${timeAgo(c.last_message_at)}</span>
            </div>
            <div class="convo-title">${typeLabel(c.type)} · ${c.title}</div>
            <div class="convo-preview">${preview}</div>
          </div>
          <span class="req-status status-${c.status}">${c.status}</span>
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
      grid.innerHTML = '<div class="empty"><p>No other neighbors have joined yet. Spread the word!</p></div>';
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
  try {
    const url = myRequestsTab === 'posted' ? '/api/requests?mine=true' : '/api/requests?helping=true';
    const requests = await api('GET', url);
    const list = document.getElementById('my-requests-list');
    if (!requests.length) {
      list.innerHTML = '<div class="empty"><p>Nothing here yet.</p></div>';
    } else {
      list.innerHTML = requests.map(r => requestCard(r, true)).join('');
    }
  } catch {}
}

// ── Request Detail ─────────────────────────────────────────────────────────
async function loadRequestDetail(id) {
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
  currentUser = await api('GET', '/api/me');
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
              <div class="pet-emoji">${petEmoji(p.type)}</div>
              <div>
                <div class="pet-name">${p.name}</div>
                <div class="pet-desc">${[p.type, p.breed, p.age ? p.age + ' yrs' : ''].filter(Boolean).join(' · ')}</div>
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
  const provider = new firebase.auth.GoogleAuthProvider();
  let cred;
  try {
    cred = await firebase.auth().signInWithPopup(provider);
  } catch (ex) {
    return { error: ex.message };
  }
  // Check if this Google user already has a backend profile
  try {
    currentUser = await api('GET', '/api/me');
    closeModal();
    showApp();
    navigate('dashboard');
  } catch {
    // New Google user — collect missing profile fields
    openCompleteProfileModal(cred.user.displayName || '');
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
      currentUser = await api('GET', '/api/me');
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
        <input type="email" id="l-email" placeholder="you@email.com" required />
      </div>
      <div class="form-row">
        <label>Password</label>
        <input type="password" id="l-password" placeholder="Password" required />
      </div>
      <div id="login-error" class="error-msg hidden"></div>
      <button type="submit" class="btn-primary full-width">Sign in</button>
      <p style="text-align:center;margin-top:16px;font-size:.85rem;color:var(--text-muted)">
        No account? <a href="#" data-open="register-modal">Create one →</a>
      </p>
    </form>
  `);
  document.getElementById('google-signin-btn').addEventListener('click', async () => {
    const result = await signInWithGoogle();
    if (result?.error) {
      const err = document.getElementById('login-error');
      if (err) { err.textContent = result.error; err.classList.remove('hidden'); }
    }
  });
  document.getElementById('login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('login-error');
    try {
      await firebase.auth().signInWithEmailAndPassword(
        document.getElementById('l-email').value,
        document.getElementById('l-password').value
      );
      currentUser = await api('GET', '/api/me');
      closeModal();
      showApp();
      navigate('dashboard');
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
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
        <label>Building address</label>
        <div class="address-input-wrap">
          <input type="text" id="r-address" placeholder="Start typing your address…" autocomplete="off" required />
          <button type="button" class="detect-location-btn" id="detect-location-btn" title="Detect my location">
            <span id="detect-icon">📍</span>
          </button>
        </div>
        <div id="address-suggestions" class="address-suggestions hidden"></div>
        <div id="detect-status" class="detect-status hidden"></div>
        <input type="hidden" id="r-building" />
        <input type="hidden" id="r-lat" />
        <input type="hidden" id="r-lng" />
      </div>
      <div class="form-row">
        <label>Building name <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
        <input type="text" id="r-building-name" placeholder="e.g. The Waverly, Sunrise Apartments" />
      </div>
      <div class="form-row">
        <label>Unit number <span style="font-weight:400;color:var(--text-muted)">(optional)</span></label>
        <input type="text" id="r-unit" placeholder="4B" />
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

  // Address autocomplete via OpenStreetMap Nominatim
  let debounceTimer;
  const addressInput = document.getElementById('r-address');
  const suggestionsBox = document.getElementById('address-suggestions');

  addressInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = addressInput.value.trim();
    if (q.length < 4) { suggestionsBox.classList.add('hidden'); return; }
    debounceTimer = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&addressdetails=1&limit=6`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const results = await res.json();
        if (!results.length) { suggestionsBox.classList.add('hidden'); return; }
        suggestionsBox.innerHTML = results.map((r, i) =>
          `<div class="suggestion-item" data-index="${i}" data-lat="${r.lat}" data-lng="${r.lon}" data-display="${r.display_name}">
            <span class="suggestion-icon">${suggestionIcon(r.type, r.class)}</span>
            <span>${r.display_name}</span>
          </div>`
        ).join('');
        suggestionsBox.classList.remove('hidden');
        // Store results for click handler
        suggestionsBox._results = results;
      } catch {}
    }, 350);
  });

  suggestionsBox.addEventListener('click', e => {
    const item = e.target.closest('.suggestion-item');
    if (!item) return;
    const display = item.dataset.display;
    const lat = item.dataset.lat;
    const lng = item.dataset.lng;
    addressInput.value = display;
    document.getElementById('r-building').value = display; // normalized building key
    document.getElementById('r-lat').value = lat;
    document.getElementById('r-lng').value = lng;
    suggestionsBox.classList.add('hidden');
  });

  // Geolocation detect button
  document.getElementById('detect-location-btn').addEventListener('click', () => {
    const btn = document.getElementById('detect-location-btn');
    const icon = document.getElementById('detect-icon');
    const status = document.getElementById('detect-status');
    btn.disabled = true;
    icon.textContent = '⏳';
    status.textContent = 'Detecting your location…';
    status.className = 'detect-status detecting';

    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude: lat, longitude: lng } = pos.coords;
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json();
        const display = data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        document.getElementById('r-address').value = display;
        document.getElementById('r-building').value = display;
        document.getElementById('r-lat').value = lat;
        document.getElementById('r-lng').value = lng;
        icon.textContent = '✅';
        status.textContent = 'Location detected — you can edit the address above if needed.';
        status.className = 'detect-status success';
      } catch {
        icon.textContent = '📍';
        status.textContent = 'Located you but could not fetch address. Try typing it manually.';
        status.className = 'detect-status error';
        btn.disabled = false;
      }
    }, () => {
      icon.textContent = '📍';
      status.textContent = 'Location access denied. Please type your address.';
      status.className = 'detect-status error';
      btn.disabled = false;
    });
  });

  // Close suggestions on outside click
  document.addEventListener('click', e => {
    if (!e.target.closest('#r-address') && !e.target.closest('#address-suggestions')) {
      suggestionsBox.classList.add('hidden');
    }
  }, { once: false });

  document.getElementById('google-register-btn').addEventListener('click', () => signInWithGoogle());

  document.getElementById('reg-form').addEventListener('submit', async e => {
    e.preventDefault();
    const err = document.getElementById('reg-error');
    const building = document.getElementById('r-building').value || document.getElementById('r-address').value;
    const address = document.getElementById('r-address').value;
    if (!address) { err.textContent = 'Please enter your address.'; err.classList.remove('hidden'); return; }
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
          lat: document.getElementById('r-lat').value || null,
          lng: document.getElementById('r-lng').value || null,
          dob
        });
      } catch (profileErr) {
        // Backend profile creation failed — delete the Firebase account so the user can retry
        await firebase.auth().currentUser?.delete();
        throw profileErr;
      }
      currentUser = await api('GET', '/api/me');
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
  // Show unit only if it's my own request or I'm the accepted helper
  const isInvolved = r.requester_id === currentUser?.id || r.helper_id === currentUser?.id;
  const confirmed = isInvolved && r.status !== 'open';
  const sameBuilding = r.distanceLabel === 'Same building' || r.req_building === currentUser?.building;
  let locationHint;
  if (confirmed) {
    // After confirmation: show unit + building context
    locationHint = sameBuilding
      ? `<span>Unit ${r.requester_unit} · Same building</span>`
      : `<span>${r.requester_address || r.distanceLabel}</span>`;
  } else {
    // Before confirmation: same building is fine to show, but no unit; others show distance only
    locationHint = sameBuilding
      ? `<span>Same building</span>`
      : `<span title="Address revealed after confirmation">📍 ${r.distanceLabel || 'Nearby'}</span>`;
  }

  return `
    <div class="request-card" onclick="navigate('request-detail','${r.id}')">
      <div class="req-header">
        <span class="req-type-badge">${typeLabel(r.type)}</span>
        <span class="req-credits-badge">${r.credits || 1} cr</span>
      </div>
      <div class="req-title">${r.title}</div>
      <div class="req-meta">
        <span>📅 ${r.date}</span>
        ${r.time_window ? `<span>🕐 ${r.time_window}</span>` : ''}
        ${r.duration ? `<span>⏱ ${r.duration}</span>` : ''}
        ${(r.petNames || r.pet_name) ? `<span>${petEmoji(r.pet_type)} ${r.petNames || r.pet_name}${r.pet_breed ? ` · ${r.pet_breed}` : ''}</span>` : ''}
        ${locationHint}
      </div>
      ${r.pet_notes ? `<div class="req-pet-notes">${r.pet_notes}</div>` : ''}
      ${r.directed_to ? `<span class="directed-badge">For you</span>` : ''}
      ${showStatus ? `<span class="req-status status-${r.status}">${r.status}</span>` : ''}
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
  try {
    const res = await fetch(`/api/requests/${chatRequestId}/messages/image`, {
      method: 'POST', body: formData, credentials: 'include'
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
              <p style="font-size:.78rem;color:var(--text-muted);margin-top:4px">JPG, PNG or GIF · max 4 MB</p>
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
          <div class="form-row">
            <label>Address</label>
            <input type="text" value="${s.address || s.building}" disabled style="color:var(--text-muted)" />
            <p style="font-size:.78rem;color:var(--text-muted);margin-top:4px">To change your address, contact support.</p>
          </div>
          <button class="btn-primary" onclick="saveSettings()">Save profile</button>
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
          <button class="btn-primary" style="margin-top:8px" onclick="saveSettings()">Save notifications</button>
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
          <button class="btn-primary" onclick="saveSettings()">Save emergency contact</button>
        </div>
      </div>
    `;
  } catch (e) { document.getElementById('settings-content').innerHTML = `<p class="error-msg">${e.message}</p>`; }
}

async function uploadAvatar(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) { alert('Image must be under 4 MB'); input.value = ''; return; }
  const formData = new FormData();
  formData.append('avatar', file);
  const fbUser = firebase.auth().currentUser;
  const headers = {};
  if (fbUser) headers['Authorization'] = `Bearer ${await fbUser.getIdToken()}`;
  try {
    const res = await fetch((window.API_BASE || '') + '/api/avatar', { method: 'POST', headers, body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    currentUser = await api('GET', '/api/me');
    const preview = document.getElementById('avatar-preview');
    if (preview) preview.innerHTML = avatarHtml(currentUser.name, currentUser.avatar_url, 'settings-avatar');
  } catch (e) { alert('Upload failed: ' + e.message); }
}

async function saveSettings() {
  try {
    await api('PUT', '/api/settings', {
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
    });
    currentUser = await api('GET', '/api/me');
    updateNavCredits();
    // Show brief confirmation
    const btn = event.target;
    const orig = btn.textContent;
    btn.textContent = '✅ Saved!'; btn.disabled = true;
    setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2000);
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
  err.classList.add('hidden');
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
    navigate('request-detail', result.id);
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove('hidden');
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
checkAuth();
