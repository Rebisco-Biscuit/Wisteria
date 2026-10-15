require('dotenv').config();
const os = require('os');
const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { createStorage } = require('./src/storage');
const { createAuth } = require('./src/auth');
const vault = require('./src/vault');

const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === 'production';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 2048);

if (!process.env.APP_PASSWORD) {
  console.error('APP_PASSWORD is not set. Set it before starting the vault.');
  process.exit(1);
}

const storage = createStorage();
const auth = createAuth({
  password: process.env.APP_PASSWORD,
  secret: process.env.SESSION_SECRET,
  secure: PROD,
});

const tmpDir = path.join(process.env.TMP_DIR || os.tmpdir(), 'wisteria-uploads');
fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({
  dest: tmpDir,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 50 },
});

// Uploads, moves and deletes go through one at a time so two uploads
// can't race each other while regrouping.
let queue = Promise.resolve();
const exclusive = (fn) => {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
};

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff', avif: 'image/avif',
  heic: 'image/heic', heif: 'image/heif', svg: 'image/svg+xml', ico: 'image/x-icon',
};

// Only accept keys that look exactly like something we'd have written ourselves.
function validKey(key) {
  if (typeof key !== 'string') return null;
  const parts = key.split('/');
  if (parts.length > 2 || parts.some((p) => vault.safeName(p) !== p)) return null;
  return key;
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  next();
});
app.use(express.json({ limit: '10kb' }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

app.get('/healthz', (req, res) => res.send('ok'));

app.get('/api/session', (req, res) => {
  res.json({ authed: auth.isAuthed(req) });
});

app.post('/api/login', (req, res) => {
  if (auth.tooManyAttempts(req.ip)) {
    return res.status(429).json({ error: 'Too many tries. Wait a bit and try again.' });
  }
  if (!auth.checkPassword(req.body && req.body.password)) {
    auth.recordMiss(req.ip);
    return res.status(401).json({ error: 'Wrong password' });
  }
  auth.setSession(res);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  auth.clearSession(res);
  res.json({ ok: true });
});

app.use('/api', auth.requireAuth);

app.get('/api/vault', async (req, res, next) => {
  try {
    res.json(vault.buildTree(await storage.list()));
  } catch (err) {
    next(err);
  }
});

app.post('/api/upload', upload.array('files'), async (req, res, next) => {
  const files = req.files || [];
  try {
    const result = await exclusive(async () => {
      const keys = (await storage.list()).map((i) => i.key);
      const saved = [];
      const skipped = [];
      for (const file of files) {
        // multer hands back latin1-decoded names; browsers send utf8
        const name = vault.safeName(Buffer.from(file.originalname, 'latin1').toString('utf8'));
        if (!name) {
          skipped.push(file.originalname);
          await fs.promises.rm(file.path, { force: true });
          continue;
        }
        const dest = vault.destinationFor(name, keys);
        await storage.put(dest, file.path);
        if (!keys.includes(dest)) keys.push(dest);
        saved.push(dest);
      }

      const moves = vault.planRegroup(keys);
      for (const m of moves) await storage.move(m.from, m.to);
      const moved = new Map(moves.map((m) => [m.from, m.to]));
      return { saved: saved.map((k) => moved.get(k) || k), skipped };
    });
    res.json(result);
  } catch (err) {
    for (const f of files) fs.promises.rm(f.path, { force: true }).catch(() => {});
    next(err);
  }
});

app.get('/api/file', async (req, res, next) => {
  const key = validKey(req.query.key);
  if (!key) return res.status(400).json({ error: 'Bad file name' });
  try {
    const file = await storage.read(key);
    if (!file) return res.status(404).json({ error: 'Not found' });
    const name = key.split('/').pop();
    const type = MIME[vault.extOf(name)] || 'application/octet-stream';
    res.set('Content-Type', type);
    if (file.size != null) res.set('Content-Length', String(file.size));
    res.set('Cache-Control', 'private, max-age=300');
    // stops an uploaded svg from running scripts if opened directly
    res.set('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
    const disposition = req.query.download || type === 'application/octet-stream' ? 'attachment' : 'inline';
    res.set('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`);
    file.stream.on('error', next).pipe(res);
  } catch (err) {
    next(err);
  }
});

app.delete('/api/file', async (req, res, next) => {
  const key = validKey(req.query.key);
  if (!key) return res.status(400).json({ error: 'Bad file name' });
  try {
    await exclusive(() => storage.remove(key));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.delete('/api/folder', async (req, res, next) => {
  const name = req.query.name;
  if (!validKey(name) || name.includes('/')) return res.status(400).json({ error: 'Bad folder name' });
  try {
    await exclusive(() => storage.removeFolder(name));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? `File is over the ${MAX_UPLOAD_MB} MB limit` : err.message;
    return res.status(413).json({ error: msg });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
});

app.listen(PORT, () => {
  console.log(`Wisteria is up on port ${PORT} (storage: ${storage.kind})`);
});
