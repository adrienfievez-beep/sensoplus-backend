require('dotenv').config({ path: '.env.test' });
const request = require('supertest');

// Import de l'app sans démarrer le serveur HTTP
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const authRoutes = require('../src/routes/auth');
const dataRoutes = require('../src/routes/data');
const alertRoutes = require('../src/routes/alerts');
const stateRoutes = require('../src/routes/state');
const thresholdRoutes = require('../src/routes/thresholds');
const adminRoutes = require('../src/routes/admin');

function buildApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(morgan('silent'));

  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 9999 });

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/v1/auth', limiter, authRoutes);
  app.use('/api/v1/data', limiter, dataRoutes);
  app.use('/api/v1/alerts', limiter, alertRoutes);
  app.use('/api/v1/state', limiter, stateRoutes);
  app.use('/api/v1/thresholds', limiter, thresholdRoutes);
  app.use('/api/admin', limiter, adminRoutes);

  app.use((req, res) => res.status(404).json({ error: 'Route not found' }));
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message });
  });

  return app;
}

const app = buildApp();
const agent = request(app);

/**
 * Enregistre un utilisateur et retourne { token, user }.
 */
async function registerUser(overrides = {}) {
  const payload = {
    email: `test_${Date.now()}@example.com`,
    password: 'Test1234!',
    first_name: 'Test',
    last_name: 'User',
    age: 40,
    ...overrides,
  };

  const res = await agent.post('/api/v1/auth/register').send(payload);
  if (res.status !== 201) throw new Error(`Register failed: ${JSON.stringify(res.body)}`);
  return { token: res.body.access_token, user: res.body.user };
}

/**
 * Retourne un header Authorization prêt à l'emploi.
 */
function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

module.exports = { app, agent, registerUser, authHeader };
