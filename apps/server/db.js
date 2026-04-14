const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '../../pawcredits.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    building TEXT NOT NULL,
    building_name TEXT DEFAULT '',
    address TEXT DEFAULT '',
    unit TEXT DEFAULT '',
    credits INTEGER DEFAULT 10,
    bio TEXT DEFAULT '',
    lat REAL DEFAULT NULL,
    lng REAL DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS pets (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    breed TEXT DEFAULT '',
    age TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL,
    pet_id TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    credits INTEGER NOT NULL,
    date TEXT NOT NULL,
    time_window TEXT DEFAULT '',
    status TEXT DEFAULT 'open',
    helper_id TEXT,
    building TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (requester_id) REFERENCES users(id),
    FOREIGN KEY (helper_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    from_user_id TEXT NOT NULL,
    to_user_id TEXT NOT NULL,
    credits INTEGER NOT NULL,
    request_id TEXT,
    note TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    reviewer_id TEXT NOT NULL,
    reviewee_id TEXT NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    sender_id TEXT NOT NULL,
    body TEXT DEFAULT '',
    image_url TEXT DEFAULT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES requests(id),
    FOREIGN KEY (sender_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL,
    applicant_id TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(request_id, applicant_id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT DEFAULT '',
    request_id TEXT DEFAULT NULL,
    read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrate existing databases
for (const col of [
  'lat REAL DEFAULT NULL',
  'lng REAL DEFAULT NULL',
  "building_name TEXT DEFAULT ''",
  "address TEXT DEFAULT ''",
  'notif_messages INTEGER DEFAULT 1',
  'notif_accepted INTEGER DEFAULT 1',
  'notif_reminders INTEGER DEFAULT 1',
  'notif_browser INTEGER DEFAULT 0',
  "dob TEXT DEFAULT ''",
  "ec_name TEXT DEFAULT ''",
  "ec_phone TEXT DEFAULT ''",
  "ec_relation TEXT DEFAULT ''",
  "firebase_uid TEXT DEFAULT NULL",
  "avatar_url TEXT DEFAULT NULL",
]) {
  try { db.exec(`ALTER TABLE users ADD COLUMN ${col}`); } catch {}
}
for (const col of [
  "pet_ids TEXT DEFAULT ''",
  "duration TEXT DEFAULT ''",
  "directed_to TEXT DEFAULT NULL",
]) {
  try { db.exec(`ALTER TABLE requests ADD COLUMN ${col}`); } catch {}
}

module.exports = db;
