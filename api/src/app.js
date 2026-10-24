require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const csrfGuard = require('./middleware/csrf');

const connectDB = require('./config/db');
const Cart = require('./models/Cart');
const Wishlist = require('./models/Wishlist');
const makeListRouter = require('./routes/lists');
const { stripOperators } = require('./utils/helpers');
const { notFound, errorHandler } = require('./middleware/error');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET is missing or shorter than 32 characters. Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to start without a strong JWT_SECRET.');
}

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

const DEFAULT_ORIGINS = [
  'https://msukasha.com', 'https://www.msukasha.com',
  'https://sellermsukasha.com', 'https://www.sellermsukasha.com'
];
const origins = (process.env.CORS_ORIGINS || DEFAULT_ORIGINS.join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const APP = (process.env.APP_URL || '').replace(/\/$/, '');
if (APP && !origins.includes(APP)) origins.push(APP);
if (process.env.NODE_ENV !== 'production') origins.push('http://localhost:3000', 'http://127.0.0.1:3000', 'http://127.0.0.1:5500', 'http://localhost:5500');

app.use(cors({
  origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  maxAge: 86400
}));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
// Cookie-authenticated unsafe requests must originate from our own sites.
app.use('/api', csrfGuard(origins));
app.use((req, res, next) => { stripOperators(req.body); stripOperators(req.query); next(); });

const limiter = (windowMs, max, message) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  message: { error: message || 'Too many requests. Please try again later.' }
});

// Health check (no database needed)
app.get('/api/health', (req, res) => res.json({
  ok: true, service: 'msukasha-api',
  config: { jwt: !!process.env.JWT_SECRET && process.env.JWT_SECRET.length >= 32, database: !!process.env.MONGODB_URI, email: process.env.EMAIL_ENABLED === 'true' && !!process.env.SMTP_HOST, uploads: require('./lib/storage').isConfigured() }
}));

app.use('/api', limiter(15 * 60 * 1000, 600));
app.use(['/api/login', '/api/register', '/api/auth/login', '/api/auth/register', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/resend-verification'], limiter(15 * 60 * 1000, 20, 'Too many attempts. Please try again in a few minutes.'));
app.post(['/api/rfqs', '/api/conversations', '/api/reports', '/api/support/tickets', '/api/c2c'], limiter(60 * 60 * 1000, 40));
app.post(['/api/contact', '/api/job-application', '/api/verification', '/api/partner', '/api/book-call', '/api/ads'],
  limiter(60 * 60 * 1000, 15));
app.post('/api/business-ads', limiter(60 * 60 * 1000, 10));

// Connect to MongoDB (cached between serverless calls)
app.use('/api', async (req, res, next) => {
  try { await connectDB(); next(); }
  catch (err) {
    console.error('Database connection failed:', err.message);
    res.status(503).json({ error: 'Service temporarily unavailable. Please try again shortly.' });
  }
});

app.use('/api', require('./routes/auth'));            // /register /login /profile /password
app.use('/api/cart', makeListRouter(Cart));
app.use('/api/wishlist', makeListRouter(Wishlist));
app.use('/api/categories', require('./routes/categories'));
app.use('/api', require('./routes/business'));        // /business/* /uploads/sign /suppliers
app.use('/api', require('./routes/dashboard'));       // /dashboard/supplier /dashboard/buyer
app.use('/api', require('./routes/social'));          // /favorites /notifications /reports /support /referrals /pages
app.use('/api/rfqs', require('./routes/rfq'));
app.use('/api/conversations', require('./routes/conversations'));
app.use('/api/c2c', require('./routes/c2c'));
app.use('/api/products', require('./routes/products'));
app.use('/api/ads', require('./routes/ads'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/seller', require('./routes/seller'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api', require('./routes/forms'));           // /contact /job-application /verification /partner /book-call
app.use('/api/business-ads', require('./routes/businessAds'));
app.use('/api/admin', require('./routes/admin2'));
app.use('/api/admin', require('./routes/admin'));     // legacy ad / submission admin

app.use(notFound);
app.use(errorHandler);

module.exports = app;
