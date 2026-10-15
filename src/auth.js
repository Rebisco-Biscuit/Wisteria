// Single-password auth. The session cookie is just an expiry signed with an
// HMAC, so there's no session store to keep around. Changing APP_PASSWORD
// logs every device out.
const crypto = require('crypto');

const COOKIE = 'wisteria_session';
const SESSION_DAYS = 30;

function createAuth({ password, secret, secure }) {
  const pwHash = crypto.createHash('sha256').update(password).digest();
  const key = secret || crypto.createHash('sha256').update('wisteria-session:' + password).digest('hex');
  const fingerprint = pwHash.toString('hex').slice(0, 16);

  const sign = (value) => crypto.createHmac('sha256', key).update(`${value}:${fingerprint}`).digest('base64url');

  function checkPassword(attempt) {
    const h = crypto.createHash('sha256').update(String(attempt || '')).digest();
    return crypto.timingSafeEqual(h, pwHash);
  }

  function readCookie(req) {
    const header = req.headers.cookie || '';
    for (const part of header.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === COOKIE) return decodeURIComponent(rest.join('='));
    }
    return null;
  }

  function isAuthed(req) {
    const token = readCookie(req);
    if (!token) return false;
    const [exp, sig] = token.split('.');
    if (!exp || !sig || Number(exp) < Date.now()) return false;
    const expected = sign(exp);
    return sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  }

  function setSession(res) {
    const exp = Date.now() + SESSION_DAYS * 864e5;
    res.cookie(COOKIE, `${exp}.${sign(exp)}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      maxAge: SESSION_DAYS * 864e5,
      path: '/',
    });
  }

  function clearSession(res) {
    res.clearCookie(COOKIE, { path: '/' });
  }

  // Slow down anyone guessing: 10 misses per IP every 15 minutes.
  const misses = new Map();
  function tooManyAttempts(ip) {
    const entry = misses.get(ip);
    if (!entry || entry.until < Date.now()) return false;
    return entry.count >= 10;
  }
  function recordMiss(ip) {
    const now = Date.now();
    const entry = misses.get(ip);
    if (!entry || entry.until < now) misses.set(ip, { count: 1, until: now + 15 * 60e3 });
    else entry.count++;
    if (misses.size > 1000) for (const [k, v] of misses) if (v.until < now) misses.delete(k);
  }

  function requireAuth(req, res, next) {
    if (!isAuthed(req)) return res.status(401).json({ error: 'Not signed in' });
    // every write comes from our own fetch() calls, which always send this header;
    // a cross-site form post can't, so this doubles as CSRF protection
    if (req.method !== 'GET' && req.get('x-wisteria') !== '1') {
      return res.status(403).json({ error: 'Missing request header' });
    }
    next();
  }

  return { checkPassword, isAuthed, setSession, clearSession, tooManyAttempts, recordMiss, requireAuth };
}

module.exports = { createAuth };
