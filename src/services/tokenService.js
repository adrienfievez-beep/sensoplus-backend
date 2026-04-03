const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const logger = require('../utils/logger');

const ACCESS_TOKEN_TTL  = process.env.JWT_EXPIRES_IN  || '15m';
const REFRESH_TOKEN_TTL = process.env.REFRESH_TOKEN_TTL || '30d';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Génère un access token JWT court (15 min).
 */
function generateAccessToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: ACCESS_TOKEN_TTL });
}

/**
 * Génère un refresh token opaque (256 bits) et le stocke hashé en base.
 * @param {string} userId
 * @param {string|null} family - UUID de la famille (null = nouvelle famille)
 * @param {Object} meta - { userAgent, ipAddress }
 * @returns {string} token brut (à envoyer au client une seule fois)
 */
async function generateRefreshToken(userId, family = null, meta = {}) {
  const rawToken   = crypto.randomBytes(32).toString('hex');
  const tokenHash  = crypto.createHash('sha256').update(rawToken).digest('hex');
  const tokenFamily = family || uuidv4();
  const expiresAt  = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, family, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, tokenHash, tokenFamily, expiresAt, meta.userAgent || null, meta.ipAddress || null]
  );

  return rawToken;
}

/**
 * Vérifie et consomme un refresh token.
 * Implémente la rotation — chaque refresh token ne peut être utilisé qu'une fois.
 * Si un token révoqué est réutilisé, toute la famille est révoquée (détection de vol).
 *
 * @param {string} rawToken
 * @returns {{ userId: string, family: string }} si valide
 * @throws {Error} si invalide, expiré ou révoqué
 */
async function consumeRefreshToken(rawToken) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const result = await pool.query(
    `SELECT * FROM refresh_tokens WHERE token_hash = $1`,
    [tokenHash]
  );

  if (result.rows.length === 0) {
    throw Object.assign(new Error('Refresh token invalide'), { status: 401 });
  }

  const stored = result.rows[0];

  // Token déjà révoqué — possible vol de token, révoquer toute la famille
  if (stored.revoked) {
    logger.warn(`Réutilisation d'un refresh token révoqué détectée — famille ${stored.family} révoquée`);
    await revokeFamily(stored.family);
    throw Object.assign(new Error('Token compromis — reconnectez-vous'), { status: 401 });
  }

  // Token expiré
  if (new Date(stored.expires_at) < new Date()) {
    await pool.query('UPDATE refresh_tokens SET revoked = TRUE, revoked_at = NOW() WHERE id = $1', [stored.id]);
    throw Object.assign(new Error('Refresh token expiré'), { status: 401 });
  }

  // Révoquer le token utilisé (rotation)
  await pool.query(
    'UPDATE refresh_tokens SET revoked = TRUE, revoked_at = NOW() WHERE id = $1',
    [stored.id]
  );

  return { userId: stored.user_id, family: stored.family };
}

/**
 * Révoque tous les tokens d'une famille (déconnexion sur tous les appareils ou compromission).
 */
async function revokeFamily(family) {
  await pool.query(
    'UPDATE refresh_tokens SET revoked = TRUE, revoked_at = NOW() WHERE family = $1 AND revoked = FALSE',
    [family]
  );
}

/**
 * Révoque tous les refresh tokens d'un utilisateur (logout global).
 */
async function revokeAllUserTokens(userId) {
  await pool.query(
    'UPDATE refresh_tokens SET revoked = TRUE, revoked_at = NOW() WHERE user_id = $1 AND revoked = FALSE',
    [userId]
  );
}

/**
 * Supprime les tokens expirés (à appeler périodiquement).
 */
async function purgeExpiredTokens() {
  const result = await pool.query(
    'DELETE FROM refresh_tokens WHERE expires_at < NOW() OR (revoked = TRUE AND revoked_at < NOW() - INTERVAL \'7 days\')'
  );
  logger.info(`Purge refresh tokens : ${result.rowCount} supprimés`);
  return result.rowCount;
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  consumeRefreshToken,
  revokeAllUserTokens,
  purgeExpiredTokens,
};
