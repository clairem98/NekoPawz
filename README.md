# NekoPawz — Neighbor Pet Care Exchange

NekoPawz is a credit-based pet care exchange platform for apartment buildings and neighborhoods. Neighbors help each other with dog walks, cat check-ins, and other pet care tasks using a community credit system — no money, no platform fees, no strangers.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Environment Variables](#environment-variables)
- [Local Development](#local-development)
- [Deployment](#deployment)

---

## How It Works

1. **Sign up** with your address and date of birth (must be 18+). You receive **1 free credit** to start.
2. **Post a request** — describe what you need (dog walk, cat check-in, etc.), pick a date, and set a credit cost.
3. **Neighbors apply** to help. You review their profiles and ratings, then approve one.
4. **The sit happens.** When it's done, mark it complete — credits transfer automatically from you to your helper.
5. **Leave a review.** Ratings build trust across the community over time.

The more you help neighbors, the more credits you earn to spend when you need help yourself.

---

## Features

### Authentication
- Email/password sign-up and sign-in via Firebase Authentication
- Google OAuth sign-in ("Continue with Google")
- New Google users are prompted to complete their profile (address, DOB, ToS)
- Age gate: users must be 18 or older to register
- Terms of Service acceptance required on sign-up

### Dashboard
- Personalised greeting and live credit balance
- Recent credit activity (last 5 transactions with earn/spend indicators)
- Upcoming sits within the next 3 days
- Quick view of 6 nearby open requests

### Browse Requests
- Three independent filters:
  - **Type**: All / Dog Walk / Cat Check-in / Other
  - **Date**: All / Today / Tomorrow / This Week / Weekend
  - **Location**: Building only / 0.5 mi / 1 mi / 5 mi radius
- Distance labels calculated with the Haversine formula
- Full address hidden until a request is confirmed (privacy protection)

### Posting a Request
- Choose service type, title, description, date, time window, and duration
- Select one or multiple pets
- Set credit cost (1–20 credits)
- Optionally send the request directly to a specific neighbor (skips the open-application step and auto-approves when they accept)

### Request Lifecycle
| Status | Meaning |
|--------|---------|
| `open` | Accepting volunteer applications |
| `accepted` | A helper has been approved; messaging is unlocked |
| `completed` | Service done; credits transferred |
| `cancelled` | Requester cancelled before completion |

### Applications & Approval
- Helpers browse open requests and click "Volunteer to help"
- Requester sees all applicants with name, star rating, review count, and distance
- Requester approves one applicant; all others are automatically declined and notified

### Messaging
- In-app chat between requester and helper once a request is accepted
- Image upload support (up to 8 MB)
- Auto-polls for new messages every 8 seconds
- "Time ago" timestamps

### Notifications
- Bell icon in the nav with unread count badge
- Events that trigger notifications: new application, approval, completion, new message, upcoming sit reminder
- Notifications are persistent (stored in the database)
- Optional browser push notification permission

### Ratings & Reviews
- 1–5 star rating with optional written comment
- Left after a request is marked complete
- Average rating and review count displayed on every user profile

### Neighbors
- Grid of neighbors in your building or within 1 mile
- Shows name, pet summary, and a quick "Request this neighbor" button
- Unit numbers hidden from public view for privacy

### My Profile
- Credit balance and full transaction history
- List of pets with type, breed, age, and notes

### Settings
- Update display name, bio, and unit number
- Notification preferences: messages, request updates, sit reminders, browser notifications
- Emergency contact (name, phone, relationship) — visible only to the NekoPawz support team, never shown publicly

### Contact Us
- Accessible without being signed in
- Sends an email to the NekoPawz admin inbox via Gmail SMTP
- The destination email is never exposed to the client

---

## Architecture

```
┌─────────────────────────────────────────────┐
│              User's Browser                 │
│  www.nekopawz.com (GitHub Pages)            │
│  Vanilla HTML + CSS + JavaScript            │
│  Firebase Auth SDK (Google / Email)         │
└───────────────┬─────────────────────────────┘
                │  HTTPS API calls
                │  Authorization: Bearer <Firebase ID token>
                ▼
┌─────────────────────────────────────────────┐
│         Backend (Railway)                   │
│  nekopawzserver-production.up.railway.app   │
│  Node.js + Express.js                       │
│  Firebase Admin SDK (token verification)    │
│  SQLite database (better-sqlite3)           │
│  Nodemailer (Gmail SMTP for contact form)   │
└─────────────────────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────┐
│  Firebase Authentication (Google Cloud)     │
│  Issues and verifies ID tokens              │
│  Supports email/password + Google OAuth     │
└─────────────────────────────────────────────┘
```

### How Authentication Works

1. The user signs in via the **Firebase Auth SDK** in the browser (email/password or Google OAuth).
2. Firebase issues a signed **ID token** (JWT).
3. Every API request from the frontend includes this token as `Authorization: Bearer <token>`.
4. The backend uses the **Firebase Admin SDK** to verify the token cryptographically.
5. Once verified, the backend looks up the user's profile in SQLite by `firebase_uid` and processes the request.

### Monorepo Structure

```
NekoPawz/
├── apps/
│   ├── server/          # Node.js/Express backend
│   │   ├── server.js    # All API routes
│   │   ├── db.js        # SQLite schema + migrations
│   │   └── package.json
│   └── website/         # Static frontend
│       ├── index.html   # App shell + all page markup
│       ├── app.js       # All client-side logic (SPA router)
│       ├── style.css    # All styles
│       └── CNAME        # Custom domain for GitHub Pages
├── .github/
│   └── workflows/
│       └── deploy-pages.yml  # Auto-deploy frontend to GitHub Pages
├── package.json         # npm workspaces root
└── .env                 # Secrets (never committed)
```

### Frontend Hosting — GitHub Pages

- The `apps/website` folder is deployed to GitHub Pages automatically via **GitHub Actions** on every push to `main`.
- A `CNAME` file inside `apps/website` preserves the custom domain `www.nekopawz.com` across every deploy.
- A `.nojekyll` file disables GitHub's default Jekyll processing so plain HTML/JS/CSS is served as-is.

**Workflow** (`.github/workflows/deploy-pages.yml`):
```
push to main → checkout → upload apps/website as Pages artifact → deploy
```

### Backend Hosting — Railway

- The `apps/server` folder is deployed to Railway.
- Railway auto-redeploys on every push to `main` (connected to the GitHub repo).
- The root directory is set to `apps/server`, so Railway runs `npm start` → `node server.js`.
- Environment variables are configured in the Railway Variables dashboard.
- The public URL is `https://nekopawzserver-production.up.railway.app`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML5, CSS3, JavaScript (ES2020+) |
| Auth | Firebase Authentication (email/password + Google OAuth) |
| Backend | Node.js, Express.js v5 |
| Database | SQLite via `better-sqlite3` |
| Admin SDK | Firebase Admin SDK v13 |
| Email | Nodemailer + Gmail SMTP (app password) |
| File uploads | Multer (images in messages, 8 MB limit) |
| Geolocation | Browser Geolocation API + Nominatim reverse geocoding |
| Distance | Haversine formula (in-process, no external API) |
| Frontend hosting | GitHub Pages + GitHub Actions |
| Backend hosting | Railway |
| Domain | `www.nekopawz.com` (custom domain via CNAME) |

---

## Database Schema

All data is stored in a single SQLite file (`pawcredits.db`) at the repository root.

### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| name | TEXT | Display name |
| email | TEXT UNIQUE | From Firebase |
| password_hash | TEXT | Empty for Firebase/Google users |
| firebase_uid | TEXT UNIQUE | Links to Firebase account |
| building | TEXT | Used for same-building matching |
| building_name | TEXT | Optional complex name |
| address | TEXT | Full street address |
| unit | TEXT | Apartment/unit number (hidden from public) |
| credits | INTEGER | Default 1 on registration |
| bio | TEXT | Optional profile bio |
| lat / lng | REAL | Coordinates for distance calculation |
| dob | TEXT | Date of birth (age verification) |
| ec_name / ec_phone / ec_relation | TEXT | Emergency contact (private) |
| notif_* | INTEGER | Notification preferences (0/1) |

### `pets`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| owner_id | TEXT FK | References users.id |
| name, type, breed, age, notes | TEXT | Pet details |

### `requests`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| requester_id | TEXT FK | Owner of the request |
| pet_id / pet_ids | TEXT | Primary pet + comma-separated list for multiple |
| type | TEXT | `dog_walk`, `cat_checkin`, `other` |
| title, description | TEXT | |
| credits | INTEGER | Cost of the request (1–20) |
| date, time_window, duration | TEXT | When and how long |
| status | TEXT | `open`, `accepted`, `completed`, `cancelled` |
| helper_id | TEXT FK | Set on approval |
| building | TEXT | Copied from requester at post time |
| directed_to | TEXT FK | Optional: specific target sitter |

### `applications`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| request_id | TEXT FK | |
| applicant_id | TEXT FK | |
| status | TEXT | `pending`, `approved`, `declined` |

### `transactions`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| from_user_id / to_user_id | TEXT FK | Requester → helper on completion |
| credits | INTEGER | Amount transferred |
| request_id | TEXT FK | Source request |

### `messages`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| request_id | TEXT FK | |
| sender_id | TEXT FK | |
| body | TEXT | Text content |
| image_url | TEXT | Path to uploaded image (optional) |

### `reviews`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| request_id | TEXT FK | Must be `completed` |
| reviewer_id / reviewee_id | TEXT FK | |
| rating | INTEGER | 1–5 stars |
| comment | TEXT | Optional written review |

### `notifications`
| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT FK | Recipient |
| type | TEXT | `message`, `accepted`, `completed`, `application`, `declined` |
| title / body | TEXT | Notification content |
| request_id | TEXT FK | Optional link to a request |
| read | INTEGER | 0 = unread, 1 = read |

---

## API Reference

All endpoints are prefixed with `/api`. Protected endpoints require an `Authorization: Bearer <Firebase ID token>` header.

### Auth & Profile
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/register` | Firebase token | Create user profile after Firebase sign-up |
| GET | `/api/me` | Required | Current user profile + pets |
| GET | `/api/users/:id` | Required | Public profile (name, bio, pets, reviews) |

### Pets
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/pets` | Required | Add a pet |
| DELETE | `/api/pets/:id` | Required | Remove a pet |

### Requests
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/requests` | Required | Post a new request |
| GET | `/api/requests` | Required | List requests (query: `status`, `mine`, `helping`, `radius`) |
| GET | `/api/requests/:id` | Required | Request detail with applications and helper info |
| POST | `/api/requests/:id/apply` | Required | Volunteer to help |
| POST | `/api/requests/:id/approve/:applicantId` | Required | Approve an applicant |
| POST | `/api/requests/:id/decline/:applicantId` | Required | Decline an applicant |
| POST | `/api/requests/:id/complete` | Required | Mark complete and transfer credits |
| POST | `/api/requests/:id/cancel` | Required | Cancel request |

### Messaging
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/requests/:id/messages` | Required | Fetch all messages |
| POST | `/api/requests/:id/messages` | Required | Send a text message |
| POST | `/api/requests/:id/messages/image` | Required | Send an image message |

### Reviews
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/reviews` | Required | Leave a review (completed requests only) |

### Activity & Discovery
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/activity` | Required | Recent credit transactions (last 20) |
| GET | `/api/upcoming` | Required | Accepted sits in the next 3 days |
| GET | `/api/conversations` | Required | Message inbox |
| GET | `/api/neighbors` | Required | Nearby users (same building or within 1 mile) |

### Notifications
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/notifications` | Required | Notifications + unread count |
| POST | `/api/notifications/read-all` | Required | Mark all notifications as read |

### Settings & Contact
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/settings` | Required | User settings including emergency contact |
| PUT | `/api/settings` | Required | Update settings |
| POST | `/api/contact` | Public | Submit contact form (sends email to admin) |

---

## Environment Variables

Create a `.env` file at the repository root (never commit this file):

```env
# Firebase Admin SDK — service account JSON on a single line
FIREBASE_SERVICE_ACCOUNT={"type":"service_account","project_id":"..."}

# Gmail SMTP for the contact form
SMTP_USER=your@gmail.com
SMTP_PASS=your_app_password

# Server port (Railway sets this automatically)
PORT=8080

# Set to 'production' on Railway
NODE_ENV=production
```

### Getting the Firebase service account
1. Firebase Console → Project Settings → Service accounts
2. Click **Generate new private key** — downloads a `.json` file
3. Flatten it to a single line: `python3 -c "import json; f=open('key.json'); print(json.dumps(json.load(f)))"`
4. Paste the output as the value of `FIREBASE_SERVICE_ACCOUNT`

### Getting the Gmail app password
1. Enable 2-Step Verification on your Google account
2. Go to `myaccount.google.com/apppasswords`
3. Create a password named "NekoPawz"
4. Use the 16-character code as `SMTP_PASS`

---

## Local Development

```bash
# Clone the repo
git clone https://github.com/clairem98/NekoPawz.git
cd NekoPawz

# Install all workspace dependencies
npm install

# Create .env with your credentials (see above)

# Start the backend (runs on http://localhost:3000)
npm run dev
```

Open `http://localhost:3000` in your browser. The backend also serves the frontend static files in local development.

---

## Deployment

### Frontend → GitHub Pages (automatic)

Every push to `main` triggers a GitHub Actions workflow that:
1. Checks out the repository
2. Uploads `apps/website` as the Pages artifact
3. Deploys it to `www.nekopawz.com`

No manual steps required after initial setup.

### Backend → Railway (automatic)

Railway is connected to the GitHub repository and redeploys automatically on every push to `main`.

**Initial setup:**
1. New project → Deploy from GitHub repo → select `clairem98/NekoPawz`
2. Set root directory to `apps/server`
3. Add environment variables in the Variables tab
4. Settings → Networking → Generate Domain to get a public URL

---

## Privacy & Safety

- Unit numbers are never shown in public listings
- Full address is revealed only after a request is confirmed between both parties
- Emergency contact details are stored but never displayed publicly — support team access only
- Email addresses are never exposed to other users
- The contact form destination email is server-side only; the client never sees it
- All users must verify they are 18+ and agree to the Terms of Service on sign-up
