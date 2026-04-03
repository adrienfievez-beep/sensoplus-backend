const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');
const logger = require('../utils/logger');

let io = null;

/**
 * Initialise le serveur Socket.io sur le serveur HTTP.
 * @param {import('http').Server} httpServer
 */
function init(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
      methods: ['GET', 'POST'],
    },
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  // ── Middleware d'authentification JWT ───────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
      if (!token) return next(new Error('Missing token'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const result = await pool.query(
        'SELECT id, email, role FROM users WHERE id = $1',
        [decoded.userId]
      );
      if (result.rows.length === 0) return next(new Error('User not found'));

      socket.user = result.rows[0];
      next();
    } catch {
      next(new Error('Invalid or expired token'));
    }
  });

  // ── Gestion des connexions ──────────────────────────────────
  io.on('connection', (socket) => {
    const userId = socket.user.id;
    logger.info(`WS connecté : user ${userId} (socket ${socket.id})`);

    // Chaque utilisateur rejoint sa propre room privée
    socket.join(`user:${userId}`);

    // Les admins rejoignent aussi la room globale
    if (socket.user.role === 'admin') {
      socket.join('admin');
      logger.debug(`WS admin ${userId} rejoint la room "admin"`);
    }

    socket.on('disconnect', (reason) => {
      logger.info(`WS déconnecté : user ${userId} — ${reason}`);
    });

    // Ping de keepalive côté client
    socket.on('ping', () => socket.emit('pong'));
  });

  logger.info('Socket.io initialisé');
  return io;
}

/**
 * Émet une mise à jour d'état en temps réel à l'utilisateur concerné.
 * @param {string} userId
 * @param {Object} payload - { state, data, last_updated }
 */
function emitStateUpdate(userId, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit('state:update', payload);
  io.to('admin').emit('state:update', { userId, ...payload });
}

/**
 * Émet une nouvelle alerte en temps réel à l'utilisateur concerné.
 * @param {string} userId
 * @param {Object} alert - { type, severity, message, suggestion, triggered_at }
 */
function emitAlert(userId, alert) {
  if (!io) return;
  io.to(`user:${userId}`).emit('alert:new', alert);
  io.to('admin').emit('alert:new', { userId, ...alert });
}

/**
 * Retourne l'instance Socket.io (utile pour les tests ou extensions futures).
 */
function getIO() {
  return io;
}

module.exports = { init, emitStateUpdate, emitAlert, getIO };
