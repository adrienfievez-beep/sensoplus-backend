const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const {
  generateAccessToken,
  generateRefreshToken,
  consumeRefreshToken,
  revokeAllUserTokens,
} = require('../services/tokenService');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Inscription, connexion et gestion du profil utilisateur
 */

function getMeta(req) {
  return {
    userAgent: req.headers['user-agent'] || null,
    ipAddress: req.ip || null,
  };
}

/**
 * @swagger
 * /api/v1/auth/register:
 *   post:
 *     summary: Créer un compte utilisateur
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: marie@example.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 example: MonMotDePasse1!
 *               first_name:
 *                 type: string
 *                 example: Marie
 *               last_name:
 *                 type: string
 *                 example: Dupont
 *               age:
 *                 type: integer
 *                 example: 72
 *               weight:
 *                 type: number
 *                 example: 65.5
 *               height:
 *                 type: number
 *                 example: 165.0
 *     responses:
 *       201:
 *         description: Compte créé avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       409:
 *         description: Email déjà utilisé
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
// POST /api/v1/auth/register
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('first_name').optional().trim().isLength({ max: 100 }),
  body('last_name').optional().trim().isLength({ max: 100 }),
  body('age').optional().isInt({ min: 1, max: 130 }),
  body('weight').optional().isFloat({ min: 1 }),
  body('height').optional().isFloat({ min: 1 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password, first_name, last_name, age, weight, height } = req.body;

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    return res.status(409).json({ error: 'Email already in use' });
  }

  const hashed = await bcrypt.hash(password, 12);
  const result = await pool.query(
    `INSERT INTO users (email, password, first_name, last_name, age, weight, height)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, email, first_name, last_name, role, created_at`,
    [email, hashed, first_name, last_name, age, weight, height]
  );

  const user = result.rows[0];

  // Créer les seuils par défaut pour cet utilisateur
  await pool.query(
    'INSERT INTO user_thresholds (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
    [user.id]
  );

  const accessToken  = generateAccessToken(user.id);
  const refreshToken = await generateRefreshToken(user.id, null, getMeta(req));
  res.status(201).json({ access_token: accessToken, refresh_token: refreshToken, user });
});

/**
 * @swagger
 * /api/v1/auth/login:
 *   post:
 *     summary: Se connecter
 *     tags: [Auth]
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: marie@example.com
 *               password:
 *                 type: string
 *                 example: MonMotDePasse1!
 *     responses:
 *       200:
 *         description: Connexion réussie
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// POST /api/v1/auth/login
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { email, password } = req.body;
  const result = await pool.query(
    'SELECT id, email, password, first_name, last_name, role FROM users WHERE email = $1',
    [email]
  );

  if (result.rows.length === 0) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const user = result.rows[0];
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const accessToken  = generateAccessToken(user.id);
  const refreshToken = await generateRefreshToken(user.id, null, getMeta(req));
  const { password: _, ...safeUser } = user;
  res.json({ access_token: accessToken, refresh_token: refreshToken, user: safeUser });
});

/**
 * @swagger
 * /api/v1/auth/me:
 *   get:
 *     summary: Profil de l'utilisateur connecté (avec seuils)
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Profil complet
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/User'
 *                 - $ref: '#/components/schemas/Thresholds'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// GET /api/v1/auth/me
router.get('/me', authenticate, async (req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.age, u.weight, u.height,
            u.device_id, u.role, u.created_at,
            t.hr_max, t.hr_min, t.hrv_min, t.inactivity_min,
            t.fall_sensitivity, t.stress_threshold, t.alert_vibration, t.alert_push
     FROM users u
     LEFT JOIN user_thresholds t ON t.user_id = u.id
     WHERE u.id = $1`,
    [req.user.id]
  );
  res.json(result.rows[0]);
});

/**
 * @swagger
 * /api/v1/auth/device:
 *   patch:
 *     summary: Associer un bracelet ESP32 au compte
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [device_id]
 *             properties:
 *               device_id:
 *                 type: string
 *                 example: AA:BB:CC:DD:EE:FF
 *                 description: Adresse MAC du bracelet ESP32
 *               fcm_token:
 *                 type: string
 *                 description: Token Firebase pour les notifications push
 *     responses:
 *       200:
 *         description: Bracelet associé avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// PATCH /api/v1/auth/device
router.patch('/device', authenticate, [
  body('device_id').notEmpty().trim(),
  body('fcm_token').optional().trim(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { device_id, fcm_token } = req.body;
  await pool.query(
    'UPDATE users SET device_id = $1, fcm_token = $2 WHERE id = $3',
    [device_id, fcm_token || null, req.user.id]
  );
  res.json({ message: 'Device registered successfully' });
});

/**
 * @swagger
 * /api/v1/auth/refresh:
 *   post:
 *     summary: Renouveler l'access token via le refresh token
 *     tags: [Auth]
 *     security: []
 *     description: |
 *       Rotation automatique — chaque appel consomme le refresh token et en émet un nouveau.
 *       Si un refresh token révoqué est réutilisé, toute la famille est invalidée (détection de vol).
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refresh_token]
 *             properties:
 *               refresh_token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Nouveaux tokens émis
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 access_token:
 *                   type: string
 *                 refresh_token:
 *                   type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// POST /api/v1/auth/refresh
router.post('/refresh', [
  body('refresh_token').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const { userId, family } = await consumeRefreshToken(req.body.refresh_token);

    const accessToken  = generateAccessToken(userId);
    const refreshToken = await generateRefreshToken(userId, family, getMeta(req));

    res.json({ access_token: accessToken, refresh_token: refreshToken });
  } catch (err) {
    res.status(err.status || 401).json({ error: err.message });
  }
});

/**
 * @swagger
 * /api/v1/auth/logout:
 *   post:
 *     summary: Se déconnecter (révoque tous les refresh tokens)
 *     tags: [Auth]
 *     responses:
 *       200:
 *         description: Déconnexion réussie
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// POST /api/v1/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  await revokeAllUserTokens(req.user.id);
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
