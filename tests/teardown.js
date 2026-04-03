require('dotenv').config({ path: '.env.test' });
const { Pool } = require('pg');

module.exports = async function globalTeardown() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'sensoplus_test',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  });

  try {
    await pool.query('TRUNCATE alerts, physiological_data, user_thresholds, users CASCADE');
    console.log('[Test Teardown] Nettoyage terminé');
  } finally {
    await pool.end();
  }
};
