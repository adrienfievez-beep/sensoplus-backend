const pool = require('../db/pool');
const logger = require('../utils/logger');
const { sendPushNotification } = require('./notificationService');
const { emitAlert } = require('./socketService');

/**
 * Sauvegarde les alertes en base de données.
 * Évite les doublons sur la même fenêtre de 5 minutes pour le même type.
 * @param {string} userId
 * @param {Array} alerts - Tableau d'alertes issues de analyzeReading
 * @param {Object} dataSnapshot - Snapshot des données au moment de l'alerte
 */
async function saveAlerts(userId, alerts, dataSnapshot) {
  const dedupeWindow = new Date(Date.now() - 5 * 60 * 1000);

  // Récupérer le token FCM et les préférences de l'utilisateur
  const userResult = await pool.query(
    'SELECT fcm_token FROM users WHERE id = $1',
    [userId]
  );
  const fcmToken = userResult.rows[0]?.fcm_token || null;

  const prefsResult = await pool.query(
    'SELECT alert_push FROM user_thresholds WHERE user_id = $1',
    [userId]
  );
  const pushEnabled = prefsResult.rows[0]?.alert_push ?? true;

  for (const alert of alerts) {
    // Anti-doublon : ne pas re-déclencher la même alerte dans les 5 dernières minutes
    const existing = await pool.query(
      `SELECT id FROM alerts
       WHERE user_id = $1
         AND type = $2
         AND triggered_at >= $3`,
      [userId, alert.type, dedupeWindow]
    );

    if (existing.rows.length > 0) {
      logger.debug(`Alerte dupliquée ignorée : ${alert.type} pour user ${userId}`);
      continue;
    }

    await pool.query(
      `INSERT INTO alerts (user_id, type, severity, message, suggestion, data_snapshot)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        alert.type,
        alert.severity,
        alert.message,
        alert.suggestion || null,
        JSON.stringify(dataSnapshot),
      ]
    );

    logger.info(`Alerte créée : [${alert.severity.toUpperCase()}] ${alert.type} — user ${userId}`);

    // Émettre l'alerte en temps réel via WebSocket
    emitAlert(userId, {
      type: alert.type,
      severity: alert.severity,
      message: alert.message,
      suggestion: alert.suggestion || null,
      triggered_at: new Date().toISOString(),
    });

    // Envoyer la notification push si activée
    if (pushEnabled && fcmToken) {
      await sendPushNotification(fcmToken, alert);
    }
  }
}

/**
 * Marque une alerte comme acquittée.
 * @param {string} alertId
 * @param {string} userId - Pour vérifier la propriété
 * @returns {boolean} true si trouvée et mise à jour
 */
async function acknowledgeAlert(alertId, userId) {
  const result = await pool.query(
    `UPDATE alerts
     SET acknowledged = TRUE, acknowledged_at = NOW()
     WHERE id = $1 AND user_id = $2 AND acknowledged = FALSE
     RETURNING id`,
    [alertId, userId]
  );
  return result.rows.length > 0;
}

module.exports = { saveAlerts, acknowledgeAlert };
