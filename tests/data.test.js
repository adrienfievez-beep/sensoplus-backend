require('dotenv').config({ path: '.env.test' });
const { agent, registerUser, authHeader } = require('./helpers');

describe('Data — /api/v1/data', () => {
  let token;

  beforeAll(async () => {
    ({ token } = await registerUser());
  });

  // ── POST / ───────────────────────────────────────────────────
  describe('POST /', () => {
    it('accepte une lecture valide et retourne l\'état', async () => {
      const res = await agent
        .post('/api/v1/data')
        .set(authHeader(token))
        .send({
          heart_rate: 72,
          hrv: 45.5,
          accel_x: 0.02,
          accel_y: -0.01,
          accel_z: 9.8,
          steps: 120,
          activity: 'walking',
          stress: 0.3,
          battery: 80,
        });

      expect(res.status).toBe(201);
      expect(res.body.id).toBeDefined();
      expect(['green', 'orange', 'red']).toContain(res.body.state);
      expect(Array.isArray(res.body.alerts)).toBe(true);
      expect(res.body.recorded_at).toBeDefined();
    });

    it('génère une alerte tachycardie pour FC > 120', async () => {
      const res = await agent
        .post('/api/v1/data')
        .set(authHeader(token))
        .send({ heart_rate: 145, battery: 80 });

      expect(res.status).toBe(201);
      expect(res.body.state).not.toBe('green');
      const alert = res.body.alerts.find(a => a.type === 'tachycardia');
      expect(alert).toBeDefined();
      expect(alert.severity).toBeDefined();
    });

    it('génère une alerte bradycardie pour FC < 45', async () => {
      const res = await agent
        .post('/api/v1/data')
        .set(authHeader(token))
        .send({ heart_rate: 28 });

      expect(res.status).toBe(201);
      const alert = res.body.alerts.find(a => a.type === 'bradycardia');
      expect(alert).toBeDefined();
    });

    it('génère une alerte chute pour accélération élevée', async () => {
      const res = await agent
        .post('/api/v1/data')
        .set(authHeader(token))
        .send({
          heart_rate: 75,
          accel_x: 3.5,
          accel_y: 2.8,
          accel_z: 1.2,
        });

      expect(res.status).toBe(201);
      expect(res.body.state).toBe('red');
      const alert = res.body.alerts.find(a => a.type === 'fall');
      expect(alert).toBeDefined();
    });

    it('refuse une FC hors limites (< 20)', async () => {
      const res = await agent
        .post('/api/v1/data')
        .set(authHeader(token))
        .send({ heart_rate: 5 });
      expect(res.status).toBe(400);
    });

    it('refuse sans authentification', async () => {
      const res = await agent.post('/api/v1/data').send({ heart_rate: 72 });
      expect(res.status).toBe(401);
    });
  });

  // ── POST /batch ──────────────────────────────────────────────
  describe('POST /batch', () => {
    it('insère un lot de lectures', async () => {
      const now = new Date();
      const readings = Array.from({ length: 5 }, (_, i) => ({
        heart_rate: 65 + i,
        recorded_at: new Date(now.getTime() - i * 60000).toISOString(),
      }));

      const res = await agent
        .post('/api/v1/data/batch')
        .set(authHeader(token))
        .send({ readings });

      expect(res.status).toBe(201);
      expect(res.body.inserted).toBe(5);
      expect(res.body.ids).toHaveLength(5);
    });

    it('refuse un lot vide', async () => {
      const res = await agent
        .post('/api/v1/data/batch')
        .set(authHeader(token))
        .send({ readings: [] });
      expect(res.status).toBe(400);
    });

    it('refuse un lot sans recorded_at', async () => {
      const res = await agent
        .post('/api/v1/data/batch')
        .set(authHeader(token))
        .send({ readings: [{ heart_rate: 70 }] }); // manque recorded_at
      expect(res.status).toBe(400);
    });
  });

  // ── GET / ────────────────────────────────────────────────────
  describe('GET /', () => {
    it('retourne l\'historique avec pagination', async () => {
      const res = await agent
        .get('/api/v1/data')
        .set(authHeader(token))
        .query({ limit: 10, offset: 0 });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body).toHaveProperty('count');
      expect(res.body).toHaveProperty('from');
      expect(res.body).toHaveProperty('to');
    });

    it('filtre par plage de dates', async () => {
      const from = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h
      const to = new Date().toISOString();
      const res = await agent
        .get('/api/v1/data')
        .set(authHeader(token))
        .query({ from, to, limit: 5 });

      expect(res.status).toBe(200);
      res.body.data.forEach(d => {
        expect(new Date(d.recorded_at) >= new Date(from)).toBe(true);
      });
    });
  });

  // ── GET /summary ─────────────────────────────────────────────
  describe('GET /summary', () => {
    it('retourne un résumé de la journée', async () => {
      const res = await agent.get('/api/v1/data/summary').set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('avg_hr');
      expect(res.body).toHaveProperty('total_steps');
      expect(res.body).toHaveProperty('data_points');
      expect(res.body.alerts).toHaveProperty('total');
      expect(res.body.alerts).toHaveProperty('unread');
    });
  });
});
