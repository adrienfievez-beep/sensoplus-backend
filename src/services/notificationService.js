const admin = require('firebase-admin');
const logger = require('../utils/logger');

let initialized = false;

function initFirebase() {
  if (initialized) return;

  const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL } = process.env;

  if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
    logger.warn('Firebase non configuré — les notifications push sont désactivées');
    return;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: FIREBASE_PROJECT_ID,
        privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: FIREBASE_CLIENT_EMAIL,
      }),
    });
    initialized = true;
    logger.info('Firebase Admin SDK initialisé');
  } catch (err) {
    logger.error('Erreur initialisation Firebase :', err.message);
  }
}

// Initialiser au chargement du module
initFirebase();

/**
 * Envoie une notification push via FCM.
 * @param {string} fcmToken - Token FCM de l'appareil cible
 * @param {Object} alert - { type, severity, message, suggestion }
 * @returns {boolean} true si envoyé avec succès
 */
async function sendPushNotification(fcmToken, alert) {
  if (!initialized) return false;
  if (!fcmToken) return false;

  const severityEmoji = alert.severity === 'red' ? '🔴' : '🟠';

  const message = {
    token: fcmToken,
    notification: {
      title: `${severityEmoji} Alerte SENSO+`,
      body: alert.message,
    },
    data: {
      type: alert.type,
      severity: alert.severity,
      suggestion: alert.suggestion || '',
    },
    android: {
      priority: alert.severity === 'red' ? 'high' : 'normal',
      notification: {
        channelId: alert.severity === 'red' ? 'senso_critical' : 'senso_alerts',
        sound: 'default',
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
          'interruption-level': alert.severity === 'red' ? 'critical' : 'active',
        },
      },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    logger.debug(`Notification push envoyée : ${response}`);
    return true;
  } catch (err) {
    // Token invalide ou expiré — ne pas logger comme erreur critique
    if (err.code === 'messaging/invalid-registration-token' ||
        err.code === 'messaging/registration-token-not-registered') {
      logger.warn(`FCM token invalide pour user — nettoyage requis`);
    } else {
      logger.error(`Erreur envoi push FCM : ${err.message}`);
    }
    return false;
  }
}

/**
 * Envoie plusieurs notifications en parallèle (batch).
 * @param {Array<{ fcmToken: string, alert: Object }>} items
 */
async function sendPushNotifications(items) {
  if (!initialized || items.length === 0) return;

  await Promise.allSettled(
    items.map(({ fcmToken, alert }) => sendPushNotification(fcmToken, alert))
  );
}

module.exports = { sendPushNotification, sendPushNotifications };
