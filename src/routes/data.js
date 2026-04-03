const express = require('express');
const { body, query, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { analyzeReading, checkInactivity } = require('../services/analyzer');
const { saveAlerts } = require('../services/alertService');
const { emitStateUpdate } = require('../services/socketService');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Data
 *   description: Réception et consultation des données physiologiques du bracelet
 */

/**
 * @swagger
 * /api/v1/data:
 *   post:
 *     summary: Envoyer une lecture du bracelet
 *     tags: [Data]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [heart_rate]
 *             properties:
 *               heart_rate:
 *                 type: integer
 *                 minimum: 20
 *                 maximum: 300
 *                 example: 72
 *               hrv:
 *                 type: number
 *                 example: 45.5
 *               accel_x:
 *                 type: number
 *                 example: 0.02
 *               accel_y:
 *                 type: number
 *                 example: -0.01
 *               accel_z:
 *                 type: number
 *                 example: 9.8
 *               steps:
 *                 type: integer
 *                 example: 250
 *               activity:
 *                 type: string
 *                 enum: [rest, walking, active, sleep]
 *               stress:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 1
 *                 example: 0.3
 *               battery:
 *                 type: integer
 *                 minimum: 0
 *                 maximum: 100
 *                 example: 85
 *               recorded_at:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Donnée enregistrée — état et alertes calculés
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 state:
 *                   type: string
 *                   enum: [green, orange, red]
 *                 alerts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Alert'
 *                 recorded_at:
 *                   type: string
 *                   format: date-time
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// POST /api/v1/data
// Reçoit les données du bracelet (via l'app mobile)
router.post('/', authenticate, [
  body('heart_rate').isInt({ min: 20, max: 300 }),
  body('hrv').optional().isFloat({ min: 0 }),
  body('accel_x').optional().isFloat(),
  body('accel_y').optional().isFloat(),
  body('accel_z').optional().isFloat(),
  body('steps').optional().isInt({ min: 0 }),
  body('activity').optional().isIn(['rest', 'walking', 'active', 'sleep']),
  body('stress').optional().isFloat({ min: 0, max: 1 }),
  body('battery').optional().isInt({ min: 0, max: 100 }),
  body('recorded_at').optional().isISO8601(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const userId = req.user.id;
  const {
    heart_rate, hrv, accel_x, accel_y, accel_z,
    steps, activity, stress, battery, recorded_at,
  } = req.body;

  // Récupérer les seuils de l'utilisateur
  const thresholdResult = await pool.query(
    'SELECT * FROM user_thresholds WHERE user_id = $1',
    [userId]
  );
  const thresholds = thresholdResult.rows[0] || {};

  // Analyser les données
  const reading = { heart_rate, hrv, accel_x, accel_y, accel_z, steps, activity, stress, battery };
  const { state, alerts } = analyzeReading(reading, thresholds);

  // Vérifier l'inactivité (fenêtre glissante 60 min)
  const inactivityAlert = await checkInactivity(userId, thresholds.inactivity_min || 60);
  if (inactivityAlert) alerts.push(inactivityAlert);

  // Sauvegarder les données
  const insertResult = await pool.query(
    `INSERT INTO physiological_data
      (user_id, heart_rate, hrv, accel_x, accel_y, accel_z, steps, activity, stress, battery, state, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     RETURNING id, state, recorded_at`,
    [userId, heart_rate, hrv, accel_x, accel_y, accel_z, steps, activity, stress, battery, state,
     recorded_at || new Date()]
  );

  // Sauvegarder les alertes générées
  if (alerts.length > 0) {
    await saveAlerts(userId, alerts, reading);
  }

  const responseData = {
    id: insertResult.rows[0].id,
    state,
    alerts,
    recorded_at: insertResult.rows[0].recorded_at,
  };

  // Émettre l'état en temps réel via WebSocket
  emitStateUpdate(userId, {
    state,
    data: { heart_rate, hrv, steps, activity, stress, battery },
    last_updated: responseData.recorded_at,
  });

  res.status(201).json(responseData);
});

/**
 * @swagger
 * /api/v1/data/batch:
 *   post:
 *     summary: Envoyer un lot de lectures (mode hors-ligne)
 *     tags: [Data]
 *     description: Utilisé quand le bracelet était hors ligne — envoie jusqu'à 500 lectures d'un coup.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [readings]
 *             properties:
 *               readings:
 *                 type: array
 *                 maxItems: 500
 *                 items:
 *                   type: object
 *                   required: [heart_rate, recorded_at]
 *                   properties:
 *                     heart_rate:
 *                       type: integer
 *                     recorded_at:
 *                       type: string
 *                       format: date-time
 *     responses:
 *       201:
 *         description: Lot inséré
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 inserted:
 *                   type: integer
 *                 ids:
 *                   type: array
 *                   items:
 *                     type: integer
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// POST /api/v1/data/batch
// Envoi groupé (si le bracelet était hors ligne)
router.post('/batch', authenticate, [
  body('readings').isArray({ min: 1, max: 500 }),
  body('readings.*.heart_rate').isInt({ min: 20, max: 300 }),
  body('readings.*.recorded_at').isISO8601(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const userId = req.user.id;
  const { readings } = req.body;

  const thresholdResult = await pool.query(
    'SELECT * FROM user_thresholds WHERE user_id = $1',
    [userId]
  );
  const thresholds = thresholdResult.rows[0] || {};

  const inserted = [];
  for (const reading of readings) {
    const { state, alerts } = analyzeReading(reading, thresholds);
    const r = await pool.query(
      `INSERT INTO physiological_data
        (user_id, heart_rate, hrv, accel_x, accel_y, accel_z, steps, activity, stress, battery, state, recorded_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [userId, reading.heart_rate, reading.hrv, reading.accel_x, reading.accel_y, reading.accel_z,
       reading.steps, reading.activity, reading.stress, reading.battery, state, reading.recorded_at]
    );
    if (alerts.length > 0) await saveAlerts(userId, alerts, reading);
    inserted.push(r.rows[0].id);
  }

  res.status(201).json({ inserted: inserted.length, ids: inserted });
});

/**
 * @swagger
 * /api/v1/data:
 *   get:
 *     summary: Historique des données physiologiques
 *     tags: [Data]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Début de la plage (défaut — 24h)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Fin de la plage (défaut — maintenant)
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 200
 *           maximum: 1000
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Liste des données
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/PhysiologicalData'
 *                 count:
 *                   type: integer
 *                 from:
 *                   type: string
 *                 to:
 *                   type: string
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
/**
 * @swagger
 * /api/v1/data/summary:
 *   get:
 *     summary: Résumé de la journée (stats + alertes)
 *     tags: [Data]
 *     responses:
 *       200:
 *         description: Statistiques agrégées du jour
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 avg_hr:
 *                   type: number
 *                 min_hr:
 *                   type: number
 *                 max_hr:
 *                   type: number
 *                 avg_hrv:
 *                   type: number
 *                 total_steps:
 *                   type: integer
 *                 avg_stress:
 *                   type: number
 *                 data_points:
 *                   type: integer
 *                 green_count:
 *                   type: integer
 *                 orange_count:
 *                   type: integer
 *                 red_count:
 *                   type: integer
 *                 alerts:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     unread:
 *                       type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// GET /api/v1/data
// Historique des données (avec pagination)
router.get('/', authenticate, [
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
  query('limit').optional().isInt({ min: 1, max: 1000 }),
  query('offset').optional().isInt({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const userId = req.user.id;
  const from = req.query.from || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const to = req.query.to || new Date().toISOString();
  const limit = parseInt(req.query.limit || '200');
  const offset = parseInt(req.query.offset || '0');

  const result = await pool.query(
    `SELECT id, heart_rate, hrv, steps, activity, stress, battery, state, recorded_at
     FROM physiological_data
     WHERE user_id = $1 AND recorded_at BETWEEN $2 AND $3
     ORDER BY recorded_at DESC
     LIMIT $4 OFFSET $5`,
    [userId, from, to, limit, offset]
  );

  res.json({
    data: result.rows,
    count: result.rows.length,
    from,
    to,
  });
});

// GET /api/v1/data/summary
// Résumé de la journée
router.get('/summary', authenticate, async (req, res) => {
  const userId = req.user.id;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const result = await pool.query(
    `SELECT
       ROUND(AVG(heart_rate)) AS avg_hr,
       MIN(heart_rate)        AS min_hr,
       MAX(heart_rate)        AS max_hr,
       ROUND(AVG(hrv)::numeric, 1) AS avg_hrv,
       MAX(steps)             AS total_steps,
       ROUND(AVG(stress)::numeric, 2) AS avg_stress,
       COUNT(*)               AS data_points,
       COUNT(CASE WHEN state = 'green' THEN 1 END)  AS green_count,
       COUNT(CASE WHEN state = 'orange' THEN 1 END) AS orange_count,
       COUNT(CASE WHEN state = 'red' THEN 1 END)    AS red_count
     FROM physiological_data
     WHERE user_id = $1 AND recorded_at >= $2`,
    [userId, today]
  );

  const alertCount = await pool.query(
    `SELECT COUNT(*) AS total,
            COUNT(CASE WHEN acknowledged = FALSE THEN 1 END) AS unread
     FROM alerts
     WHERE user_id = $1 AND triggered_at >= $2`,
    [userId, today]
  );

  res.json({
    date: today.toISOString(),
    ...result.rows[0],
    alerts: alertCount.rows[0],
  });
});

module.exports = router;
