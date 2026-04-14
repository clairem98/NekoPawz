require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const express    = require('express');
const { v4: uuidv4 } = require('uuid');
const path       = require('path');
const multer     = require('multer');
const nodemailer = require('nodemailer');
const admin      = require('firebase-admin');
const cloudinary = require('cloudinary').v2;

// ── Firebase Admin ──────────────────────────────────────────────────────────
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}
const db = admin.firestore();

// ── Cloudinary ──────────────────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ── Mail transporter ────────────────────────────────────────────────────────
const CONTACT_EMAIL = 'Nekopawz92@gmail.com';
const mailer = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
});

// ── Multer — memory storage (files go to Cloudinary, not disk) ───────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }
});

// ── CORS ────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://www.nekopawz.com',
  'https://nekopawz.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../website')));

// ── Auth middleware ──────────────────────────────────────────────────────────
async function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const decoded = await admin.auth().verifyIdToken(auth.slice(7));
    const snap = await db.collection('users').where('firebase_uid', '==', decoded.uid).limit(1).get();
    if (snap.empty) return res.status(401).json({ error: 'User not found' });
    req.userId = snap.docs[0].data().id;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Firestore helpers ────────────────────────────────────────────────────────
async function getUser(id) {
  const doc = await db.collection('users').doc(id).get();
  return doc.exists ? doc.data() : null;
}

async function getUserPets(userId) {
  const snap = await db.collection('pets').where('owner_id', '==', userId).get();
  return snap.docs.map(d => d.data());
}

// ── Distance helpers ─────────────────────────────────────────────────────────
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
  if (miles < 0.1)  return '< 0.1 mi away';
  if (miles < 0.3)  return `${Math.round(miles * 5280)} ft away`;
  return `${miles.toFixed(1)} mi away`;
}

// ── Notification helper ──────────────────────────────────────────────────────
function notify(userId, type, title, body, requestId = null) {
  const id = uuidv4();
  db.collection('notifications').doc(id).set({
    id, user_id: userId, type, title, body: body || '',
    request_id: requestId, read: false,
    created_at: new Date().toISOString()
  }).catch(() => {});
}

// ── Name-masking helpers ─────────────────────────────────────────────────────
// Returns "FirstName L." unless showFull is true
function maskName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/);
  if (parts.length < 2) return fullName;
  return parts[0] + ' ' + parts[parts.length - 1][0].toUpperCase() + '.';
}

// Returns true if the two users have an accepted or completed request together
async function confirmedRelationship(userId1, userId2) {
  const [s1, s2] = await Promise.all([
    db.collection('requests').where('requester_id', '==', userId1).where('helper_id', '==', userId2).get(),
    db.collection('requests').where('requester_id', '==', userId2).where('helper_id', '==', userId1).get(),
  ]);
  return [...s1.docs, ...s2.docs].some(d => ['accepted', 'completed'].includes(d.data().status));
}

// ── Cloudinary upload helper ─────────────────────────────────────────────────
function uploadToCloudinary(buffer, folder, options = {}) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, ...options },
      (err, result) => { if (err) reject(err); else resolve(result); }
    );
    stream.end(buffer);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// AUTH & PROFILE
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/register', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  let decoded;
  try { decoded = await admin.auth().verifyIdToken(auth.slice(7)); }
  catch { return res.status(401).json({ error: 'Invalid token' }); }

  const { name, building, building_name, address, unit, bio, lat, lng, dob } = req.body;
  if (!name || !building || !address) return res.status(400).json({ error: 'All fields required' });
  if (!dob) return res.status(400).json({ error: 'Date of birth is required' });
  if ((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000) < 18)
    return res.status(400).json({ error: 'You must be at least 18 years old to create an account.' });

  const existing = await db.collection('users').where('firebase_uid', '==', decoded.uid).limit(1).get();
  if (!existing.empty) return res.status(400).json({ error: 'Account already exists' });

  const id = uuidv4();
  await db.collection('users').doc(id).set({
    id, name, email: decoded.email || '', firebase_uid: decoded.uid,
    building, building_name: building_name || '', address, unit: unit || '',
    bio: bio || '', credits: 1, avatar_url: null,
    lat: lat != null && lat !== '' ? parseFloat(lat) : null,
    lng: lng != null && lng !== '' ? parseFloat(lng) : null,
    dob,
    ec_name: '', ec_phone: '', ec_relation: '',
    notif_messages: 1, notif_accepted: 1, notif_reminders: 1, notif_browser: 0,
    created_at: new Date().toISOString()
  });
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, async (req, res) => {
  const user = await getUser(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const pets = await getUserPets(req.userId);
  // Strip private fields from the /me response
  const { ec_name, ec_phone, ec_relation, dob, firebase_uid, ...safe } = user;
  res.json({ ...safe, pets });
});

app.post('/api/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  try {
    const result = await uploadToCloudinary(req.file.buffer, 'nekopawz/avatars', {
      transformation: [{ width: 200, height: 200, crop: 'fill', gravity: 'face' }]
    });
    await db.collection('users').doc(req.userId).update({ avatar_url: result.secure_url });
    res.json({ ok: true, avatar_url: result.secure_url });
  } catch (e) {
    res.status(500).json({ error: 'Upload failed: ' + e.message });
  }
});

app.get('/api/users/:id', requireAuth, async (req, res) => {
  try {
    const user = await getUser(req.params.id);
    if (!user) return res.status(404).json({ error: 'Not found' });
    const [pets, reviewsSnap] = await Promise.all([
      getUserPets(req.params.id),
      db.collection('reviews').where('reviewee_id', '==', req.params.id).get(),
    ]);
    let reviews = await Promise.all(reviewsSnap.docs.map(async d => {
      const rv = d.data();
      const reviewer = await getUser(rv.reviewer_id);
      // Always mask reviewer last names for all viewers
      return { ...rv, reviewer_name: maskName(reviewer?.name || 'Unknown') };
    }));
    reviews.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const avgRating = reviews.length
      ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null;
    const { ec_name, ec_phone, ec_relation, dob, firebase_uid, email, address, ...safe } = user;
    // Always mask last name — last names are never shown to other users
    res.json({ ...safe, name: maskName(safe.name), pets, reviews, avgRating });
  } catch (e) {
    console.error('GET /api/users/:id error:', e);
    res.status(500).json({ error: 'Failed to load user profile.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// PETS
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/pets', requireAuth, async (req, res) => {
  const { name, type, breed, age, notes } = req.body;
  if (!name || !type) return res.status(400).json({ error: 'Name and type required' });
  const id = uuidv4();
  const pet = { id, owner_id: req.userId, name, type, breed: breed || '', age: age || '', notes: notes || '' };
  await db.collection('pets').doc(id).set(pet);
  res.json(pet);
});

app.delete('/api/pets/:id', requireAuth, async (req, res) => {
  const doc = await db.collection('pets').doc(req.params.id).get();
  if (!doc.exists || doc.data().owner_id !== req.userId)
    return res.status(403).json({ error: 'Not allowed' });
  await db.collection('pets').doc(req.params.id).delete();
  res.json({ ok: true });
});

app.post('/api/pets/:id/photo', requireAuth, upload.single('photo'), async (req, res) => {
  const doc = await db.collection('pets').doc(req.params.id).get();
  if (!doc.exists || doc.data().owner_id !== req.userId)
    return res.status(403).json({ error: 'Not allowed' });
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  try {
    const result = await uploadToCloudinary(req.file.buffer, 'nekopawz/pets', {
      transformation: [{ width: 400, height: 400, crop: 'fill', gravity: 'auto' }]
    });
    await db.collection('pets').doc(req.params.id).update({ photo_url: result.secure_url });
    res.json({ ok: true, photo_url: result.secure_url });
  } catch (e) {
    res.status(500).json({ error: 'Upload failed: ' + e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// REQUESTS
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/requests', requireAuth, async (req, res) => {
  const { type, title, description, date, time_window, duration,
          pet_ids: rawPetIds, directed_to, credits: rawCredits } = req.body;
  if (!type || !title || !date) return res.status(400).json({ error: 'Missing fields' });
  const CREDITS = Math.max(1, Math.min(20, parseInt(rawCredits) || 1));
  const user = await getUser(req.userId);
  if (user.credits < CREDITS)
    return res.status(400).json({ error: `Not enough credits. You have ${user.credits} but this request needs ${CREDITS}.` });

  let directed_to_name = null;
  if (directed_to) {
    const target = await getUser(directed_to);
    if (!target) return res.status(400).json({ error: 'Invalid sitter specified.' });
    directed_to_name = target.name;
  }

  const petIdsArr = Array.isArray(rawPetIds) ? rawPetIds : (rawPetIds ? [rawPetIds] : []);
  let petNames = '';
  if (petIdsArr.length > 0) {
    const petDocs = await Promise.all(petIdsArr.map(pid => db.collection('pets').doc(pid).get()));
    petNames = petDocs.filter(d => d.exists).map(d => d.data().name).join(' & ');
  }

  const id = uuidv4();
  await db.collection('requests').doc(id).set({
    id,
    requester_id: req.userId, requester_name: user.name,
    requester_unit: user.unit || '', requester_address: user.address,
    requester_building: user.building,
    type, title, description: description || '', credits: CREDITS,
    date, time_window: time_window || '', duration: duration || '',
    status: 'open', helper_id: null, helper_name: null,
    directed_to: directed_to || null, directed_to_name,
    pet_ids: petIdsArr, pet_names: petNames,
    building: user.building,
    // Store requester coordinates so distance filtering works in /api/requests
    req_lat: user.lat || null,
    req_lng: user.lng || null,
    last_message: null, last_message_at: null, last_sender_id: null,
    created_at: new Date().toISOString()
  });

  if (directed_to) {
    notify(directed_to, 'request', 'New request just for you',
      `${user.name} sent you a direct pet care request`, id);
  }
  res.json({ id });
});

app.get('/api/requests', requireAuth, async (req, res) => {
  try {
  const { status, mine, helping, radius } = req.query;
  const me = await getUser(req.userId);
  let snap;

  if (mine === 'true') {
    let q = db.collection('requests').where('requester_id', '==', req.userId);
    if (status) q = q.where('status', '==', status);
    snap = await q.get();
  } else if (helping === 'true') {
    let q = db.collection('requests').where('helper_id', '==', req.userId);
    if (status) q = q.where('status', '==', status);
    snap = await q.get();
  } else {
    let q = db.collection('requests').where('status', '==', status || 'open');
    if (!radius || radius === 'building') q = q.where('building', '==', me.building);
    snap = await q.get();
  }

  let requests = snap.docs.map(d => d.data());
  requests.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  if (mine !== 'true' && helping !== 'true') {
    requests = requests.filter(r => r.requester_id !== req.userId);
    requests = requests.filter(r => !r.directed_to || r.directed_to === req.userId);
  }

  const radiusMiles = radius && radius !== 'building' ? parseFloat(radius) : null;
  requests = requests.map(r => {
    let distanceMiles = null;
    let distanceLabel = 'Same building';
    if (me.lat && me.lng && r.req_lat && r.req_lng) {
      distanceMiles = haversineMiles(me.lat, me.lng, r.req_lat, r.req_lng);
      distanceLabel = formatDistance(distanceMiles);
    } else if (r.requester_building === me.building) {
      distanceLabel = 'Same building';
    } else {
      distanceLabel = 'Nearby';
    }
    return { ...r, petNames: r.pet_names, req_building: r.requester_building,
             distanceMiles, distanceLabel };
  });

  if (radiusMiles != null) {
    requests = requests.filter(r =>
      r.distanceMiles == null ? r.requester_building === me.building : r.distanceMiles <= radiusMiles
    );
  }

  res.json(requests);
  } catch (e) {
    console.error('GET /api/requests error:', e);
    res.status(500).json({ error: 'Failed to load requests.' });
  }
});

app.get('/api/requests/:id', requireAuth, async (req, res) => {
  try {
  const rdoc = await db.collection('requests').doc(req.params.id).get();
  if (!rdoc.exists) return res.status(404).json({ error: 'Not found' });
  const r = { ...rdoc.data() };

  if (r.pet_ids && r.pet_ids.length > 0) {
    const petDocs = await Promise.all(r.pet_ids.map(pid => db.collection('pets').doc(pid).get()));
    r.pets = petDocs.filter(d => d.exists).map(d => d.data());
    r.petNames = r.pets.map(p => p.name).join(' & ');
    r.pet_name  = r.pets[0]?.name || '';
    r.pet_type  = r.pets[0]?.type || '';
  }

  const myAppSnap = await db.collection('applications')
    .where('request_id', '==', req.params.id)
    .where('applicant_id', '==', req.userId).limit(1).get();
  r.myApplication = myAppSnap.empty ? null : myAppSnap.docs[0].data().status;

  if (r.requester_id === req.userId && r.status === 'open') {
    const me = await getUser(req.userId);
    const appsSnap = await db.collection('applications')
      .where('request_id', '==', req.params.id)
      .where('status', '==', 'pending').get();
    r.applications = await Promise.all(appsSnap.docs.map(async d => {
      const app = d.data();
      const applicant = await getUser(app.applicant_id);
      const revSnap = await db.collection('reviews').where('reviewee_id', '==', app.applicant_id).get();
      const revs = revSnap.docs.map(d => d.data());
      const avg_rating = revs.length ? (revs.reduce((s, r) => s + r.rating, 0) / revs.length).toFixed(1) : null;
      const sameBuilding = me.building && applicant?.building && me.building === applicant.building;
      let distanceLabel = null;
      if (!sameBuilding && me.lat && me.lng && applicant?.lat && applicant?.lng)
        distanceLabel = formatDistance(haversineMiles(me.lat, me.lng, applicant.lat, applicant.lng));
      return { ...app, name: applicant?.name || app.applicant_name,
               building: applicant?.building, lat: applicant?.lat, lng: applicant?.lng,
               avg_rating, review_count: revs.length, sameBuilding, distanceLabel };
    }));
  }

  const myReviewSnap = await db.collection('reviews')
    .where('request_id', '==', req.params.id)
    .where('reviewer_id', '==', req.userId).limit(1).get();
  r.alreadyReviewed = myReviewSnap.empty ? null : myReviewSnap.docs[0].data().rating;

  if (r.helper_id) {
    const helper = await getUser(r.helper_id);
    const helperRevs = (await db.collection('reviews').where('reviewee_id', '==', r.helper_id).get()).docs.map(d => d.data());
    r.helper_name = helper?.name;
    r.helper_avg_rating = helperRevs.length
      ? (helperRevs.reduce((s, rv) => s + rv.rating, 0) / helperRevs.length).toFixed(1) : null;
    r.helper_review_count = helperRevs.length;
  }

  res.json(r);
  } catch (e) {
    console.error('GET /api/requests/:id error:', e);
    res.status(500).json({ error: 'Failed to load request.' });
  }
});

app.post('/api/requests/:id/apply', requireAuth, async (req, res) => {
  const rdoc = await db.collection('requests').doc(req.params.id).get();
  if (!rdoc.exists) return res.status(404).json({ error: 'Not found' });
  const request = rdoc.data();
  if (request.status !== 'open') return res.status(400).json({ error: 'Request no longer open' });
  if (request.requester_id === req.userId) return res.status(400).json({ error: 'Cannot apply to your own request' });
  if (request.directed_to && request.directed_to !== req.userId)
    return res.status(403).json({ error: 'This request is directed to another sitter' });

  const existingApp = await db.collection('applications')
    .where('request_id', '==', req.params.id)
    .where('applicant_id', '==', req.userId).limit(1).get();
  if (!existingApp.empty) return res.status(400).json({ error: 'Already applied' });

  const applicant = await getUser(req.userId);
  const appId = uuidv4();
  await db.collection('applications').doc(appId).set({
    id: appId, request_id: req.params.id,
    applicant_id: req.userId, applicant_name: applicant.name,
    status: 'pending', created_at: new Date().toISOString()
  });

  if (request.directed_to === req.userId) {
    await db.collection('requests').doc(req.params.id).update({ status: 'accepted', helper_id: req.userId, helper_name: applicant.name });
    await db.collection('applications').doc(appId).update({ status: 'approved' });
    notify(request.requester_id, 'accepted', 'Your helper is confirmed!',
      `${applicant.name} accepted your direct request "${request.title}".`, req.params.id);
    return res.json({ ok: true, autoApproved: true });
  }

  notify(request.requester_id, 'application', 'Someone wants to help!',
    `${applicant.name} volunteered for "${request.title}". Review their profile and approve or decline.`, req.params.id);
  res.json({ ok: true });
});

app.post('/api/requests/:id/approve/:applicantId', requireAuth, async (req, res) => {
  const rdoc = await db.collection('requests').doc(req.params.id).get();
  if (!rdoc.exists) return res.status(404).json({ error: 'Not found' });
  const request = rdoc.data();
  if (request.requester_id !== req.userId) return res.status(403).json({ error: 'Only the requester can approve' });
  if (request.status !== 'open') return res.status(400).json({ error: 'Request no longer open' });

  const appSnap = await db.collection('applications')
    .where('request_id', '==', req.params.id)
    .where('applicant_id', '==', req.params.applicantId)
    .where('status', '==', 'pending').limit(1).get();
  if (appSnap.empty) return res.status(404).json({ error: 'Application not found' });

  const helper = await getUser(req.params.applicantId);
  await db.collection('requests').doc(req.params.id).update({ status: 'accepted', helper_id: req.params.applicantId, helper_name: helper?.name });
  await appSnap.docs[0].ref.update({ status: 'approved' });

  const othersSnap = await db.collection('applications')
    .where('request_id', '==', req.params.id).where('status', '==', 'pending').get();
  await Promise.all(othersSnap.docs.map(d => d.ref.update({ status: 'declined' })));

  notify(req.params.applicantId, 'accepted', "You've been approved!",
    `Your application for "${request.title}" was approved. You can now message the owner.`, req.params.id);
  othersSnap.docs.forEach(d =>
    notify(d.data().applicant_id, 'declined', 'Application not selected',
      `Another volunteer was chosen for "${request.title}".`, req.params.id)
  );
  res.json({ ok: true });
});

app.post('/api/requests/:id/decline/:applicantId', requireAuth, async (req, res) => {
  const rdoc = await db.collection('requests').doc(req.params.id).get();
  if (!rdoc.exists) return res.status(404).json({ error: 'Not found' });
  if (rdoc.data().requester_id !== req.userId) return res.status(403).json({ error: 'Only the requester can decline' });
  const appSnap = await db.collection('applications')
    .where('request_id', '==', req.params.id)
    .where('applicant_id', '==', req.params.applicantId).limit(1).get();
  if (!appSnap.empty) await appSnap.docs[0].ref.update({ status: 'declined' });
  notify(req.params.applicantId, 'declined', 'Application not selected',
    `Your application for "${rdoc.data().title}" was not selected this time.`, req.params.id);
  res.json({ ok: true });
});

app.post('/api/requests/:id/complete', requireAuth, async (req, res) => {
  const rdoc = await db.collection('requests').doc(req.params.id).get();
  if (!rdoc.exists) return res.status(404).json({ error: 'Not found' });
  const request = rdoc.data();
  if (request.requester_id !== req.userId) return res.status(403).json({ error: 'Only requester can mark complete' });
  if (request.status !== 'accepted') return res.status(400).json({ error: 'Request not accepted yet' });

  await db.runTransaction(async t => {
    const requesterRef = db.collection('users').doc(request.requester_id);
    const helperRef    = db.collection('users').doc(request.helper_id);
    const [rDoc, hDoc] = await Promise.all([t.get(requesterRef), t.get(helperRef)]);
    t.update(requesterRef, { credits: rDoc.data().credits - request.credits });
    t.update(helperRef,    { credits: hDoc.data().credits + request.credits });
    t.update(db.collection('requests').doc(req.params.id), { status: 'completed' });
    const txId = uuidv4();
    t.set(db.collection('transactions').doc(txId), {
      id: txId,
      from_user_id: request.requester_id, to_user_id: request.helper_id,
      credits: request.credits, request_id: req.params.id,
      from_name: rDoc.data().name, to_name: hDoc.data().name,
      request_title: request.title, request_type: request.type,
      note: '', created_at: new Date().toISOString()
    });
  });

  const requester = await getUser(request.requester_id);
  notify(request.helper_id, 'completed', 'Service completed!',
    `${requester.name} marked "${request.title}" complete. ${request.credits} credit${request.credits !== 1 ? 's' : ''} added.`, req.params.id);
  notify(request.requester_id, 'completed', 'Service complete — leave a review',
    `Your "${request.title}" is done! Leave a review for your helper.`, req.params.id);
  res.json({ ok: true });
});

app.post('/api/requests/:id/cancel', requireAuth, async (req, res) => {
  const rdoc = await db.collection('requests').doc(req.params.id).get();
  if (!rdoc.exists) return res.status(404).json({ error: 'Not found' });
  if (rdoc.data().requester_id !== req.userId) return res.status(403).json({ error: 'Only requester can cancel' });
  if (!['open', 'accepted'].includes(rdoc.data().status)) return res.status(400).json({ error: 'Cannot cancel' });
  await db.collection('requests').doc(req.params.id).update({ status: 'cancelled' });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
// REVIEWS
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/reviews', requireAuth, async (req, res) => {
  const { request_id, reviewee_id, rating, comment } = req.body;
  if (!request_id || !reviewee_id || !rating) return res.status(400).json({ error: 'Missing fields' });
  const rdoc = await db.collection('requests').doc(request_id).get();
  if (!rdoc.exists || rdoc.data().status !== 'completed') return res.status(400).json({ error: 'Request not completed' });
  const request = rdoc.data();
  if (request.requester_id !== req.userId && request.helper_id !== req.userId)
    return res.status(403).json({ error: 'Not involved in this request' });
  const existingSnap = await db.collection('reviews')
    .where('request_id', '==', request_id).where('reviewer_id', '==', req.userId).limit(1).get();
  if (!existingSnap.empty) return res.status(400).json({ error: 'Already reviewed' });
  const id = uuidv4();
  await db.collection('reviews').doc(id).set({
    id, request_id, reviewer_id: req.userId, reviewee_id,
    rating: parseInt(rating), comment: comment || '',
    created_at: new Date().toISOString()
  });
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
// ACTIVITY
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/activity', requireAuth, async (req, res) => {
  try {
    const [fromSnap, toSnap] = await Promise.all([
      db.collection('transactions').where('from_user_id', '==', req.userId).get(),
      db.collection('transactions').where('to_user_id', '==', req.userId).get()
    ]);
    const seen = new Set();
    const all = [...fromSnap.docs, ...toSnap.docs]
      .map(d => d.data())
      .filter(t => { if (seen.has(t.id)) return false; seen.add(t.id); return true; });
    all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(all.slice(0, 20));
  } catch (e) {
    console.error('GET /api/activity error:', e);
    res.status(500).json({ error: 'Failed to load activity.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// NEIGHBORS
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/neighbors', requireAuth, async (req, res) => {
  const me = await getUser(req.userId);
  const allSnap = await db.collection('users').get();
  const neighbors = [];
  for (const doc of allSnap.docs) {
    const n = doc.data();
    if (n.id === req.userId) continue;
    const sameBuilding = me.building && n.building && me.building === n.building;
    let distanceMiles = null;
    if (me.lat && me.lng && n.lat && n.lng)
      distanceMiles = haversineMiles(me.lat, me.lng, n.lat, n.lng);
    if (!sameBuilding && (distanceMiles === null || distanceMiles > 1)) continue;
    const pets = await getUserPets(n.id);
    const pets_summary = pets.map(p => `${p.name} (${p.type})`).join(', ');
    const { ec_name, ec_phone, ec_relation, dob, firebase_uid, email, address, unit, ...safe } = n;
    neighbors.push({ ...safe, name: maskName(n.name), pets_summary, sameBuilding, distanceMiles });
  }
  neighbors.sort((a, b) => {
    if (a.sameBuilding && !b.sameBuilding) return -1;
    if (!a.sameBuilding && b.sameBuilding) return 1;
    return (a.distanceMiles || 0) - (b.distanceMiles || 0);
  });
  res.json(neighbors);
});

// ════════════════════════════════════════════════════════════════════════════
// MESSAGING
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/requests/:id/messages', requireAuth, async (req, res) => {
  try {
    const rdoc = await db.collection('requests').doc(req.params.id).get();
    if (!rdoc.exists) return res.status(404).json({ error: 'Not found' });
    const r = rdoc.data();
    if (r.requester_id !== req.userId && r.helper_id !== req.userId)
      return res.status(403).json({ error: 'Not involved' });
    const snap = await db.collection('messages')
      .where('request_id', '==', req.params.id).get();
    const msgs = snap.docs.map(d => d.data());
    msgs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    res.json(msgs);
  } catch (e) {
    console.error('GET /api/messages error:', e);
    res.status(500).json({ error: 'Failed to load messages.' });
  }
});

app.post('/api/requests/:id/messages', requireAuth, async (req, res) => {
  const rdoc = await db.collection('requests').doc(req.params.id).get();
  if (!rdoc.exists) return res.status(404).json({ error: 'Not found' });
  const request = rdoc.data();
  if (!['accepted', 'completed'].includes(request.status))
    return res.status(400).json({ error: 'Messaging only available for accepted requests' });
  if (request.requester_id !== req.userId && request.helper_id !== req.userId)
    return res.status(403).json({ error: 'Not involved' });
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Message cannot be empty' });
  const sender = await getUser(req.userId);
  const id = uuidv4();
  const now = new Date().toISOString();
  const msg = { id, request_id: req.params.id, sender_id: req.userId,
                sender_name: sender.name, body: body.trim(), image_url: null, created_at: now };
  await db.collection('messages').doc(id).set(msg);
  await db.collection('requests').doc(req.params.id).update({ last_message: body.trim(), last_message_at: now, last_sender_id: req.userId });
  const otherId = request.requester_id === req.userId ? request.helper_id : request.requester_id;
  if (otherId) notify(otherId, 'message', `New message from ${sender.name}`, body.trim().slice(0, 80), req.params.id);
  res.json(msg);
});

app.post('/api/requests/:id/messages/image', requireAuth, upload.single('image'), async (req, res) => {
  const rdoc = await db.collection('requests').doc(req.params.id).get();
  if (!rdoc.exists) return res.status(404).json({ error: 'Not found' });
  const request = rdoc.data();
  if (request.requester_id !== req.userId && request.helper_id !== req.userId)
    return res.status(403).json({ error: 'Not involved' });
  if (!req.file) return res.status(400).json({ error: 'No image provided' });
  try {
    const result = await uploadToCloudinary(req.file.buffer, 'nekopawz/chat');
    const sender = await getUser(req.userId);
    const id  = uuidv4();
    const now = new Date().toISOString();
    const msg = { id, request_id: req.params.id, sender_id: req.userId,
                  sender_name: sender.name, body: '', image_url: result.secure_url, created_at: now };
    await db.collection('messages').doc(id).set(msg);
    await db.collection('requests').doc(req.params.id).update({ last_message: '📷 Photo', last_message_at: now, last_sender_id: req.userId });
    const otherId = request.requester_id === req.userId ? request.helper_id : request.requester_id;
    if (otherId) notify(otherId, 'message', `Photo from ${sender.name}`, '📷 Sent a photo', req.params.id);
    res.json(msg);
  } catch (e) {
    res.status(500).json({ error: 'Upload failed: ' + e.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    const snap = await db.collection('notifications')
      .where('user_id', '==', req.userId).get();
    let notifications = snap.docs.map(d => d.data());
    notifications.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    notifications = notifications.slice(0, 30);
    const unread = notifications.filter(n => !n.read).length;
    res.json({ notifications, unread });
  } catch (e) {
    console.error('GET /api/notifications error:', e);
    res.status(500).json({ error: 'Failed to load notifications.' });
  }
});

app.post('/api/notifications/read-all', requireAuth, async (req, res) => {
  const snap = await db.collection('notifications')
    .where('user_id', '==', req.userId).where('read', '==', false).get();
  await Promise.all(snap.docs.map(d => d.ref.update({ read: true })));
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
// UPCOMING & CONVERSATIONS
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/upcoming', requireAuth, async (req, res) => {
  const today      = new Date().toISOString().split('T')[0];
  const inThreeDays = new Date(Date.now() + 3 * 86400000).toISOString().split('T')[0];
  const [asReq, asHelp] = await Promise.all([
    db.collection('requests').where('requester_id', '==', req.userId).where('status', '==', 'accepted').get(),
    db.collection('requests').where('helper_id',    '==', req.userId).where('status', '==', 'accepted').get()
  ]);
  const seen = new Set();
  const all = [...asReq.docs, ...asHelp.docs]
    .map(d => d.data())
    .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
    .filter(r => r.date >= today && r.date <= inThreeDays)
    .sort((a, b) => a.date < b.date ? -1 : 1);
  res.json(all);
});

app.get('/api/conversations', requireAuth, async (req, res) => {
  try {
    const [asReq, asHelp] = await Promise.all([
      db.collection('requests').where('requester_id', '==', req.userId).get(),
      db.collection('requests').where('helper_id',    '==', req.userId).get()
    ]);
    const seen = new Set();
    const convos = [...asReq.docs, ...asHelp.docs]
      .map(d => d.data())
      .filter(r => r.last_message_at != null)
      .filter(r => { if (seen.has(r.id)) return false; seen.add(r.id); return true; })
      .sort((a, b) => new Date(b.last_message_at) - new Date(a.last_message_at))
      .slice(0, 30);
    res.json(convos);
  } catch (e) {
    console.error('GET /api/conversations error:', e);
    res.status(500).json({ error: 'Failed to load conversations.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ════════════════════════════════════════════════════════════════════════════

app.get('/api/settings', requireAuth, async (req, res) => {
  const user = await getUser(req.userId);
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json(user);
});

app.put('/api/settings', requireAuth, async (req, res) => {
  const { name, bio, unit, notif_messages, notif_accepted,
          notif_reminders, notif_browser, ec_name, ec_phone, ec_relation,
          address, building, lat, lng } = req.body;
  const updates = {};
  if (name  !== undefined) updates.name = name;
  if (bio   !== undefined) updates.bio  = bio;
  if (unit  !== undefined) updates.unit = unit;
  // Address update — only applied when the client sends confirmed geocoordinates
  if (address  !== undefined) updates.address  = address;
  if (building !== undefined) updates.building = building;
  if (lat != null && lat !== '') updates.lat = parseFloat(lat);
  if (lng != null && lng !== '') updates.lng = parseFloat(lng);
  updates.notif_messages  = notif_messages  ? 1 : 0;
  updates.notif_accepted  = notif_accepted  ? 1 : 0;
  updates.notif_reminders = notif_reminders ? 1 : 0;
  updates.notif_browser   = notif_browser   ? 1 : 0;
  updates.ec_name     = ec_name     || '';
  updates.ec_phone    = ec_phone    || '';
  updates.ec_relation = ec_relation || '';
  await db.collection('users').doc(req.userId).update(updates);
  res.json({ ok: true });
});

// ════════════════════════════════════════════════════════════════════════════
// CONTACT
// ════════════════════════════════════════════════════════════════════════════

app.post('/api/contact', async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name || !email || !message)
    return res.status(400).json({ error: 'Name, email, and message are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (!process.env.SMTP_PASS || process.env.SMTP_PASS === 'your_app_password_here') {
    console.log('=== CONTACT FORM (SMTP not configured) ===', { name, email, subject, message });
    return res.json({ ok: true });
  }
  try {
    await mailer.sendMail({
      from: `"NekoPawz Contact" <${process.env.SMTP_USER}>`,
      to: CONTACT_EMAIL, replyTo: email,
      subject: `[NekoPawz] ${subject || 'New message from ' + name}`,
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
      html: `<div style="font-family:sans-serif;max-width:560px">
        <h2 style="color:#1a4731">NekoPawz — Contact Form</h2>
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
          <tr><td style="padding:6px 0;color:#666;width:80px">Name</td><td style="padding:6px 0;font-weight:600">${name}</td></tr>
          <tr><td style="padding:6px 0;color:#666">Email</td><td style="padding:6px 0"><a href="mailto:${email}">${email}</a></td></tr>
          ${subject ? `<tr><td style="padding:6px 0;color:#666">Subject</td><td style="padding:6px 0">${subject}</td></tr>` : ''}
        </table>
        <div style="background:#f7f8f6;border-left:4px solid #40916c;padding:14px 18px;border-radius:0 8px 8px 0;white-space:pre-wrap">${message.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</div>
      </div>`
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Contact email error:', err.message);
    res.status(500).json({ error: 'Failed to send message. Please try again later.' });
  }
});

// ── Public config ────────────────────────────────────────────────────────────
// Exposes only public/restricted keys that are safe to share with the browser.
// The Google Maps key should be restricted by HTTP referrer in Google Cloud Console.
app.get('/api/config', (req, res) => {
  res.json({ mapsKey: process.env.GOOGLE_MAPS_KEY || '' });
});

// ── Global error handler ─────────────────────────────────────────────────────
// Catches any unhandled async errors thrown in route handlers and returns JSON
// instead of a raw 500 HTML page, so the frontend can display a readable message.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err);
  res.status(500).json({ error: err.message || 'An unexpected error occurred.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`NekoPawz running at http://localhost:${PORT}`));
