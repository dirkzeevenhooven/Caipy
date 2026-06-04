// storage.js — persistence layer for trip profiles and guide records.
//
// File-based JSON storage on a persistent disk, deliberately isolated behind
// four functions so the rest of the app never touches the storage mechanism
// directly. To migrate to Postgres later, reimplement ONLY these four exported
// functions — no caller changes required.
//
// Render persistent disk must be mounted at DATA_DIR (default: /var/data).

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || (process.env.RENDER ? '/var/data' : path.join(__dirname, '.data'));
const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
const GUIDES_DIR = path.join(DATA_DIR, 'guides');

// Ensure storage directories exist on startup.
for (const dir of [PROFILES_DIR, GUIDES_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    console.error('[storage] Could not create directory', dir, '—', err.message);
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

// Hash the email so the filename is always filesystem-safe regardless of input.
function emailKey(email) {
  return crypto.createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null; // missing file or unparseable → treat as no record
  }
}

// Atomic write: write to a temp file then rename, so a crash mid-write can't
// leave a half-written (corrupt) record behind.
function writeJson(filePath, data) {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// ─── Public API ───────────────────────────────────────────────────────────────

// Save (or overwrite) the trip profile for an email.
function saveTripProfile(email, data) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('saveTripProfile: email is required');
  const filePath = path.join(PROFILES_DIR, `${emailKey(normalized)}.json`);
  writeJson(filePath, { email: normalized, data, updatedAt: new Date().toISOString() });
}

// Return the stored trip profile data for an email, or null if none.
function getTripProfile(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const record = readJson(path.join(PROFILES_DIR, `${emailKey(normalized)}.json`));
  return record ? record.data : null;
}

// Append a guide record to an email's list. Supports multiple guides per email.
function saveGuideRecord(email, guideId, guideUrl) {
  const normalized = normalizeEmail(email);
  if (!normalized) throw new Error('saveGuideRecord: email is required');
  if (!guideId) throw new Error('saveGuideRecord: guideId is required');
  const filePath = path.join(GUIDES_DIR, `${emailKey(normalized)}.json`);
  const existing = readJson(filePath);
  const record = existing && Array.isArray(existing.guides)
    ? existing
    : { email: normalized, guides: [] };
  record.guides.push({ guideId, guideUrl: guideUrl || null, createdAt: new Date().toISOString() });
  writeJson(filePath, record);
}

// Return all guide records for an email (newest first), or [] if none.
function getGuideByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return [];
  const record = readJson(path.join(GUIDES_DIR, `${emailKey(normalized)}.json`));
  if (!record || !Array.isArray(record.guides)) return [];
  return [...record.guides].reverse();
}

module.exports = { saveTripProfile, getTripProfile, saveGuideRecord, getGuideByEmail };
