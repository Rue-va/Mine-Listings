const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const config = require('./config');
const { db, hashPassword, verifyPassword, uniqueSlug, hydrate } = require('./db');
const seed = require('./seed');

seed();

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PUBLIC_STATUSES = ['approved', 'under_offer', 'sold'];
const SESSION_DAYS = 14;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(express.static(path.join(__dirname, 'public'), { maxAge: isProd ? '7d' : 0 }));
app.get('/favicon.ico', (req, res) => res.type('png').sendFile(path.join(__dirname, 'public', 'img', 'favicon-64.png')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), { maxAge: isProd ? '30d' : 0 }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const cookieOpts = { httpOnly: true, sameSite: 'lax', secure: isProd, path: '/' };

// Static files are cached for a week in production, so links to them carry a hash of their
// contents: a deploy that changes the CSS or JS gives browsers a new URL to fetch.
const assetVersion = crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(__dirname, 'public', 'css', 'style.css')))
  .update(fs.readFileSync(path.join(__dirname, 'public', 'js', 'main.js')))
  .digest('hex').slice(0, 10);

// ---------- uploads ----------

const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 6 * 1024 * 1024, files: 8 },
  fileFilter: (req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

// ---------- session, flash, csrf ----------

app.use((req, res, next) => {
  req.user = null;
  const token = req.cookies.sid;
  if (token) {
    const row = db.prepare(`SELECT u.id, u.name, u.email, u.phone, u.role FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = ? AND s.expires_at > ?`).get(token, Date.now());
    if (row) req.user = row;
    else res.clearCookie('sid', cookieOpts);
  }

  res.flash = (type, message) => res.cookie('flash', JSON.stringify({ type, message }), { ...cookieOpts, maxAge: 60000 });
  res.locals.flash = null;
  if (req.cookies.flash) {
    try { res.locals.flash = JSON.parse(req.cookies.flash); } catch { /* ignore a mangled cookie */ }
    res.clearCookie('flash', cookieOpts);
  }

  let csrf = req.cookies.csrf;
  if (!csrf || csrf.length !== 32) {
    csrf = crypto.randomBytes(16).toString('hex');
    res.cookie('csrf', csrf, { ...cookieOpts, maxAge: 1000 * 60 * 60 * 24 * 30 });
  }
  req.csrfToken = csrf;

  let consent = null;
  try { consent = JSON.parse(req.cookies.cookie_consent || 'null'); } catch { /* treat as not yet chosen */ }
  res.locals.cookieConsent = consent && consent.v === config.cookieConsentVersion ? consent : null;

  Object.assign(res.locals, { user: req.user, csrf, config, assetVersion, currentPath: req.path, query: req.query, fmtMoney, fmtPrice, fmtDate, mineralSlug });
  next();
});

function csrfValid(req) {
  const sent = (req.body && req.body._csrf) || '';
  return sent.length === 32 && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(req.csrfToken));
}

// Multipart forms are checked after multer has parsed them (see verifyCsrf).
app.use((req, res, next) => {
  if (req.method !== 'POST' || req.is('multipart/form-data')) return next();
  if (!csrfValid(req)) return res.status(403).render('error', { title: 'Form expired', message: 'That form had expired. Please go back, refresh the page and try again.' });
  next();
});

function verifyCsrf(req, res, next) {
  if (!csrfValid(req)) return res.status(403).render('error', { title: 'Form expired', message: 'That form had expired. Please go back, refresh the page and try again.' });
  next();
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  res.flash('info', 'Please sign in first. It only takes a minute.');
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  if (!req.user) return requireLogin(req, res, next);
  res.status(403).render('error', { title: 'Admins only', message: "You don't have access to that page." });
}

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const maxAge = SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, Date.now() + maxAge);
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  res.cookie('sid', token, { ...cookieOpts, maxAge });
}

// Only allow redirects back into this site.
function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : null;
}

// ---------- formatting helpers ----------

function fmtMoney(n) {
  if (n == null) return '';
  if (n >= 1000000) return `US$${(n / 1000000).toFixed(n % 1000000 ? 1 : 0).replace(/\.0$/, '')} million`;
  return `US$${Number(n).toLocaleString('en-US')}`;
}

function fmtPrice(l) {
  if (l.price_usd == null) return l.price_label || 'Price on request';
  return `${fmtMoney(l.price_usd)}${l.price_label ? ` ${l.price_label}` : ''}`;
}

function fmtDate(s) {
  if (!s) return '';
  return new Date(`${s.replace(' ', 'T')}Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function mineralSlug(m) {
  return String(m).toLowerCase().replace(/\s+/g, '-');
}

const clean = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isPhone = (v) => /^\+?[\d\s()-]+$/.test(v) && /^\d{7,15}$/.test(v.replace(/\D/g, ''));

// ---------- public pages ----------

app.get('/', (req, res) => {
  const featured = db.prepare(`SELECT * FROM listings WHERE status IN ('approved','under_offer') AND featured = 1 ORDER BY updated_at DESC LIMIT 6`).all().map(hydrate);
  const latest = db.prepare(`SELECT * FROM listings WHERE status = 'approved' ORDER BY created_at DESC LIMIT 6`).all().map(hydrate);
  const counts = db.prepare(`SELECT mineral, COUNT(*) AS n FROM listings WHERE status IN ('approved','under_offer') GROUP BY mineral ORDER BY n DESC`).all();
  const stats = db.prepare(`SELECT COUNT(*) AS listings, COALESCE(SUM(area_ha),0) AS hectares, COUNT(DISTINCT province) AS provinces FROM listings WHERE status IN ('approved','under_offer')`).get();
  res.render('home', { title: null, featured, latest, counts, stats });
});

app.get('/mines', (req, res) => {
  const q = req.query;
  const where = [`status IN ('approved','under_offer','sold')`];
  const params = [];
  const minerals = [].concat(q.mineral || []).filter((m) => config.minerals.includes(m));
  if (minerals.length) { where.push(`mineral IN (${minerals.map(() => '?').join(',')})`); params.push(...minerals); }
  if (config.provinces.includes(q.province)) { where.push('province = ?'); params.push(q.province); }
  if (config.stages.includes(q.stage)) { where.push('stage = ?'); params.push(q.stage); }
  if (q.q) {
    where.push('(title LIKE ? OR location LIKE ? OR description LIKE ? OR mineral LIKE ?)');
    const like = `%${clean(q.q, 80)}%`;
    params.push(like, like, like, like);
  }
  if (Number(q.min_price) > 0) { where.push('price_usd >= ?'); params.push(Number(q.min_price)); }
  if (Number(q.max_price) > 0) { where.push('price_usd <= ?'); params.push(Number(q.max_price)); }
  if (Number(q.min_ha) > 0) { where.push('area_ha >= ?'); params.push(Number(q.min_ha)); }
  if (q.geo === '1') { where.push(`documents LIKE '%Geological report%'`); }
  if (q.hide_sold === '1') { where.push(`status != 'sold'`); }

  const sorts = {
    newest: 'created_at DESC', price_asc: 'price_usd IS NULL, price_usd ASC', price_desc: 'price_usd DESC',
    size_desc: 'area_ha DESC', size_asc: 'area_ha ASC',
  };
  const sort = sorts[q.sort] ? q.sort : 'newest';
  const perPage = 12;
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const whereSql = where.join(' AND ');
  const total = db.prepare(`SELECT COUNT(*) AS n FROM listings WHERE ${whereSql}`).get(...params).n;
  const listings = db.prepare(`SELECT * FROM listings WHERE ${whereSql}
    ORDER BY CASE status WHEN 'sold' THEN 1 ELSE 0 END, ${sorts[sort]} LIMIT ? OFFSET ?`)
    .all(...params, perPage, (page - 1) * perPage).map(hydrate);
  const mineralCounts = Object.fromEntries(db.prepare(`SELECT mineral, COUNT(*) AS n FROM listings WHERE status IN ('approved','under_offer','sold') GROUP BY mineral`).all().map((r) => [r.mineral, r.n]));

  const pageUrl = (p) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (k !== 'page') [].concat(v).forEach((x) => x !== '' && sp.append(k, x));
    if (p > 1) sp.set('page', p);
    const s = sp.toString();
    return `/mines${s ? `?${s}` : ''}`;
  };

  res.render('browse', {
    title: 'Mines & claims for sale', listings, total, page, pages: Math.ceil(total / perPage), sort,
    selectedMinerals: minerals, mineralCounts, pageUrl,
  });
});

// Friendly category URLs: /minerals/gold -> filtered browse page
app.get('/minerals/:mineral', (req, res) => {
  const m = config.minerals.find((x) => mineralSlug(x) === req.params.mineral);
  res.redirect(m ? `/mines?mineral=${encodeURIComponent(m)}` : '/mines');
});

function loadListing(req, res) {
  const listing = hydrate(db.prepare('SELECT * FROM listings WHERE slug = ?').get(req.params.slug));
  if (!listing) return null;
  const canSee = PUBLIC_STATUSES.includes(listing.status)
    || (req.user && (req.user.role === 'admin' || req.user.id === listing.owner_id));
  return canSee ? listing : null;
}

app.get('/mines/:slug', (req, res) => {
  const listing = loadListing(req, res);
  if (!listing) return res.status(404).render('404', { title: 'Listing not found' });
  if (PUBLIC_STATUSES.includes(listing.status)) db.prepare('UPDATE listings SET views = views + 1 WHERE id = ?').run(listing.id);
  const similar = db.prepare(`SELECT * FROM listings WHERE status IN ('approved','under_offer') AND id != ? AND mineral = ? ORDER BY featured DESC, created_at DESC LIMIT 3`)
    .all(listing.id, listing.mineral).map(hydrate);
  const saved = req.user ? !!db.prepare('SELECT 1 FROM favourites WHERE user_id = ? AND listing_id = ?').get(req.user.id, listing.id) : false;
  const myOffer = req.user ? db.prepare(`SELECT * FROM offers WHERE user_id = ? AND listing_id = ? ORDER BY id DESC LIMIT 1`).get(req.user.id, listing.id) : null;
  res.render('listing', { title: listing.title, listing, similar, saved, myOffer, description: listing.summary });
});

app.post('/mines/:slug/enquire', (req, res) => {
  const listing = loadListing(req, res);
  if (!listing) return res.status(404).render('404', { title: 'Listing not found' });
  const name = clean(req.body.name, 100);
  const email = clean(req.body.email, 150);
  const phone = clean(req.body.phone, 40);
  const message = clean(req.body.message, 3000);
  const kind = req.body.kind === 'site_visit' ? 'site_visit' : 'enquiry';
  if (req.body.website) return res.redirect(`/mines/${listing.slug}`); // honeypot: bots fill every field
  if (!name || !isEmail(email) || !isPhone(phone) || !message) {
    res.flash('error', 'Please add your name, a valid email address, a valid phone number and a short message.');
    return res.redirect(`/mines/${listing.slug}#enquire`);
  }
  db.prepare('INSERT INTO enquiries (listing_id, user_id, kind, name, email, phone, message) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(listing.id, req.user?.id ?? null, kind, name, email, phone, message);
  res.flash('success', `Thanks ${name.split(' ')[0]}, we've got your ${kind === 'site_visit' ? 'site visit request' : 'enquiry'}. Someone from our team will get back to you, usually within one working day.`);
  res.redirect(`/mines/${listing.slug}#enquire`);
});

app.post('/mines/:slug/offer', requireLogin, (req, res) => {
  const listing = loadListing(req, res);
  if (!listing) return res.status(404).render('404', { title: 'Listing not found' });
  if (listing.status !== 'approved') {
    res.flash('error', 'This mine is no longer accepting offers.');
    return res.redirect(`/mines/${listing.slug}`);
  }
  const amount = Math.round(Number(String(req.body.amount || '').replace(/[^\d.]/g, '')));
  const funding = ['Cash', 'Financed', 'Joint venture', 'Tribute / lease'].includes(req.body.funding) ? req.body.funding : null;
  const phone = clean(req.body.phone, 40);
  if (!amount || amount < 1000 || !funding || !isPhone(phone) || req.body.agree !== 'on') {
    res.flash('error', 'Please enter your offer amount, choose how it will be funded, add a valid phone number and accept the terms.');
    return res.redirect(`/mines/${listing.slug}#buy`);
  }
  if (db.prepare(`SELECT 1 FROM offers WHERE user_id = ? AND listing_id = ? AND status = 'pending'`).get(req.user.id, listing.id)) {
    res.flash('info', "You already have an offer waiting on this mine. We'll be in touch about it soon.");
    return res.redirect(`/mines/${listing.slug}#buy`);
  }
  db.prepare('INSERT INTO offers (listing_id, user_id, amount_usd, funding, phone, message) VALUES (?, ?, ?, ?, ?, ?)')
    .run(listing.id, req.user.id, amount, funding, phone, clean(req.body.message, 3000));
  res.flash('success', `Your offer of ${fmtMoney(amount)} has been sent. We'll pass it to the owner and arrange the next steps with you. You can track it from your dashboard.`);
  res.redirect(`/mines/${listing.slug}#buy`);
});

app.post('/mines/:slug/save', requireLogin, (req, res) => {
  const listing = loadListing(req, res);
  if (!listing) return res.status(404).render('404', { title: 'Listing not found' });
  const exists = db.prepare('SELECT 1 FROM favourites WHERE user_id = ? AND listing_id = ?').get(req.user.id, listing.id);
  if (exists) db.prepare('DELETE FROM favourites WHERE user_id = ? AND listing_id = ?').run(req.user.id, listing.id);
  else db.prepare('INSERT INTO favourites (user_id, listing_id) VALUES (?, ?)').run(req.user.id, listing.id);
  res.redirect(safeNext(req.body.next) || `/mines/${listing.slug}`);
});

// ---------- selling ----------

function listingFromForm(body, files) {
  const errors = [];
  const num = (v) => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };
  const data = {
    title: clean(body.title, 120),
    mineral: config.minerals.includes(body.mineral) ? body.mineral : '',
    location: clean(body.location, 120),
    province: config.provinces.includes(body.province) ? body.province : '',
    area_ha: num(body.area_ha),
    grade: clean(body.grade, 80) || null,
    price_usd: num(body.price_usd) ? Math.round(num(body.price_usd)) : null,
    price_label: body.price_per_block === 'on' ? 'per 10ha block' : (clean(body.price_note, 40) || null),
    negotiable: body.negotiable === 'on' ? 1 : 0,
    stage: config.stages.includes(body.stage) ? body.stage : null,
    mandate: config.mandates.includes(body.mandate) ? body.mandate : null,
    summary: clean(body.summary, 220),
    description: clean(body.description, 8000),
    infrastructure: String(body.infrastructure || '').split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 40),
    documents: [].concat(body.documents || []).filter((d) => config.documentOptions.includes(d)),
    paperwork_note: clean(body.paperwork_note, 300) || null,
    contact_name: clean(body.contact_name, 100) || null,
    contact_phone: clean(body.contact_phone, 40) || null,
    newImages: (files || []).map((f) => `/uploads/${f.filename}`),
  };
  if (!data.title) errors.push('Give your listing a title, e.g. "Kwekwe 50ha Gold Claim".');
  if (!data.mineral) errors.push('Choose the main mineral.');
  if (!data.province) errors.push('Choose the province.');
  if (!data.location) errors.push('Tell buyers the nearest town or district.');
  if (!data.area_ha) errors.push('Enter the size in hectares.');
  if (data.description.length < 40) errors.push('Write a few sentences describing the property (at least 40 characters).');
  return { data, errors };
}

function removeUploads(files) {
  for (const f of files || []) fs.unlink(f.path, () => {});
}

// Keep only images that belong to this listing (uploads or the stock library).
function keptImages(body, existing) {
  const keep = [].concat(body.keep_images || []);
  return existing.filter((src) => keep.includes(src));
}

function defaultImages(mineral) {
  const key = mineral.toLowerCase();
  const credits = require('./public/img/minerals/credits.json').filter((c) => c.mineral === key);
  return credits.length ? credits.filter((c) => !['gold-3.jpg', 'gold-5.jpg', 'chrome-3.jpg', 'quartz-3.jpg'].includes(c.file)).slice(0, 3).map((c) => `/img/minerals/${c.file}`) : ['/img/minerals/hero-1.jpg'];
}

function handleUpload(req, res, next) {
  upload.array('photos', 8)(req, res, (err) => {
    if (err) {
      res.flash('error', err.code === 'LIMIT_FILE_SIZE' ? 'One of your photos is over 6MB. Please resize it and try again.' : 'There was a problem with your photos. You can add up to 8 JPG, PNG or WebP images.');
      return res.redirect(req.originalUrl);
    }
    next();
  });
}

app.get('/sell', (req, res) => {
  res.render('sell', { title: 'List your mine', form: {}, errors: [], editing: null });
});

app.post('/sell', requireLogin, handleUpload, verifyCsrf, (req, res) => {
  const { data, errors } = listingFromForm(req.body, req.files);
  if (!isPhone(data.contact_phone || '')) errors.push('Enter a valid phone number so we can reach you.');
  if (req.body.agree !== 'on') errors.push('Please confirm you have the right to sell and accept the terms.');
  if (errors.length) {
    removeUploads(req.files);
    return res.status(400).render('sell', { title: 'List your mine', form: { ...req.body, documents: data.documents }, errors, editing: null });
  }
  const images = data.newImages.length ? data.newImages : defaultImages(data.mineral);
  const info = db.prepare(`INSERT INTO listings (slug, title, mineral, location, province, area_ha, grade, price_usd, price_label, negotiable, stage, mandate,
      summary, description, infrastructure, documents, paperwork_note, images, owner_id, contact_name, contact_phone, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
    .run(uniqueSlug(data.title), data.title, data.mineral, data.location, data.province, data.area_ha, data.grade, data.price_usd, data.price_label,
      data.negotiable, data.stage, data.mandate, data.summary || null, data.description, JSON.stringify(data.infrastructure),
      JSON.stringify(data.documents), data.paperwork_note, JSON.stringify(images), req.user.id, data.contact_name, data.contact_phone);
  res.flash('success', "Thanks! Your listing is with our team for review. We check every submission by hand and you'll see the result on your dashboard, usually within two working days.");
  res.redirect(`/dashboard#listing-${info.lastInsertRowid}`);
});

function ownedListing(req) {
  const l = hydrate(db.prepare('SELECT * FROM listings WHERE id = ?').get(Number(req.params.id)));
  if (!l) return null;
  return req.user.role === 'admin' || l.owner_id === req.user.id ? l : null;
}

function formFromListing(l) {
  return { ...l, infrastructure: l.infrastructure.join('\n'), price_per_block: l.price_label === 'per 10ha block' ? 'on' : '', price_note: l.price_label === 'per 10ha block' ? '' : l.price_label, negotiable: l.negotiable ? 'on' : '' };
}

app.get('/my/listings/:id/edit', requireLogin, (req, res) => {
  const l = ownedListing(req);
  if (!l) return res.status(404).render('404', { title: 'Listing not found' });
  res.render('sell', { title: `Edit ${l.title}`, form: formFromListing(l), errors: [], editing: l });
});

app.post('/my/listings/:id/edit', requireLogin, handleUpload, verifyCsrf, (req, res) => {
  const l = ownedListing(req);
  if (!l) { removeUploads(req.files); return res.status(404).render('404', { title: 'Listing not found' }); }
  const { data, errors } = listingFromForm(req.body, req.files);
  // Launch listings have no contact number, so admins can still edit them.
  if (req.user.role !== 'admin' && !isPhone(data.contact_phone || '')) errors.push('Enter a valid phone number so we can reach you.');
  if (errors.length) {
    removeUploads(req.files);
    return res.status(400).render('sell', { title: `Edit ${l.title}`, form: { ...req.body, documents: data.documents, images: l.images }, errors, editing: l });
  }
  let images = [...keptImages(req.body, l.images), ...data.newImages].slice(0, 12);
  if (!images.length) images = defaultImages(data.mineral);
  const isAdmin = req.user.role === 'admin';
  // Owners' edits go back through review; admins can edit live listings directly.
  const status = isAdmin ? l.status : 'pending';
  db.prepare(`UPDATE listings SET title=?, mineral=?, location=?, province=?, area_ha=?, grade=?, price_usd=?, price_label=?, negotiable=?, stage=?, mandate=?,
      summary=?, description=?, infrastructure=?, documents=?, paperwork_note=?, images=?, contact_name=?, contact_phone=?, status=?, updated_at=datetime('now') WHERE id=?`)
    .run(data.title, data.mineral, data.location, data.province, data.area_ha, data.grade, data.price_usd, data.price_label, data.negotiable, data.stage,
      data.mandate, data.summary || null, data.description, JSON.stringify(data.infrastructure), JSON.stringify(data.documents), data.paperwork_note,
      JSON.stringify(images), data.contact_name, data.contact_phone, status, l.id);
  if (isAdmin) {
    res.flash('success', 'Listing updated.');
    return res.redirect(`/admin/listings/${l.id}`);
  }
  res.flash('success', "Changes saved. Because the listing changed, it's gone back to our team for a quick review.");
  res.redirect('/dashboard');
});

app.post('/my/listings/:id/withdraw', requireLogin, (req, res) => {
  const l = ownedListing(req);
  if (!l) return res.status(404).render('404', { title: 'Listing not found' });
  db.prepare(`UPDATE listings SET status = 'withdrawn', updated_at = datetime('now') WHERE id = ?`).run(l.id);
  res.flash('success', `"${l.title}" has been taken off the market.`);
  res.redirect('/dashboard');
});

// ---------- accounts ----------

const loginAttempts = new Map();

app.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Sign in', next: safeNext(req.query.next) || '', email: '' });
});

app.post('/login', (req, res) => {
  const key = req.ip;
  const attempt = loginAttempts.get(key) || { n: 0, until: 0 };
  const next = safeNext(req.body.next);
  if (attempt.until > Date.now()) {
    res.flash('error', 'Too many sign-in attempts. Please wait a few minutes and try again.');
    return res.redirect('/login');
  }
  const email = clean(req.body.email, 150);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !verifyPassword(String(req.body.password || ''), user.password_hash)) {
    attempt.n += 1;
    if (attempt.n >= 6) { attempt.until = Date.now() + 10 * 60 * 1000; attempt.n = 0; }
    loginAttempts.set(key, attempt);
    res.locals.flash = { type: 'error', message: "That email and password don't match. Please try again." };
    return res.status(401).render('login', { title: 'Sign in', next: next || '', email });
  }
  loginAttempts.delete(key);
  startSession(res, user.id);
  res.flash('success', `Welcome back, ${user.name.split(' ')[0]}.`);
  res.redirect(next || (user.role === 'admin' ? '/admin' : '/dashboard'));
});

app.get('/register', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.render('register', { title: 'Create an account', next: safeNext(req.query.next) || '', form: {}, errors: [] });
});

app.post('/register', (req, res) => {
  const form = { name: clean(req.body.name, 100), email: clean(req.body.email, 150), phone: clean(req.body.phone, 40) };
  const password = String(req.body.password || '');
  const next = safeNext(req.body.next);
  const errors = [];
  if (!form.name) errors.push('Please tell us your name.');
  if (!isEmail(form.email)) errors.push('Please enter a valid email address.');
  if (!isPhone(form.phone)) errors.push('Please enter a valid phone number.');
  if (password.length < 8) errors.push('Your password needs at least 8 characters.');
  if (req.body.agree !== 'on') errors.push('Please accept the Terms & Conditions and Privacy Policy.');
  if (!errors.length && db.prepare('SELECT 1 FROM users WHERE email = ?').get(form.email)) errors.push('There is already an account with that email. Try signing in instead.');
  if (errors.length) return res.status(400).render('register', { title: 'Create an account', next: next || '', form, errors });
  const info = db.prepare('INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)').run(form.name, form.email, form.phone, hashPassword(password));
  startSession(res, info.lastInsertRowid);
  res.flash('success', `Welcome aboard, ${form.name.split(' ')[0]}! Your account is ready.`);
  res.redirect(next || '/dashboard');
});

app.post('/logout', (req, res) => {
  if (req.cookies.sid) db.prepare('DELETE FROM sessions WHERE token = ?').run(req.cookies.sid);
  res.clearCookie('sid', cookieOpts);
  res.flash('info', "You've been signed out. See you soon.");
  res.redirect('/');
});

app.get('/dashboard', requireLogin, (req, res) => {
  const uid = req.user.id;
  const listings = db.prepare('SELECT * FROM listings WHERE owner_id = ? ORDER BY created_at DESC').all(uid).map(hydrate);
  const offers = db.prepare(`SELECT o.*, l.title, l.slug FROM offers o JOIN listings l ON l.id = o.listing_id WHERE o.user_id = ? ORDER BY o.created_at DESC`).all(uid);
  const saved = db.prepare(`SELECT l.* FROM favourites f JOIN listings l ON l.id = f.listing_id WHERE f.user_id = ? AND l.status IN ('approved','under_offer','sold')`).all(uid).map(hydrate);
  const enquiries = db.prepare(`SELECT e.*, l.title, l.slug FROM enquiries e LEFT JOIN listings l ON l.id = e.listing_id WHERE e.user_id = ? ORDER BY e.created_at DESC LIMIT 20`).all(uid);
  res.render('dashboard', { title: 'Your dashboard', listings, offers, saved, enquiries });
});

app.get('/account', requireLogin, (req, res) => res.render('account', { title: 'Your account', errors: [] }));

app.post('/account', requireLogin, (req, res) => {
  const errors = [];
  const name = clean(req.body.name, 100);
  const phone = clean(req.body.phone, 40);
  if (!name) errors.push('Your name cannot be empty.');
  if (req.user.role !== 'admin' && !isPhone(phone)) errors.push('Please enter a valid phone number.');
  const newPassword = String(req.body.new_password || '');
  if (newPassword) {
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(req.body.current_password || ''), row.password_hash)) errors.push('Your current password is incorrect.');
    if (newPassword.length < 8) errors.push('Your new password needs at least 8 characters.');
  }
  if (errors.length) return res.status(400).render('account', { title: 'Your account', errors });
  db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone || null, req.user.id);
  if (newPassword) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.cookies.sid);
  }
  res.flash('success', 'Your details have been updated.');
  res.redirect('/account');
});

// ---------- static content ----------

app.get('/about', (req, res) => res.render('about', { title: 'About us' }));
app.get('/how-it-works', (req, res) => res.render('how', { title: 'How it works' }));
app.get('/terms', (req, res) => res.render('legal/terms', { title: 'Terms & Conditions' }));
app.get('/privacy', (req, res) => res.render('legal/privacy', { title: 'Privacy Policy' }));
app.get('/cookies', (req, res) => res.render('legal/cookies', { title: 'Cookie Policy' }));
app.get('/image-credits', (req, res) => res.render('credits', { title: 'Image credits', credits: require('./public/img/minerals/credits.json') }));

app.get('/contact', (req, res) => res.render('contact', { title: 'Contact us' }));
app.post('/contact', (req, res) => {
  const name = clean(req.body.name, 100);
  const email = clean(req.body.email, 150);
  const phone = clean(req.body.phone, 40);
  const message = clean(req.body.message, 3000);
  if (req.body.website) return res.redirect('/contact');
  if (!name || !isEmail(email) || !isPhone(phone) || !message) {
    res.flash('error', 'Please fill in your name, a valid email, a valid phone number and your message.');
    return res.redirect('/contact');
  }
  db.prepare(`INSERT INTO enquiries (user_id, kind, name, email, phone, message) VALUES (?, 'general', ?, ?, ?, ?)`)
    .run(req.user?.id ?? null, name, email, clean(req.body.phone, 40), message);
  res.flash('success', `Thanks ${name.split(' ')[0]}, your message is with us. We usually reply within one working day.`);
  res.redirect('/contact');
});

// ---------- admin ----------

const admin = express.Router();
admin.use(requireAdmin);

admin.get('/', (req, res) => {
  const count = (sql) => db.prepare(sql).get().n;
  const stats = {
    pending: count(`SELECT COUNT(*) AS n FROM listings WHERE status = 'pending'`),
    live: count(`SELECT COUNT(*) AS n FROM listings WHERE status IN ('approved','under_offer')`),
    sold: count(`SELECT COUNT(*) AS n FROM listings WHERE status = 'sold'`),
    newEnquiries: count(`SELECT COUNT(*) AS n FROM enquiries WHERE status = 'new'`),
    pendingOffers: count(`SELECT COUNT(*) AS n FROM offers WHERE status = 'pending'`),
    users: count(`SELECT COUNT(*) AS n FROM users`),
  };
  const pending = db.prepare(`SELECT l.*, u.name AS owner_name FROM listings l LEFT JOIN users u ON u.id = l.owner_id WHERE l.status = 'pending' ORDER BY l.created_at ASC LIMIT 10`).all().map(hydrate);
  const enquiries = db.prepare(`SELECT e.*, l.title FROM enquiries e LEFT JOIN listings l ON l.id = e.listing_id WHERE e.status = 'new' ORDER BY e.created_at DESC LIMIT 6`).all();
  const offers = db.prepare(`SELECT o.*, l.title, u.name FROM offers o JOIN listings l ON l.id = o.listing_id JOIN users u ON u.id = o.user_id WHERE o.status = 'pending' ORDER BY o.created_at DESC LIMIT 6`).all();
  res.render('admin/index', { title: 'Admin', stats, pending, enquiries, offers });
});

admin.get('/listings', (req, res) => {
  const statuses = ['pending', 'approved', 'under_offer', 'sold', 'declined', 'withdrawn'];
  const status = statuses.includes(req.query.status) ? req.query.status : null;
  const rows = db.prepare(`SELECT l.*, u.name AS owner_name, u.email AS owner_email,
      (SELECT COUNT(*) FROM enquiries e WHERE e.listing_id = l.id) AS enquiry_count,
      (SELECT COUNT(*) FROM offers o WHERE o.listing_id = l.id) AS offer_count
    FROM listings l LEFT JOIN users u ON u.id = l.owner_id ${status ? 'WHERE l.status = ?' : ''}
    ORDER BY CASE l.status WHEN 'pending' THEN 0 ELSE 1 END, l.created_at DESC`).all(...(status ? [status] : [])).map(hydrate);
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) AS n FROM listings GROUP BY status').all().map((r) => [r.status, r.n]));
  res.render('admin/listings', { title: 'Listings', rows, status, statuses, counts });
});

admin.get('/listings/:id', (req, res) => {
  const l = hydrate(db.prepare(`SELECT l.*, u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone FROM listings l
    LEFT JOIN users u ON u.id = l.owner_id WHERE l.id = ?`).get(Number(req.params.id)));
  if (!l) return res.status(404).render('404', { title: 'Listing not found' });
  const enquiries = db.prepare('SELECT * FROM enquiries WHERE listing_id = ? ORDER BY created_at DESC').all(l.id);
  const offers = db.prepare('SELECT o.*, u.name, u.email FROM offers o JOIN users u ON u.id = o.user_id WHERE listing_id = ? ORDER BY o.created_at DESC').all(l.id);
  res.render('admin/listing', { title: l.title, l, enquiries, offers });
});

admin.post('/listings/:id/review', (req, res) => {
  const id = Number(req.params.id);
  const decision = req.body.decision;
  const note = clean(req.body.admin_note, 1000) || null;
  if (decision === 'approve') {
    db.prepare(`UPDATE listings SET status = 'approved', admin_note = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(note, id);
    res.flash('success', 'Listing approved. It is now live on the site.');
  } else if (decision === 'decline') {
    if (!note) {
      res.flash('error', 'Please add a short reason so the seller knows what to fix.');
      return res.redirect(`/admin/listings/${id}`);
    }
    db.prepare(`UPDATE listings SET status = 'declined', admin_note = ?, reviewed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(note, id);
    res.flash('success', 'Listing declined. The seller will see your note on their dashboard.');
  }
  res.redirect(req.body.back === 'queue' ? '/admin/listings?status=pending' : `/admin/listings/${id}`);
});

admin.post('/listings/:id/status', (req, res) => {
  const id = Number(req.params.id);
  if (['approved', 'under_offer', 'sold', 'withdrawn'].includes(req.body.status)) {
    db.prepare(`UPDATE listings SET status = ?, updated_at = datetime('now') WHERE id = ?`).run(req.body.status, id);
    res.flash('success', 'Status updated.');
  }
  res.redirect(`/admin/listings/${id}`);
});

admin.post('/listings/:id/feature', (req, res) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE listings SET featured = 1 - featured WHERE id = ?').run(id);
  res.redirect(`/admin/listings/${id}`);
});

admin.post('/listings/:id/delete', (req, res) => {
  const l = hydrate(db.prepare('SELECT * FROM listings WHERE id = ?').get(Number(req.params.id)));
  if (l) {
    l.images.filter((src) => src.startsWith('/uploads/')).forEach((src) => fs.unlink(path.join(uploadDir, path.basename(src)), () => {}));
    db.prepare('DELETE FROM listings WHERE id = ?').run(l.id);
    res.flash('success', `"${l.title}" was deleted.`);
  }
  res.redirect('/admin/listings');
});

admin.get('/enquiries', (req, res) => {
  const status = ['new', 'replied', 'closed'].includes(req.query.status) ? req.query.status : null;
  const rows = db.prepare(`SELECT e.*, l.title, l.slug FROM enquiries e LEFT JOIN listings l ON l.id = e.listing_id
    ${status ? 'WHERE e.status = ?' : ''} ORDER BY e.created_at DESC LIMIT 200`).all(...(status ? [status] : []));
  res.render('admin/enquiries', { title: 'Enquiries', rows, status });
});

admin.post('/enquiries/:id/status', (req, res) => {
  if (['new', 'replied', 'closed'].includes(req.body.status)) db.prepare('UPDATE enquiries SET status = ? WHERE id = ?').run(req.body.status, Number(req.params.id));
  res.redirect(safeNext(req.body.back) || '/admin/enquiries');
});

admin.get('/offers', (req, res) => {
  const rows = db.prepare(`SELECT o.*, l.title, l.slug, l.price_usd, l.price_label, l.status AS listing_status, u.name, u.email, u.phone AS user_phone
    FROM offers o JOIN listings l ON l.id = o.listing_id JOIN users u ON u.id = o.user_id
    ORDER BY CASE o.status WHEN 'pending' THEN 0 ELSE 1 END, o.created_at DESC LIMIT 200`).all();
  res.render('admin/offers', { title: 'Offers', rows });
});

admin.post('/offers/:id/decide', (req, res) => {
  const offer = db.prepare('SELECT * FROM offers WHERE id = ?').get(Number(req.params.id));
  const note = clean(req.body.admin_note, 1000) || null;
  if (offer && ['accepted', 'declined'].includes(req.body.decision)) {
    db.prepare('UPDATE offers SET status = ?, admin_note = ? WHERE id = ?').run(req.body.decision, note, offer.id);
    if (req.body.decision === 'accepted') {
      db.prepare(`UPDATE listings SET status = 'under_offer', updated_at = datetime('now') WHERE id = ? AND status = 'approved'`).run(offer.listing_id);
      res.flash('success', 'Offer accepted. The listing is now marked "Under offer".');
    } else {
      res.flash('success', 'Offer declined.');
    }
  }
  res.redirect(safeNext(req.body.back) || '/admin/offers');
});

admin.get('/users', (req, res) => {
  const rows = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM listings l WHERE l.owner_id = u.id) AS listing_count,
    (SELECT COUNT(*) FROM offers o WHERE o.user_id = u.id) AS offer_count FROM users u ORDER BY u.created_at DESC`).all();
  res.render('admin/users', { title: 'Users', rows });
});

admin.post('/users/:id/role', (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    res.flash('error', "You can't change your own role.");
  } else if (['user', 'admin'].includes(req.body.role)) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, id);
    res.flash('success', 'Role updated.');
  }
  res.redirect('/admin/users');
});

app.use('/admin', admin);

// ---------- errors ----------

app.use((req, res) => res.status(404).render('404', { title: 'Page not found' }));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).render('error', { title: 'Something went wrong', message: "Sorry, something broke on our side. Please try again in a moment." });
});

app.listen(config.port, () => console.log(`  ${config.siteName} running at http://localhost:${config.port}`));
