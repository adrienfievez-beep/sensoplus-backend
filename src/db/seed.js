require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function seed() {
  const client = await pool.connect();
  try {
    console.log('Seeding SENSO+ database...');

    // ── Utilisateurs de test ──────────────────────────────────
    const adminPassword = await bcrypt.hash('Admin1234!', 12);
    const userPassword  = await bcrypt.hash('User1234!', 12);

    const adminResult = await client.query(
      `INSERT INTO users (email, password, first_name, last_name, age, weight, height, role)
       VALUES ($1, $2, 'Admin', 'SENSO', NULL, NULL, NULL, 'admin')
       ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password
       RETURNING id, email`,
      ['admin@sensoplus.com', adminPassword]
    );

    const userResult = await client.query(
      `INSERT INTO users (email, password, first_name, last_name, age, weight, height, role)
       VALUES ($1, $2, 'Marie', 'Dupont', 72, 65.0, 165.0, 'user')
       ON CONFLICT (email) DO UPDATE SET password = EXCLUDED.password
       RETURNING id, email`,
      ['marie.dupont@example.com', userPassword]
    );

    const adminId = adminResult.rows[0].id;
    const userId  = userResult.rows[0].id;

    console.log(`  ✓ Admin  : ${adminResult.rows[0].email} (password: Admin1234!)`);
    console.log(`  ✓ User   : ${userResult.rows[0].email} (password: User1234!)`);

    // ── Seuils par défaut ─────────────────────────────────────
    for (const id of [adminId, userId]) {
      await client.query(
        'INSERT INTO user_thresholds (user_id) VALUES ($1) ON CONFLICT DO NOTHING',
        [id]
      );
    }

    // Seuils personnalisés pour l'utilisateur test (personne âgée)
    await client.query(
      `UPDATE user_thresholds
       SET hr_max = 110, hr_min = 50, inactivity_min = 45, stress_threshold = 0.65
       WHERE user_id = $1`,
      [userId]
    );
    console.log('  ✓ Seuils personnalisés appliqués');

    // ── Données physiologiques de démonstration ───────────────
    const now = new Date();
    const readings = [];

    for (let i = 47; i >= 0; i--) {
      const recordedAt = new Date(now.getTime() - i * 30 * 60 * 1000); // toutes les 30 min
      const hr = 60 + Math.floor(Math.random() * 30);
      const hrv = 25 + Math.random() * 30;
      const stress = Math.random() * 0.6;
      const steps = i < 16 ? Math.floor(Math.random() * 300) : 0; // activité sur 8h
      const activity = steps > 100 ? 'walking' : 'rest';
      const state = hr > 100 ? 'orange' : 'green';

      readings.push([
        userId, hr, hrv,
        (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.2,
        9.8 + (Math.random() - 0.5) * 0.1,
        steps, activity, stress, 85, state, recordedAt,
      ]);
    }

    for (const r of readings) {
      await client.query(
        `INSERT INTO physiological_data
          (user_id, heart_rate, hrv, accel_x, accel_y, accel_z, steps, activity, stress, battery, state, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        r
      );
    }
    console.log(`  ✓ ${readings.length} points de données insérés`);

    // ── Alerte de démonstration ───────────────────────────────
    await client.query(
      `INSERT INTO alerts (user_id, type, severity, message, suggestion)
       VALUES ($1, 'tachycardia', 'orange', 'Rythme cardiaque élevé : 108 bpm', 'Asseyez-vous et respirez lentement.')
       ON CONFLICT DO NOTHING`,
      [userId]
    );
    console.log('  ✓ Alerte de démo insérée');

    console.log('\nSeed terminé avec succès.');
  } catch (err) {
    console.error('Seed échoué :', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
