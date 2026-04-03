const express = require('express');
const { query, param, validationResult } = require('express-validator');
const pool = require('../db/pool');
const { authenticate } = require('../middleware/auth');
const { acknowledgeAlert } = require('../services/alertService');

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Alerts
 *   description: Gestion des alertes de santé
 */

/**
 * @swagger
 * /api/v1/alerts:
 *   get:
 *     summary: Liste des alertes de l'utilisateur
 *     tags: [Alerts]
 *     parameters:
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Début de la plage (défaut — 7 jours)
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *       - in: query
 *         name: unread
 *         schema:
 *           type: boolean
 *         description: Si true, retourne uniquement les alertes non acquittées
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
 *         description: Liste des alertes
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 alerts:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Alert'
 *                 count:
 *                   type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
/**
 * @swagger
 * /api/v1/alerts/{id}/acknowledge:
 *   patch:
 *     summary: Acquitter une alerte
 *     tags: [Alerts]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Alerte acquittée
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
/**
 * @swagger
 * /api/v1/alerts/acknowledge-all:
 *   post:
 *     summary: Acquitter toutes les alertes non lues
 *     tags: [Alerts]
 *     responses:
 *       200:
 *         description: Nombre d'alertes acquittées
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 acknowledged:
 *                   type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
// GET /api/v1/alerts
// Liste des alertes de l'utilisateur (avec pagination)
router.get('/', authenticate, [
  query('from').optional().isISO8601(),
  query('to').optional().isISO8601(),
  query('unread').optional().isBoolean(),
  query('limit').optional().isInt({ min: 1, max: 200 }),
  query('offset').optional().isInt({ min: 0 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const userId = req.user.id;
  const from   = req.query.from  || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const to     = req.query.to    || new Date().toISOString();
  const limit  = parseInt(req.query.limit  || '50');
  const offset = parseInt(req.query.offset || '0');
  const unreadOnly = req.query.unread === 'true';

  let sql = `
    SELECT id, type, severity, message, suggestion, data_snapshot,
           acknowledged, acknowledged_at, triggered_at
    FROM alerts
    WHERE user_id = $1
      AND triggered_at BETWEEN $2 AND $3
  `;
  const params = [userId, from, to];

  if (unreadOnly) {
    sql += ` AND acknowledged = FALSE`;
  }

  sql += ` ORDER BY triggered_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  params.push(limit, offset);

  const result = await pool.query(sql, params);

  res.json({
    alerts: result.rows,
    count: result.rows.length,
    from,
    to,
  });
});

// PATCH /api/v1/alerts/:id/acknowledge
// Acquitter une alerte
router.patch('/:id/acknowledge', authenticate, [
  param('id').isInt({ min: 1 }),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const updated = await acknowledgeAlert(req.params.id, req.user.id);
  if (!updated) {
    return res.status(404).json({ error: 'Alert not found or already acknowledged' });
  }

  res.json({ message: 'Alert acknowledged' });
});

// POST /api/v1/alerts/acknowledge-all
// Acquitter toutes les alertes non lues
router.post('/acknowledge-all', authenticate, async (req, res) => {
  const result = await pool.query(
    `UPDATE alerts
     SET acknowledged = TRUE, acknowledged_at = NOW()
     WHERE user_id = $1 AND acknowledged = FALSE
     RETURNING id`,
    [req.user.id]
  );

  res.json({ acknowledged: result.rows.length });
});

module.exports = router;
