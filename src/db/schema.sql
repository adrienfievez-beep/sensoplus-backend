-- ============================================================
-- SENSO+ — PostgreSQL Schema
-- ============================================================

-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password      TEXT NOT NULL,
  first_name    TEXT,
  last_name     TEXT,
  age           INT CHECK (age > 0 AND age < 130),
  weight        FLOAT CHECK (weight > 0),
  height        FLOAT CHECK (height > 0),
  device_id     TEXT,               -- MAC address ESP32
  fcm_token     TEXT,               -- Firebase push notifications
  role          TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- USER THRESHOLDS (seuils personnalisés par utilisateur)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_thresholds (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hr_max               INT DEFAULT 120,        -- bpm max avant alerte rouge
  hr_min               INT DEFAULT 45,         -- bpm min avant alerte orange
  hrv_min              FLOAT DEFAULT 20.0,     -- ms HRV minimum
  inactivity_min       INT DEFAULT 60,         -- minutes inactivité avant alerte
  fall_sensitivity     FLOAT DEFAULT 2.5,      -- g (accélération chute)
  stress_threshold     FLOAT DEFAULT 0.75,     -- 0.0 à 1.0
  alert_vibration      BOOLEAN DEFAULT TRUE,
  alert_push           BOOLEAN DEFAULT TRUE,
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PHYSIOLOGICAL DATA (données haute fréquence du bracelet)
-- ============================================================
CREATE TABLE IF NOT EXISTS physiological_data (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  heart_rate    INT CHECK (heart_rate > 0 AND heart_rate < 300),  -- bpm
  hrv           FLOAT,                         -- ms (optionnel)
  accel_x       FLOAT,                         -- g
  accel_y       FLOAT,                         -- g
  accel_z       FLOAT,                         -- g
  steps         INT DEFAULT 0,
  activity      TEXT DEFAULT 'rest' CHECK (activity IN ('rest', 'walking', 'active', 'sleep')),
  stress        FLOAT CHECK (stress >= 0 AND stress <= 1),        -- 0.0 à 1.0
  battery       INT CHECK (battery >= 0 AND battery <= 100),      -- % batterie bracelet
  state         TEXT DEFAULT 'green' CHECK (state IN ('green', 'orange', 'red')),
  recorded_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour requêtes fréquentes
CREATE INDEX IF NOT EXISTS idx_physio_user_id ON physiological_data(user_id);
CREATE INDEX IF NOT EXISTS idx_physio_recorded_at ON physiological_data(recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_physio_user_time ON physiological_data(user_id, recorded_at DESC);

-- ============================================================
-- ALERTS (alertes générées par le moteur d'analyse)
-- ============================================================
CREATE TABLE IF NOT EXISTS alerts (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN (
                    'tachycardia',    -- rythme cardiaque trop élevé
                    'bradycardia',    -- rythme cardiaque trop bas
                    'fall',           -- chute détectée
                    'inactivity',     -- inactivité prolongée
                    'stress',         -- stress élevé
                    'hrv_anomaly',    -- variabilité cardiaque anormale
                    'low_battery'     -- batterie faible
                  )),
  severity        TEXT NOT NULL CHECK (severity IN ('orange', 'red')),
  message         TEXT NOT NULL,
  suggestion      TEXT,
  data_snapshot   JSONB,             -- snapshot des données au moment de l'alerte
  acknowledged    BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  triggered_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_triggered_at ON alerts(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_unacknowledged ON alerts(user_id, acknowledged) WHERE acknowledged = FALSE;

-- ============================================================
-- STATES HISTORY (résumé horaire de l'état utilisateur)
-- ============================================================
CREATE TABLE IF NOT EXISTS states_history (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state         TEXT NOT NULL CHECK (state IN ('green', 'orange', 'red')),
  duration_s    INT DEFAULT 0,       -- durée dans cet état (secondes)
  data_count    INT DEFAULT 0,       -- nombre de points de données
  recorded_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_states_user_id ON states_history(user_id);
CREATE INDEX IF NOT EXISTS idx_states_recorded_at ON states_history(recorded_at DESC);

-- ============================================================
-- REFRESH TOKENS (authentification longue durée)
-- ============================================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id            BIGSERIAL PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT UNIQUE NOT NULL,   -- SHA-256 du token (jamais le token brut)
  family        UUID NOT NULL,          -- rotation family — détecte la réutilisation
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked       BOOLEAN DEFAULT FALSE,
  revoked_at    TIMESTAMPTZ,
  user_agent    TEXT,                   -- appareil/navigateur
  ip_address    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_token_hash   ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_user_id      ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_family       ON refresh_tokens(family);
CREATE INDEX IF NOT EXISTS idx_refresh_expires_at   ON refresh_tokens(expires_at);

-- ============================================================
-- TRIGGER: updated_at automatique
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS users_updated_at ON users;
CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS thresholds_updated_at ON user_thresholds;
CREATE TRIGGER thresholds_updated_at
  BEFORE UPDATE ON user_thresholds
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
