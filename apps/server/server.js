require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const multer = require('multer');
const nodemailer = require('nodemailer');
const admin = require('firebase-admin');
const db = require('./db');

// Firebase Admin SDK — only init if FIREBASE_SERVICE_ACCOUNT is set
let firebaseReady = false;
try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (raw) {
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
    }
    firebaseReady = true;
  } else {
    console.warn('FIREBASE_SERVICE_ACCOUNT not set — auth endpoints will return 503 until configured.');
  }
} catch (e) {
  console.warn('Firebase Admin init failed:', e.message);
}

// Mail transporter — uses Gmail app password from .env
const CONTACT_EMAIL = 'Nekopawz92@gmail.com';
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

const upload = multer({
  dest: path.join(__dirname, '../website/uploads'),
  limits: { fileSize: 8 * 1024 * 1024 } // 8MB
});

const ALLOWED_ORIGINS = [
  'https://www.nekopawz.com',
  'https://nekopawz.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const app = express();

// CORS — allow requests from the frontend
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../website')));

async function requireAuth(req, res, next) {
  if (!firebaseReady) return res.status(503).json({ error: 'Firebase not configured. Add FIREBASE_SERVICE_ACCOUNT to your environment.' });
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = await admin.auth().verifyIdToken(auth.slice(7));
    const user = db.prepare('SELECT id FROM users WHERE firebase_uid = ?').get(decoded.uid);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.userId = user.id;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// /api/register also verifies a token before Firebase is ready check
async function verifyFirebaseToken(req, res) {
  if (!firebaseReady) { res.status(503).json({ error: 'Firebase not configured. Add FIREBASE_SERVICE_ACCOUNT to your environment.' }); return null; }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) { res.status(401).json({ error: 'Authentication required' }); return null; }
  try { return await admin.auth().verifyIdToken(auth.slice(7)); }
  catch { res.status(401).json({ error: 'Invalid token' }); return null; }
}

// Haversine distance in miles between two lat/lng points
function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function formatDistance(miles) {
  if (miles < 0.05) return 'Same building';
  if (miles < 0.1) return '< 0.1 mi away';
  if (miles < 0.3) return `${Math.round(miles * 5280)} ft away`;
  return `${miles.toFixed(1)} mi away`;
}

// Auth — Firebase handles sign-up/sign-in; backend just creates the user profile
app.post('/api/register', async (req, res) => {
  const decoded = await verifyFirebaseToken(req, res);
  if (!decoded) return;

  const { name, building, building_name, address, unit, bio, lat, lng, dob } = req.body;
  if (!name || !building || !address)
    return res.status(400).json({ error: 'All fields required' });
  if (!dob) return res.status(400).json({ error: 'Date of birth is required' });
  const ageMs = Date.now() - new Date(dob).getTime();
  if (ageMs / (365.25 * 24 * 60 * 60 * 1000) < 18)
    return res.status(400).json({ error: 'You must be at least 18 years old to create an account.' });
  const existing = db.prepare('SELECT id FROM users WHERE firebase_uid = ?').get(decoded.uid);
  if (existing) return res.status(400).json({ error: 'Account already exists' });
  const id = uuidv4();
  const latVal = lat != null && lat !== '' ? parseFloat(lat) : null;
  const lngVal = lng != null && lng !== '' ? parseFloat(lng) : null;
  db.prepare(`INSERT INTO users
    (id, name, email, password_hash, firebase_uid, building, building_name, address, unit, bio, credits, lat, lng, dob)
    VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
    .run(id, name, decoded.email || '', decoded.uid, building, building_name || '', address, unit || '', bio || '', latVal, lngVal, dob);
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, building, building_name, address, unit, credits, bio, created_at FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const pets = db.prepare('SELECT * FROM pets WHERE owner_id = ?').all(req.userId);
  res.json({ ...user, pets });
});

// Users
app.get('/api/users/:id', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, building, unit, credits, bio, created_at FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Not found' });
  const pets = db.prepare('SELECT * FROM pets WHERE owner_id = ?').all(req.params.id);
  const reviews = db.prepare(`
    SELECT r.*, u.name as reviewer_name FROM reviews r
    JOIN users u ON r.reviewer_id = u.id
    WHERE r.reviewee_id = ? ORDER BY r.created_at DESC
  `).all(req.params.id);
  const avgRating = reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null;
  res.json({ ...user, pets, reviews, avgRating });
});

// Pets
app.post('/api/pets', requireAuth, (req, res) => {
  const { name, type, breed, age, notes } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Name and type required' });
  const id = uuidv4();
  db.prepare('INSERT INTO pets (id, owner_id, name, type, breed, age, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, req.userId, name, type, breed || '', age || '', notes || '');
  res.json({ id, name, type, breed, age, notes });
});

app.delete('/api/pets/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM pets WHERE id = ? AND owner_id = ?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

// Requests
app.post('/api/requests', requireAuth, (req, res) => {
  const { type, title, description, date, time_window, duration, pet_ids: rawPetIds, directed_to, credits: rawCredits } = req.body;
  if (!type || !title || !date) return res.status(400).json({ error: 'Missing fields' });
  const CREDITS = Math.max(1, Math.min(20, parseInt(rawCredits) || 1));
  const user = db.prepare('SELECT credits, building FROM users WHERE id = ?').get(req.userId);
  if (user.credits < CREDITS) return res.status(400).json({ error: `Not enough credits. You have ${user.credits} but this request needs ${CREDITS}.` });
  // Validate directed_to if provided
  if (directed_to) {
    const target = db.prepare('SELECT id FROM users WHERE id = ?').get(directed_to);
    if (!target) return res.status(400).json({ error: 'Invalid sitter specified.' });
  }
  const petIdsArr = Array.isArray(rawPetIds) ? rawPetIds : (rawPetIds ? [rawPetIds] : []);
  const petIdsStr = petIdsArr.filter(Boolean).join(',');
  const firstPetId = petIdsArr[0] || null;
  const id = uuidv4();
  db.prepare(`INSERT INTO requests (id, requester_id, pet_id, pet_ids, type, title, description, credits, date, time_window, duration, building, directed_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, req.userId, firstPetId, petIdsStr, type, title, description || '', CREDITS, date, time_window || '', duration || '', user.building, directed_to || null);
  // Notify the directed sitter if specified
  if (directed_to) {
    notify(directed_to, 'request', 'New request just for you', `${user.name} sent you a direct pet care request`, id);
  }
  res.json({ id });
});

app.get('/api/requests', requireAuth, (req, res) => {
  const me = db.prepare('SELECT building, lat, lng FROM users WHERE id = ?').get(req.userId);
  const { status, mine, helping, radius } = req.query;

  let query = `
    SELECT r.*, u.name as requester_name, u.unit as requester_unit,
      u.lat as req_lat, u.lng as req_lng, u.building as req_building,
      p.name as pet_name, p.type as pet_type, p.breed as pet_breed, p.notes as pet_notes,
      dt.name as directed_to_name
    FROM requests r
    JOIN users u ON r.requester_id = u.id
    LEFT JOIN pets p ON r.pet_id = p.id
    LEFT JOIN users dt ON r.directed_to = dt.id
    WHERE 1=1
  `;
  const params = [];

  if (mine === 'true') {
    query += ' AND r.requester_id = ?'; params.push(req.userId);
  } else if (helping === 'true') {
    query += ' AND r.helper_id = ?'; params.push(req.userId);
  } else {
    // Only show directed requests if they're directed at the current user
    query += ' AND (r.directed_to IS NULL OR r.directed_to = ?)'; params.push(req.userId);
    if (!radius || radius === 'building') {
      query += ' AND r.building = ? AND r.requester_id != ?';
      params.push(me.building, req.userId);
    } else {
      query += ' AND r.requester_id != ?';
      params.push(req.userId);
    }
  }

  if (status) { query += ' AND r.status = ?'; params.push(status); }
  query += ' ORDER BY r.created_at DESC';

  let requests = db.prepare(query).all(...params);

  // Enrich with all pet names when multiple pets
  requests = requests.map(r => {
    let petNames = r.pet_name || '';
    if (r.pet_ids) {
      const ids = r.pet_ids.split(',').filter(Boolean);
      if (ids.length > 1) {
        const pets = db.prepare(`SELECT name FROM pets WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
        petNames = pets.map(p => p.name).join(' & ');
      }
    }
    return { ...r, petNames };
  });

  // Attach distance and filter by radius
  const radiusMiles = radius && radius !== 'building' ? parseFloat(radius) : null;
  requests = requests.map(r => {
    let distanceMiles = null;
    let distanceLabel = 'Same building';
    if (me.lat != null && me.lng != null && r.req_lat != null && r.req_lng != null) {
      distanceMiles = haversineMiles(me.lat, me.lng, r.req_lat, r.req_lng);
      distanceLabel = formatDistance(distanceMiles);
    } else if (r.req_building === me.building) {
      distanceLabel = 'Same building';
    } else {
      distanceLabel = 'Nearby';
    }
    return { ...r, distanceMiles, distanceLabel };
  });

  if (radiusMiles != null) {
    requests = requests.filter(r => {
      if (r.distanceMiles == null) return r.req_building === me.building;
      return r.distanceMiles <= radiusMiles;
    });
  }

  res.json(requests);
});

app.get('/api/requests/:id', requireAuth, (req, res) => {
  const r = db.prepare(`
    SELECT r.*, u.name as requester_name, u.unit as requester_unit,
      u.address as requester_address, u.building as requester_building,
      p.name as pet_name, p.type as pet_type, p.breed as pet_breed, p.notes as pet_notes,
      dt.name as directed_to_name
    FROM requests r JOIN users u ON r.requester_id = u.id
    LEFT JOIN pets p ON r.pet_id = p.id
    LEFT JOIN users dt ON r.directed_to = dt.id
    WHERE r.id = ?
  `).get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Not found' });
  // Enrich with all pet details for multiple pets
  if (r.pet_ids) {
    const ids = r.pet_ids.split(',').filter(Boolean);
    if (ids.length > 0) {
      r.pets = db.prepare(`SELECT name, type, breed, notes FROM pets WHERE id IN (${ids.map(() => '?').join(',')})`).all(...ids);
      r.petNames = r.pets.map(p => p.name).join(' & ');
    }
  }
  // Viewer's own application (if they're a potential helper)
  const myApp = db.prepare("SELECT status FROM applications WHERE request_id = ? AND applicant_id = ?").get(req.params.id, req.userId);
  r.myApplication = myApp?.status || null;

  // Applications list for the requester
  if (r.requester_id === req.userId && r.status === 'open') {
    const me = db.prepare('SELECT lat, lng, building FROM users WHERE id = ?').get(req.userId);
    const apps = db.prepare(`
      SELECT a.applicant_id as id, a.status, u.name, u.building, u.lat, u.lng,
        ROUND(AVG(rv.rating),1) as avg_rating, COUNT(rv.id) as review_count
      FROM applications a
      JOIN users u ON a.applicant_id = u.id
      LEFT JOIN reviews rv ON rv.reviewee_id = u.id
      WHERE a.request_id = ? AND a.status = 'pending'
      GROUP BY a.applicant_id
      ORDER BY a.created_at ASC
    `).all(req.params.id);

    r.applications = apps.map(a => {
      const sameBuilding = me.building && a.building && me.building === a.building;
      let distanceLabel = null;
      if (!sameBuilding && me.lat && me.lng && a.lat && a.lng) {
        distanceLabel = formatDistance(haversineMiles(me.lat, me.lng, a.lat, a.lng));
      }
      return { ...a, sameBuilding, distanceLabel };
    });
  }

  // Whether the current user has already reviewed this request
  const myReview = db.prepare('SELECT rating FROM reviews WHERE request_id = ? AND reviewer_id = ?').get(req.params.id, req.userId);
  r.alreadyReviewed = myReview ? myReview.rating : null;
  // Helper's average rating and name
  if (r.helper_id) {
    const helperStats = db.prepare(`
      SELECT u.name, ROUND(AVG(rv.rating),1) as avg_rating, COUNT(rv.id) as review_count
      FROM users u LEFT JOIN reviews rv ON rv.reviewee_id = u.id
      WHERE u.id = ?
    `).get(r.helper_id);
    r.helper_name = helperStats?.name;
    r.helper_avg_rating = helperStats?.avg_rating;
    r.helper_review_count = helperStats?.review_count || 0;
  }
  res.json(r);
});

// Helper: create a notification
function notify(userId, type, title, body, requestId = null) {
  try {
    db.prepare('INSERT INTO notifications (id, user_id, type, title, body, request_id) VALUES (?, ?, ?, ?, ?, ?)')
      .run(uuidv4(), userId, type, title, body || '', requestId);
  } catch {}
}

// Volunteer to help (replaces direct accept)
app.post('/api/requests/:id/apply', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });
  if (request.status !== 'open') return res.status(400).json({ error: 'Request no longer open' });
  if (request.requester_id === req.userId) return res.status(400).json({ error: 'Cannot apply to your own request' });
  if (request.directed_to && request.directed_to !== req.userId) return res.status(403).json({ error: 'This request is directed to another sitter' });

  const applicant = db.prepare('SELECT name FROM users WHERE id = ?').get(req.userId);
  try {
    db.prepare('INSERT INTO applications (id, request_id, applicant_id) VALUES (?, ?, ?)').run(uuidv4(), request.id, req.userId);
  } catch (e) {
    return res.status(400).json({ error: 'Already applied' });
  }

  // Auto-approve for directed requests
  if (request.directed_to === req.userId) {
    db.prepare('UPDATE requests SET status = ?, helper_id = ? WHERE id = ?').run('accepted', req.userId, request.id);
    db.prepare("UPDATE applications SET status = 'approved' WHERE request_id = ? AND applicant_id = ?").run(request.id, req.userId);
    notify(request.requester_id, 'accepted', 'Your helper is confirmed!',
      `${applicant.name} accepted your direct request "${request.title}".`, request.id);
    return res.json({ ok: true, autoApproved: true });
  }

  notify(request.requester_id, 'application', 'Someone wants to help!',
    `${applicant.name} volunteered for "${request.title}". Review their profile and approve or decline.`, request.id);
  res.json({ ok: true });
});

// Requester approves an applicant
app.post('/api/requests/:id/approve/:applicantId', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });
  if (request.requester_id !== req.userId) return res.status(403).json({ error: 'Only the requester can approve' });
  if (request.status !== 'open') return res.status(400).json({ error: 'Request no longer open' });

  const app = db.prepare('SELECT * FROM applications WHERE request_id = ? AND applicant_id = ? AND status = ?').get(request.id, req.params.applicantId, 'pending');
  if (!app) return res.status(404).json({ error: 'Application not found' });

  const txn = db.transaction(() => {
    db.prepare('UPDATE requests SET status = ?, helper_id = ? WHERE id = ?').run('accepted', req.params.applicantId, request.id);
    db.prepare("UPDATE applications SET status = 'approved' WHERE request_id = ? AND applicant_id = ?").run(request.id, req.params.applicantId);
    db.prepare("UPDATE applications SET status = 'declined' WHERE request_id = ? AND applicant_id != ?").run(request.id, req.params.applicantId);
  });
  txn();

  const helper = db.prepare('SELECT name FROM users WHERE id = ?').get(req.params.applicantId);
  notify(req.params.applicantId, 'accepted', 'You\'ve been approved!',
    `${helper.name}, your application for "${request.title}" was approved. You can now message the owner.`, request.id);
  // Notify declined applicants
  const declined = db.prepare("SELECT applicant_id FROM applications WHERE request_id = ? AND status = 'declined'").all(request.id);
  declined.forEach(d => notify(d.applicant_id, 'declined', 'Application not selected',
    `Another volunteer was chosen for "${request.title}".`, request.id));
  res.json({ ok: true });
});

// Requester declines an applicant
app.post('/api/requests/:id/decline/:applicantId', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });
  if (request.requester_id !== req.userId) return res.status(403).json({ error: 'Only the requester can decline' });
  db.prepare("UPDATE applications SET status = 'declined' WHERE request_id = ? AND applicant_id = ?").run(request.id, req.params.applicantId);
  notify(req.params.applicantId, 'declined', 'Application not selected',
    `Your application for "${request.title}" was not selected this time.`, request.id);
  res.json({ ok: true });
});

app.post('/api/requests/:id/complete', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });
  if (request.requester_id !== req.userId) return res.status(403).json({ error: 'Only requester can mark complete' });
  if (request.status !== 'accepted') return res.status(400).json({ error: 'Request not accepted yet' });

  const txn = db.transaction(() => {
    db.prepare('UPDATE requests SET status = ? WHERE id = ?').run('completed', request.id);
    db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(request.credits, request.requester_id);
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(request.credits, request.helper_id);
    const txId = uuidv4();
    db.prepare('INSERT INTO transactions (id, from_user_id, to_user_id, credits, request_id) VALUES (?, ?, ?, ?, ?)')
      .run(txId, request.requester_id, request.helper_id, request.credits, request.id);
  });
  txn();
  const requester = db.prepare('SELECT name FROM users WHERE id = ?').get(request.requester_id);
  notify(request.helper_id, 'completed', 'Service completed!',
    `${requester.name} has marked "${request.title}" as complete. ${request.credits} credit${request.credits !== 1 ? 's' : ''} added to your balance.`, request.id);
  notify(request.requester_id, 'completed', 'Service complete — leave a review',
    `Your "${request.title}" is done! Leave a review for your helper.`, request.id);
  res.json({ ok: true });
});

app.post('/api/requests/:id/cancel', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });
  if (request.requester_id !== req.userId) return res.status(403).json({ error: 'Only requester can cancel' });
  if (!['open', 'accepted'].includes(request.status)) return res.status(400).json({ error: 'Cannot cancel' });
  db.prepare('UPDATE requests SET status = ? WHERE id = ?').run('cancelled', request.id);
  res.json({ ok: true });
});

// Reviews
app.post('/api/reviews', requireAuth, (req, res) => {
  const { request_id, reviewee_id, rating, comment } = req.body;
  if (!request_id || !reviewee_id || !rating) return res.status(400).json({ error: 'Missing fields' });
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(request_id);
  if (!request || request.status !== 'completed') return res.status(400).json({ error: 'Request not completed' });
  const isInvolved = request.requester_id === req.userId || request.helper_id === req.userId;
  if (!isInvolved) return res.status(403).json({ error: 'Not involved in this request' });
  const existing = db.prepare('SELECT id FROM reviews WHERE request_id = ? AND reviewer_id = ?').get(request_id, req.userId);
  if (existing) return res.status(400).json({ error: 'Already reviewed' });
  const id = uuidv4();
  db.prepare('INSERT INTO reviews (id, request_id, reviewer_id, reviewee_id, rating, comment) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, request_id, req.userId, reviewee_id, rating, comment || '');
  res.json({ ok: true });
});

// Activity
app.get('/api/activity', requireAuth, (req, res) => {
  const txns = db.prepare(`
    SELECT t.*,
      uf.name as from_name, ut.name as to_name,
      r.title as request_title, r.type as request_type
    FROM transactions t
    JOIN users uf ON t.from_user_id = uf.id
    JOIN users ut ON t.to_user_id = ut.id
    LEFT JOIN requests r ON t.request_id = r.id
    WHERE t.from_user_id = ? OR t.to_user_id = ?
    ORDER BY t.created_at DESC LIMIT 20
  `).all(req.userId, req.userId);
  res.json(txns);
});

// Neighbors
app.get('/api/neighbors', requireAuth, (req, res) => {
  const me = db.prepare('SELECT building, lat, lng FROM users WHERE id = ?').get(req.userId);
  const all = db.prepare(`
    SELECT u.id, u.name, u.building, u.lat, u.lng, u.bio,
      GROUP_CONCAT(p.name || ' (' || p.type || ')') as pets_summary
    FROM users u
    LEFT JOIN pets p ON p.owner_id = u.id
    WHERE u.id != ?
    GROUP BY u.id
    ORDER BY u.name
  `).all(req.userId);

  const neighbors = all
    .map(n => {
      const sameBuilding = me.building && n.building && me.building === n.building;
      let distanceMiles = null;
      if (me.lat && me.lng && n.lat && n.lng) {
        distanceMiles = haversineMiles(me.lat, me.lng, n.lat, n.lng);
      }
      return { ...n, sameBuilding, distanceMiles };
    })
    .filter(n => n.sameBuilding || (n.distanceMiles !== null && n.distanceMiles <= 1))
    .sort((a, b) => {
      // Same building first, then by distance
      if (a.sameBuilding && !b.sameBuilding) return -1;
      if (!a.sameBuilding && b.sameBuilding) return 1;
      return (a.distanceMiles || 0) - (b.distanceMiles || 0);
    });

  res.json(neighbors);
});

// ── Messaging ──────────────────────────────────────────────────────────────
app.get('/api/requests/:id/messages', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });
  const isInvolved = request.requester_id === req.userId || request.helper_id === req.userId;
  if (!isInvolved) return res.status(403).json({ error: 'Not involved' });
  const messages = db.prepare(`
    SELECT m.*, u.name as sender_name
    FROM messages m JOIN users u ON m.sender_id = u.id
    WHERE m.request_id = ? ORDER BY m.created_at ASC
  `).all(req.params.id);
  res.json(messages);
});

app.post('/api/requests/:id/messages', requireAuth, (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });
  if (!['accepted', 'completed'].includes(request.status)) return res.status(400).json({ error: 'Messaging only available for accepted requests' });
  const isInvolved = request.requester_id === req.userId || request.helper_id === req.userId;
  if (!isInvolved) return res.status(403).json({ error: 'Not involved' });
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Message cannot be empty' });
  const id = uuidv4();
  db.prepare('INSERT INTO messages (id, request_id, sender_id, body) VALUES (?, ?, ?, ?)')
    .run(id, req.params.id, req.userId, body.trim());
  // Notify the other party
  const sender = db.prepare('SELECT name FROM users WHERE id = ?').get(req.userId);
  const otherId = request.requester_id === req.userId ? request.helper_id : request.requester_id;
  if (otherId) notify(otherId, 'message', `New message from ${sender.name}`, body.trim().slice(0, 80), req.params.id);
  res.json({ id, body: body.trim(), sender_id: req.userId, sender_name: sender.name, created_at: new Date().toISOString() });
});

app.post('/api/requests/:id/messages/image', requireAuth, upload.single('image'), (req, res) => {
  const request = db.prepare('SELECT * FROM requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Not found' });
  const isInvolved = request.requester_id === req.userId || request.helper_id === req.userId;
  if (!isInvolved) return res.status(403).json({ error: 'Not involved' });
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  const imageUrl = `/uploads/${req.file.filename}`;
  const id = uuidv4();
  db.prepare('INSERT INTO messages (id, request_id, sender_id, body, image_url) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.params.id, req.userId, '', imageUrl);
  const sender = db.prepare('SELECT name FROM users WHERE id = ?').get(req.userId);
  const otherId = request.requester_id === req.userId ? request.helper_id : request.requester_id;
  if (otherId) notify(otherId, 'message', `Photo from ${sender.name}`, '📷 Sent a photo', req.params.id);
  res.json({ id, image_url: imageUrl, sender_id: req.userId, sender_name: sender.name, created_at: new Date().toISOString() });
});

// ── Notifications ──────────────────────────────────────────────────────────
app.get('/api/notifications', requireAuth, (req, res) => {
  const notifs = db.prepare(`
    SELECT * FROM notifications WHERE user_id = ?
    ORDER BY created_at DESC LIMIT 30
  `).all(req.userId);
  const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0').get(req.userId);
  res.json({ notifications: notifs, unread: unread.c });
});

app.post('/api/notifications/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.userId);
  res.json({ ok: true });
});

// ── Upcoming sits (for reminders) ──────────────────────────────────────────
app.get('/api/conversations', requireAuth, (req, res) => {
  const convos = db.prepare(`
    SELECT r.id, r.title, r.type, r.status, r.date,
      req.name as requester_name, req.id as requester_id,
      h.name as helper_name, h.id as helper_id,
      m.body as last_message, m.created_at as last_message_at, m.sender_id as last_sender_id
    FROM requests r
    JOIN users req ON r.requester_id = req.id
    LEFT JOIN users h ON r.helper_id = h.id
    JOIN (
      SELECT request_id, body, created_at, sender_id
      FROM messages
      WHERE id IN (SELECT id FROM messages m2 WHERE m2.request_id = messages.request_id ORDER BY created_at DESC LIMIT 1)
    ) m ON m.request_id = r.id
    WHERE (r.requester_id = ? OR r.helper_id = ?)
    ORDER BY m.created_at DESC
  `).all(req.userId, req.userId);
  res.json(convos);
});

app.get('/api/upcoming', requireAuth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const inThreeDays = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
  const sits = db.prepare(`
    SELECT r.*, u.name as requester_name, u.unit as requester_unit,
      p.name as pet_name, p.type as pet_type
    FROM requests r
    JOIN users u ON r.requester_id = u.id
    LEFT JOIN pets p ON r.pet_id = p.id
    WHERE r.status = 'accepted'
      AND r.date >= ? AND r.date <= ?
      AND (r.requester_id = ? OR r.helper_id = ?)
    ORDER BY r.date ASC
  `).all(today, inThreeDays, req.userId, req.userId);
  res.json(sits);
});

// ── Settings ───────────────────────────────────────────────────────────────
app.get('/api/settings', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, name, email, building, building_name, address, unit, bio, notif_messages, notif_accepted, notif_reminders, notif_browser, ec_name, ec_phone, ec_relation FROM users WHERE id = ?').get(req.userId);
  res.json(user);
});

app.put('/api/settings', requireAuth, (req, res) => {
  const { name, bio, unit, notif_messages, notif_accepted, notif_reminders, notif_browser, ec_name, ec_phone, ec_relation } = req.body;
  db.prepare(`UPDATE users SET
    name = COALESCE(?, name),
    bio = COALESCE(?, bio),
    unit = COALESCE(?, unit),
    notif_messages = ?,
    notif_accepted = ?,
    notif_reminders = ?,
    notif_browser = ?,
    ec_name = ?,
    ec_phone = ?,
    ec_relation = ?
    WHERE id = ?`).run(
    name || null, bio !== undefined ? bio : null, unit || null,
    notif_messages ? 1 : 0, notif_accepted ? 1 : 0,
    notif_reminders ? 1 : 0, notif_browser ? 1 : 0,
    ec_name || '', ec_phone || '', ec_relation || '',
    req.userId
  );
  res.json({ ok: true });
});

// Contact form — sends email to admin, never exposes address to client
app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message)
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  // Check SMTP is configured
  if (!process.env.SMTP_PASS || process.env.SMTP_PASS === 'your_app_password_here') {
    // Dev mode: just log it so the app doesn't error
    console.log('=== CONTACT FORM (SMTP not configured) ===');
    console.log(`From: ${name} <${email}>`);
    console.log(`Subject: ${subject || '(no subject)'}`);
    console.log(`Message:\n${message}`);
    return res.json({ ok: true });
  }
  try {
    await mailer.sendMail({
      from: `"NekoPawz Contact" <${process.env.SMTP_USER}>`,
      to: CONTACT_EMAIL,
      replyTo: email,
      subject: `[NekoPawz] ${subject || 'New message from ' + name}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
      html: `
        <div style="font-family:sans-serif;max-width:560px">
          <h2 style="color:#1a4731">NekoPawz — Contact Form</h2>
          <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
            <tr><td style="padding:6px 0;color:#666;width:80px">Name</td><td style="padding:6px 0;font-weight:600">${name}</td></tr>
            <tr><td style="padding:6px 0;color:#666">Email</td><td style="padding:6px 0"><a href="mailto:${email}">${email}</a></td></tr>
            ${subject ? `<tr><td style="padding:6px 0;color:#666">Subject</td><td style="padding:6px 0">${subject}</td></tr>` : ''}
          </table>
          <div style="background:#f7f8f6;border-left:4px solid #40916c;padding:14px 18px;border-radius:0 8px 8px 0;white-space:pre-wrap">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
        </div>
      `
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Contact email error:', err.message);
    res.status(500).json({ error: 'Failed to send message. Please try again later.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NekoPawz running at http://localhost:${PORT}`));
