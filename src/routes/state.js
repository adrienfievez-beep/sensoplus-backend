const express = require('express');
const { query, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: State
 *   description: État de santé en temps réel et historique
 */

/**
 * @swagger
 * /api/v1/state/current:
 *   get:
 *     summary: Dernier état connu du bracelet
 *     tags: [State]
 *     responses:
 *       200:
 *         description: État actuel
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 state:
 *                   type: string
 *                   enum: [green, orange, red, unknown]
 *                 message:
 *                   type: string
 *                   example: Tout va bien
 *                 data:
 *                   $ref: '#/components/schemas/PhysiologicalData'
 *                 last_updated:
 *                   type: string
 *                   format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
/**
 * @swagger
 * /api/v1/state/history:
 *   get:
 *     summary: Historique des états agrégés par heure
 *     tags: [State]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Début (défaut — 7 jours)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *     responses:
 *       200:
 *         description: Historique horaire des états
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 history:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       hour:
 *                         type: string
 *                         format: date-time
 *                       dominant_state:
 *                         type: string
 *                       avg_hr:
 *                         type: number
 *                       avg_stress:
 *                         type: number
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// GET /api/v1/state/current
// Dernier état connu en temps réel
router.get('/current', authenticate, async (req, res) => {
  const result = await pool.query(
    `SELECT heart_rate, hrv, steps, activity, stress, battery, state, recorded_at
     FROM physiological_data
     WHERE user_id = $1
     ORDER BY recorded_at DESC
     LIMIT 1`,
    [req.user.id]
  );

  if (result.rows.length === 0) {
    return res.json({ state: 'unknown', message: 'No data received yet' });
  }

  const data = result.rows[0];
  const messages = {
    green: 'Tout va bien',
    orange: 'Attention requise',
    red: 'Alerte — réagissez maintenant',
  };

  res.json({
    state: data.state,
    message: messages[data.state] || 'État inconnu',
    data,
    last_updated: data.recorded_at,
  });
});

// GET /api/v1/state/history
// Historique des états (résumé par heure)
router.get('/history', authenticate, [
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const from = req.query.from || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const to = req.query.to || new Date().toISOString();

  // Agréger par heure
  const result = await pool.query(
    `SELECT
       date_trunc('hour', recorded_at) AS hour,
       MODE() WITHIN GROUP (ORDER BY state) AS dominant_state,
       COUNT(CASE WHEN state = 'green' THEN 1 END)  AS green_count,
       COUNT(CASE WHEN state = 'orange' THEN 1 END) AS orange_count,
       COUNT(CASE WHEN state = 'red' THEN 1 END)    AS red_count,
       ROUND(AVG(heart_rate)) AS avg_hr,
       ROUND(AVG(stress)::numeric, 2) AS avg_stress
     FROM physiological_data
     WHERE user_id = $1 AND recorded_at BETWEEN $2 AND $3
     GROUP BY hour
     ORDER BY hour ASC`,
    [req.user.id, from, to]
  );

  res.json({ history: result.rows, from, to });
});

module.exports = router;
