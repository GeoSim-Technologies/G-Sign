require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true })

const express      = require('express')
const multer       = require('multer')
const path         = require('path')
const fs           = require('fs')
const cookieParser = require('cookie-parser')
const { requireAuth, verifyToken, getUser } = require('../shared/auth')

const app         = express()
const PORT        = process.env.PORT || 3004
const DATA_FILE   = path.join(__dirname, 'data.json')
const UPLOADS_DIR = process.env.GSIGN_UPLOADS_DIR || path.join(__dirname, 'uploads')

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
}

// ── Data helpers ──────────────────────────────────────────────────────────────
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const stored = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
      const hasValidCrop =
        stored.crop &&
        Number.isFinite(stored.crop.x) &&
        Number.isFinite(stored.crop.y) &&
        Number.isFinite(stored.crop.width) &&
        Number.isFinite(stored.crop.height) &&
        stored.crop.width > 0 &&
        stored.crop.height > 0

      return {
        message:   typeof stored.message === 'string' ? stored.message : 'Welcome!',
        image:     stored.image || null,
        logo:      stored.logo  || null,
        imageMode: stored.imageMode === 'crop' ? 'crop' : 'fit',
        crop:      hasValidCrop ? {
          x:      Number(stored.crop.x),
          y:      Number(stored.crop.y),
          width:  Number(stored.crop.width),
          height: Number(stored.crop.height)
        } : null
      }
    }
  } catch (e) {
    console.error('Failed to load data.json:', e.message)
  }
  return { message: 'Welcome!', image: null, logo: null, imageMode: 'fit', crop: null }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2))
}

// ── SSE broadcast ─────────────────────────────────────────────────────────────
const sseClients = new Set()

function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`
  sseClients.forEach(res => res.write(payload))
}

// ── Multer (image uploads only, max 10 MB) ────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    cb(null, file.fieldname + ext)
  }
})

const imageFilter = (req, file, cb) => {
  if (/\.(jpe?g|png|gif|webp|svg)$/i.test(path.extname(file.originalname))) {
    cb(null, true)
  } else {
    cb(new Error('Only image files are allowed'))
  }
}

const upload = multer({
  storage,
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }
})

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cookieParser())
app.use(express.urlencoded({ extended: false }))

// ── Protected routes (must be before express.static so /admin.html can't bypass auth) ──
app.get('/admin.html', (req, res) => res.redirect('/admin'))

app.get('/admin', (req, res) => {
  const token = req.cookies?.token
  if (!token) return res.redirect('https://portal.bentestshis.app')
  try {
    const { id } = verifyToken(token)
    const user = getUser(id)
    if (!user) return res.redirect('https://portal.bentestshis.app')
    res.sendFile(path.join(__dirname, 'public', 'admin.html'))
  } catch {
    res.redirect('https://portal.bentestshis.app')
  }
})

app.post(
  '/api/update',
  requireAuth,
  upload.fields([{ name: 'image', maxCount: 1 }, { name: 'logo', maxCount: 1 }]),
  (req, res) => {
    const data = loadData()
    const uploadedNewImage = !!req.files?.image?.[0]

    if (typeof req.body.message === 'string') {
      data.message = req.body.message.trim()
    }

    data.imageMode = req.body.imageMode === 'crop' ? 'crop' : 'fit'

    if (req.body.clearImage === 'on') {
      data.image = null
      data.crop  = null
    } else if (req.files?.image?.[0]) {
      data.image = `/uploads/${req.files.image[0].filename}?t=${Date.now()}`
      data.crop  = null
    }

    if (req.body.clearLogo === 'on') {
      data.logo = null
    } else if (req.files?.logo?.[0]) {
      data.logo = `/uploads/${req.files.logo[0].filename}?t=${Date.now()}`
    }

    const cropX      = Number(req.body.cropX)
    const cropY      = Number(req.body.cropY)
    const cropWidth  = Number(req.body.cropWidth)
    const cropHeight = Number(req.body.cropHeight)
    const hasCropData =
      Number.isFinite(cropX)      &&
      Number.isFinite(cropY)      &&
      Number.isFinite(cropWidth)  &&
      Number.isFinite(cropHeight) &&
      cropWidth > 0 &&
      cropHeight > 0

    if (hasCropData) {
      data.crop = { x: cropX, y: cropY, width: cropWidth, height: cropHeight }
    } else if (uploadedNewImage) {
      data.crop = null
    }

    saveData(data)
    broadcast(data)
    res.redirect('/admin?saved=1')
  }
)

// ── Public routes ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/sign'))

app.get('/sign', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'sign.html'))
})

app.get('/api/data', (req, res) => {
  res.json(loadData())
})

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type',  'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection',    'keep-alive')
  res.flushHeaders()

  res.write(`data: ${JSON.stringify(loadData())}\n\n`)

  sseClients.add(res)
  req.on('close', () => sseClients.delete(res))
})

// ── Static files ──────────────────────────────────────────────────────────────
app.use('/uploads', express.static(UPLOADS_DIR))
app.use(express.static(path.join(__dirname, 'public')))

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\nG-Sign is running!`)
  console.log(`  Sign display : http://localhost:${PORT}/sign`)
  console.log(`  Admin panel  : http://localhost:${PORT}/admin\n`)
})
