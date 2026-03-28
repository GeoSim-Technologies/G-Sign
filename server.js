const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const app        = express();
const PORT       = process.env.PORT || 3000;
const DATA_FILE  = path.join(__dirname, 'data.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ── Data helpers ────────────────────────────────────────────────────────────
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load data.json:', e.message);
  }
  return { message: 'Welcome!', image: null, logo: null };
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ── SSE broadcast ────────────────────────────────────────────────────────────
const sseClients = new Set();

function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(res => res.write(payload));
}

// ── Multer (image uploads only, max 10 MB) ───────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    // Use a fixed name per field so old uploads are overwritten
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, file.fieldname + ext);
  }
});

const imageFilter = (req, file, cb) => {
  const allowed = /\.(jpe?g|png|gif|webp|svg)$/i;
  if (allowed.test(path.extname(file.originalname))) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'));
  }
};

const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
});

// ── Middleware ────────────────────────────────────────────────────────────────
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/sign'));

app.get('/sign', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sign.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Current data (JSON)
app.get('/api/data', (req, res) => {
  res.json(loadData());
});

// Server-Sent Events — sign page subscribes here for instant updates
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  // Send current data immediately on connect
  res.write(`data: ${JSON.stringify(loadData())}\n\n`);

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

// Update data from admin form
app.post(
  '/api/update',
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'logo', maxCount: 1 }]),
  (req, res) => {
    const data = loadData();

    if (typeof req.body.message === 'string') {
      data.message = req.body.message.trim();
    }

    if (req.body.clearImage === 'on') {
      data.image = null;
    } else if (req.files?.image?.[0]) {
      const fname = req.files.image[0].filename;
      data.image = `/uploads/${fname}?t=${Date.now()}`;
    }

    if (req.body.clearLogo === 'on') {
      data.logo = null;
    } else if (req.files?.logo?.[0]) {
      const fname = req.files.logo[0].filename;
      data.logo = `/uploads/${fname}?t=${Date.now()}`;
    }

    saveData(data);
    broadcast(data);           // push to all sign displays instantly
    res.redirect('/admin?saved=1');
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nG-Sign is running!`);
  console.log(`  Sign display : http://localhost:${PORT}/sign`);
  console.log(`  Admin panel  : http://localhost:${PORT}/admin\n`);
});
