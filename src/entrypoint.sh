#!/bin/sh
set -e

echo "[SENSO+] Attente de PostgreSQL..."

# Attendre que PostgreSQL soit prêt (au cas où healthcheck insuffisant)
until node -e "
  const { Pool } = require('pg');
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  pool.query('SELECT 1').then(() => { pool.end(); process.exit(0); }).catch(() => process.exit(1));
" 2>/dev/null; do
  echo "[SENSO+] PostgreSQL pas encore prêt — attente 2s..."
  sleep 2
done

echo "[SENSO+] PostgreSQL connecté."

# Lancer la migration automatiquement
echo "[SENSO+] Migration de la base de données..."
node src/db/migrate.js

echo "[SENSO+] Démarrage de l'API..."
exec "$@"
