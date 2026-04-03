const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Thresholds
 *   description: Seuils d'alerte personnalisés par utilisateur
 */

/**
 * @swagger
 * /api/v1/thresholds:
 *   get:
 *     summary: Seuils actuels de l'utilisateur
 *     tags: [Thresholds]
 *     responses:
 *       200:
 *         description: Seuils personnalisés
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Thresholds'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *   patch:
 *     summary: Mettre à jour les seuils
 *     tags: [Thresholds]
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/Thresholds'
 *     responses:
 *       200:
 *         description: Seuils mis à jour
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Thresholds'
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
/**
 * @swagger
 * /api/v1/thresholds/reset:
 *   post:
 *     summary: Remettre les seuils aux valeurs par défaut
 *     tags: [Thresholds]
 *     responses:
 *       200:
 *         description: Seuils réinitialisés
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Thresholds'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// GET /api/v1/thresholds
// Seuils actuels de l'utilisateur
router.get('/', authenticate, async (req, res) => {
  const result = await pool.query(
    'SELECT * FROM user_thresholds WHERE user_id = $1',
    [req.user.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({ error: 'Thresholds not found' });
  }

  res.json(result.rows[0]);
});

// PATCH /api/v1/thresholds
// Mettre à jour les seuils de l'utilisateur
router.patch('/', authenticate, [
  body('hr_max').optional().isInt({ min: 60, max: 220 }),
  body('hr_min').optional().isInt({ min: 20, max: 80 }),
  body('hrv_min').optional().isFloat({ min: 0, max: 200 }),
  body('inactivity_min').optional().isInt({ min: 10, max: 480 }),
  body('fall_sensitivity').optional().isFloat({ min: 0.5, max: 10 }),
  body('stress_threshold').optional().isFloat({ min: 0, max: 1 }),
  body('alert_vibration').optional().isBoolean(),
  body('alert_push').optional().isBoolean(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const fields = [
    'hr_max', 'hr_min', 'hrv_min', 'inactivity_min',
    'fall_sensitivity', 'stress_threshold', 'alert_vibration', 'alert_push',
  ];

  const updates = [];
  const values = [];
  let idx = 1;

  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = $${idx}`);
      values.push(req.body[field]);
      idx++;
    }
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  values.push(req.user.id);
  const result = await pool.query(
    `UPDATE user_thresholds SET ${updates.join(', ')}, updated_at = NOW()
     WHERE user_id = $${idx}
     RETURNING *`,
    values
  );

  res.json(result.rows[0]);
});

// POST /api/v1/thresholds/reset
// Réinitialiser les seuils aux valeurs par défaut
router.post('/reset', authenticate, async (req, res) => {
  const result = await pool.query(
    `UPDATE user_thresholds
     SET hr_max = 120, hr_min = 45, hrv_min = 20.0, inactivity_min = 60,
         fall_sensitivity = 2.5, stress_threshold = 0.75,
         alert_vibration = TRUE, alert_push = TRUE, updated_at = NOW()
     WHERE user_id = $1
     RETURNING *`,
    [req.user.id]
  );

  res.json(result.rows[0]);
});

module.exports = router;
