/**
 * Setup global pour les tests Jest.
 * Crée les tables nécessaires dans la DB de test et nettoie les données.
 */
require('dotenv').config({ path: '.env.test' });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

module.exports = async function globalSetup() {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'sensoplus_test',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
  });

  const schema = fs.readFileSync(
    path.join(__dirname, '../src/db/schema.sql'),
    'utf8'
  );

  try {
    await pool.query(schema);
    // Nettoyer les données de test existantes
    await pool.query('TRUNCATE alerts, physiological_data, user_thresholds, users CASCADE');
    console.log('[Test Setup] Base de données de test prête');
  } finally {
    await pool.end();
  }
};
