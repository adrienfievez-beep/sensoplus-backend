const pool = require('../db/pool');

/**
 * Analyse une lecture du bracelet et retourne l'état + les alertes générées.
 * @param {Object} reading - Données du bracelet
 * @param {Object} thresholds - Seuils personnalisés de l'utilisateur
 * @returns {{ state: string, alerts: Array }}
 */
function analyzeReading(reading, thresholds) {
  const alerts = [];
  let state = 'green';

  const {
    heart_rate,
    hrv,
    accel_x,
    accel_y,
    accel_z,
    stress,
    battery,
  } = reading;

  const hrMax           = thresholds.hr_max           ?? 120;
  const hrMin           = thresholds.hr_min           ?? 45;
  const hrvMin          = thresholds.hrv_min          ?? 20.0;
  const fallSensitivity = thresholds.fall_sensitivity ?? 2.5;
  const stressThreshold = thresholds.stress_threshold ?? 0.75;

  // ── Fréquence cardiaque élevée ──────────────────────────────
  if (heart_rate > hrMax) {
    const severity = heart_rate > hrMax + 30 ? 'red' : 'orange';
    alerts.push({
      type: 'tachycardia',
      severity,
      message: `Rythme cardiaque élevé : ${heart_rate} bpm (seuil : ${hrMax})`,
      suggestion: 'Asseyez-vous, respirez lentement. Appelez les secours si ça persiste.',
    });
    if (severity === 'red') state = 'red';
    else if (state === 'green') state = 'orange';
  }

  // ── Fréquence cardiaque basse ───────────────────────────────
  if (heart_rate < hrMin) {
    const severity = heart_rate < hrMin - 15 ? 'red' : 'orange';
    alerts.push({
      type: 'bradycardia',
      severity,
      message: `Rythme cardiaque faible : ${heart_rate} bpm (seuil : ${hrMin})`,
      suggestion: 'Reposez-vous et consultez un médecin si cette valeur persiste.',
    });
    if (severity === 'red') state = 'red';
    else if (state === 'green') state = 'orange';
  }

  // ── HRV anormale ────────────────────────────────────────────
  if (hrv !== undefined && hrv !== null && hrv < hrvMin) {
    alerts.push({
      type: 'hrv_anomaly',
      severity: 'orange',
      message: `HRV basse : ${hrv.toFixed(1)} ms (seuil : ${hrvMin} ms)`,
      suggestion: 'Hydratez-vous et évitez le stress. Consultez si ça dure.',
    });
    if (state === 'green') state = 'orange';
  }

  // ── Chute détectée ──────────────────────────────────────────
  if (accel_x !== undefined && accel_y !== undefined && accel_z !== undefined) {
    const magnitude = Math.sqrt(accel_x ** 2 + accel_y ** 2 + accel_z ** 2);
    if (magnitude > fallSensitivity) {
      alerts.push({
        type: 'fall',
        severity: 'red',
        message: `Chute détectée (accélération : ${magnitude.toFixed(2)} g)`,
        suggestion: 'Vérifiez si la personne est consciente. Appelez le 15 si nécessaire.',
      });
      state = 'red';
    }
  }

  // ── Stress élevé ────────────────────────────────────────────
  if (stress !== undefined && stress !== null && stress >= stressThreshold) {
    alerts.push({
      type: 'stress',
      severity: 'orange',
      message: `Niveau de stress élevé : ${(stress * 100).toFixed(0)}%`,
      suggestion: 'Prenez une pause, respirez profondément.',
    });
    if (state === 'green') state = 'orange';
  }

  // ── Batterie faible ─────────────────────────────────────────
  if (battery !== undefined && battery !== null && battery <= 10) {
    alerts.push({
      type: 'low_battery',
      severity: 'orange',
      message: `Batterie du bracelet faible : ${battery}%`,
      suggestion: 'Rechargez le bracelet dès que possible.',
    });
    if (state === 'green') state = 'orange';
  }

  return { state, alerts };
}

/**
 * Vérifie si l'utilisateur est inactif depuis trop longtemps.
 * Regarde dans la fenêtre glissante si aucune donnée d'activité non-rest n'existe.
 * @param {string} userId
 * @param {number} inactivityMin - Durée d'inactivité max en minutes
 * @returns {Object|null} Alerte ou null
 */
async function checkInactivity(userId, inactivityMin) {
  const since = new Date(Date.now() - inactivityMin * 60 * 1000);

  const result = await pool.query(
    `SELECT COUNT(*) AS active_count
     FROM physiological_data
     WHERE user_id = $1
       AND recorded_at >= $2
       AND activity IN ('walking', 'active')`,
    [userId, since]
  );

  const activeCount = parseInt(result.rows[0].active_count, 10);

  if (activeCount === 0) {
    // Vérifier qu'on a bien des données récentes (le bracelet est connecté)
    const recent = await pool.query(
      `SELECT COUNT(*) AS cnt FROM physiological_data
       WHERE user_id = $1 AND recorded_at >= $2`,
      [userId, since]
    );
    const hasData = parseInt(recent.rows[0].cnt, 10) > 0;

    if (hasData) {
      return {
        type: 'inactivity',
        severity: 'orange',
        message: `Inactivité détectée depuis plus de ${inactivityMin} minutes`,
        suggestion: 'Levez-vous et marchez quelques minutes.',
      };
    }
  }

  return null;
}

module.exports = { analyzeReading, checkInactivity };
