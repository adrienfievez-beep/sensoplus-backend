const express = require('express');
const { query, param, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Administration — accès réservé aux administrateurs
 */

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     summary: Liste tous les utilisateurs
 *     tags: [Admin]
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Recherche par email ou nom
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Liste des utilisateurs
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/User'
 *                 count:
 *                   type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
/**
 * @swagger
 * /api/admin/users/{id}:
 *   get:
 *     summary: Détail d'un utilisateur
 *     tags: [Admin]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Profil complet avec seuils
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/User'
 *                 - $ref: '#/components/schemas/Thresholds'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */
/**
 * @swagger
 * /api/admin/stats:
 *   get:
 *     summary: Statistiques globales de la plateforme
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Métriques globales
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 users:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     with_device:
 *                       type: integer
 *                     new_today:
 *                       type: integer
 *                 data:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     last_hour:
 *                       type: integer
 *                     red_today:
 *                       type: integer
 *                 alerts:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     unread:
 *                       type: integer
 *                     critical:
 *                       type: integer
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 */

// Toutes les routes admin nécessitent auth + rôle admin
router.use(authenticate, requireAdmin);

// GET /api/admin/users
// Liste tous les utilisateurs
router.get('/users', [
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('offset').optional().isInt({ min: 0 }),
  query('search').optional().trim().isLength({ max: 100 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const limit  = parseInt(req.query.limit  || '50');
  const offset = parseInt(req.query.offset || '0');
  const search = req.query.search || '';

  let sql = `
    SELECT u.id, u.email, u.first_name, u.last_name, u.role,
           u.device_id, u.created_at,
           COUNT(pd.id) AS data_points,
           MAX(pd.recorded_at) AS last_seen
    FROM users u
    LEFT JOIN physiological_data pd ON pd.user_id = u.id
  `;
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    sql += ` WHERE u.email ILIKE $1 OR u.first_name ILIKE $1 OR u.last_name ILIKE $1`;
  }

  sql += ` GROUP BY u.id ORDER BY u.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await pool.query(sql, params);
  res.json({ users: result.rows, count: result.rows.length });
});

// GET /api/admin/users/:id
// Détail d'un utilisateur
router.get('/users/:id', [
  param('id').isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const result = await pool.query(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.age, u.weight, u.height,
            u.device_id, u.role, u.created_at,
            t.hr_max, t.hr_min, t.hrv_min, t.inactivity_min,
            t.fall_sensitivity, t.stress_threshold, t.alert_vibration, t.alert_push
     FROM users u
     LEFT JOIN user_thresholds t ON t.user_id = u.id
     WHERE u.id = $1`,
    [req.params.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(result.rows[0]);
});

// PATCH /api/admin/users/:id/role
// Changer le rôle d'un utilisateur
router.patch('/users/:id/role', [
  param('id').isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { role } = req.body;
  if (!['user', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Role must be "user" or "admin"' });
  }

  // Empêcher un admin de se rétrograder lui-même
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot change your own role' });
  }

  const result = await pool.query(
    'UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, email, role',
    [role, req.params.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json(result.rows[0]);
});

// DELETE /api/admin/users/:id
// Supprimer un utilisateur
router.delete('/users/:id', [
  param('id').isUUID(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  const result = await pool.query(
    'DELETE FROM users WHERE id = $1 RETURNING id',
    [req.params.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
  }

  res.json({ message: 'User deleted successfully' });
});

// GET /api/admin/stats
// Statistiques globales de la plateforme
router.get('/stats', async (req, res) => {
  const [users, data, alerts] = await Promise.all([
    pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN role = 'admin' THEN 1 END) AS admins,
        COUNT(CASE WHEN device_id IS NOT NULL THEN 1 END) AS with_device,
        COUNT(CASE WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 1 END) AS new_today
      FROM users
    `),
    pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN recorded_at >= NOW() - INTERVAL '1 hour' THEN 1 END) AS last_hour,
        COUNT(CASE WHEN state = 'red' AND recorded_at >= NOW() - INTERVAL '24 hours' THEN 1 END) AS red_today,
        COUNT(CASE WHEN state = 'orange' AND recorded_at >= NOW() - INTERVAL '24 hours' THEN 1 END) AS orange_today
      FROM physiological_data
    `),
    pool.query(`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN acknowledged = FALSE THEN 1 END) AS unread,
        COUNT(CASE WHEN severity = 'red' THEN 1 END) AS critical,
        COUNT(CASE WHEN triggered_at >= NOW() - INTERVAL '24 hours' THEN 1 END) AS today
      FROM alerts
    `),
  ]);

  res.json({
    users: users.rows[0],
    data: data.rows[0],
    alerts: alerts.rows[0],
    generated_at: new Date().toISOString(),
  });
});

module.exports = router;
