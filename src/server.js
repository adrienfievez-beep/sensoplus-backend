require('dotenv').config();
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./docs/swagger');
const logger = require('./utils/logger');
const socketService = require('./services/socketService');
const { purgeExpiredTokens } = require('./services/tokenService');
const authRoutes = require('./routes/auth');
const dataRoutes = require('./routes/data');
const alertRoutes = require('./routes/alerts');
const stateRoutes = require('./routes/state');
const thresholdRoutes = require('./routes/thresholds');
const adminRoutes = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security ─────────────────────────────────────────────────
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Rate limiting ─────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500,
  message: { error: 'Too many requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts, please try again later.' },
});

// ── Parsing ───────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('dev'));

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'SENSO+ API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ── Documentation Swagger ─────────────────────────────────────
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'SENSO+ API Docs',
  customCss: '.swagger-ui .topbar { background-color: #1a1a2e; }',
}));
app.get('/api/docs.json', (req, res) => res.json(swaggerSpec));

// ── Routes ────────────────────────────────────────────────────
app.use('/api/v1/auth', authLimiter, authRoutes);
app.use('/api/v1/data', apiLimiter, dataRoutes);
app.use('/api/v1/alerts', apiLimiter, alertRoutes);
app.use('/api/v1/state', apiLimiter, stateRoutes);
app.use('/api/v1/thresholds', apiLimiter, thresholdRoutes);
app.use('/api/admin', apiLimiter, adminRoutes);

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error(err.message, err);
  const status = err.status || 500;
  res.status(status).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

// ── Start ─────────────────────────────────────────────────────
const httpServer = http.createServer(app);
socketService.init(httpServer);

httpServer.listen(PORT, () => {
  logger.info(`SENSO+ API running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`);

  // Purge des refresh tokens expirés toutes les 6h
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  setInterval(purgeExpiredTokens, SIX_HOURS);
});

module.exports = { app, httpServer };
