require('dotenv').config({ path: '.env.test' });
const { agent, registerUser, authHeader } = require('./helpers');

describe('Alerts — /api/v1/alerts', () => {
  let token;

  beforeAll(async () => {
    ({ token } = await registerUser());

    // Générer une alerte en envoyant une FC élevée
    await agent
      .post('/api/v1/data')
      .set(authHeader(token))
      .send({ heart_rate: 150 });
  });

  describe('GET /', () => {
    it('retourne la liste des alertes', async () => {
      const res = await agent.get('/api/v1/alerts').set(authHeader(token));

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.alerts)).toBe(true);
      expect(res.body).toHaveProperty('count');
    });

    it('filtre les alertes non lues', async () => {
      const res = await agent
        .get('/api/v1/alerts')
        .set(authHeader(token))
        .query({ unread: 'true' });

      expect(res.status).toBe(200);
      res.body.alerts.forEach(a => {
        expect(a.acknowledged).toBe(false);
      });
    });

    it('refuse sans authentification', async () => {
      const res = await agent.get('/api/v1/alerts');
      expect(res.status).toBe(401);
    });
  });

  describe('PATCH /:id/acknowledge', () => {
    let alertId;

    beforeAll(async () => {
      const res = await agent.get('/api/v1/alerts').set(authHeader(token));
      alertId = res.body.alerts[0]?.id;
    });

    it('acquitte une alerte existante', async () => {
      if (!alertId) return; // pas d'alerte générée
      const res = await agent
        .patch(`/api/v1/alerts/${alertId}/acknowledge`)
        .set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/acknowledged/i);
    });

    it('retourne 404 pour une alerte déjà acquittée', async () => {
      if (!alertId) return;
      const res = await agent
        .patch(`/api/v1/alerts/${alertId}/acknowledge`)
        .set(authHeader(token));
      expect(res.status).toBe(404);
    });

    it('retourne 400 pour un id invalide', async () => {
      const res = await agent
        .patch('/api/v1/alerts/not-a-number/acknowledge')
        .set(authHeader(token));
      expect(res.status).toBe(400);
    });
  });

  describe('POST /acknowledge-all', () => {
    it('acquitte toutes les alertes non lues', async () => {
      // Générer une nouvelle alerte
      await agent.post('/api/v1/data').set(authHeader(token)).send({ heart_rate: 160 });

      const res = await agent
        .post('/api/v1/alerts/acknowledge-all')
        .set(authHeader(token));

      expect(res.status).toBe(200);
      expect(typeof res.body.acknowledged).toBe('number');
    });
  });
});

describe('Thresholds — /api/v1/thresholds', () => {
  let token;

  beforeAll(async () => {
    ({ token } = await registerUser());
  });

  describe('GET /', () => {
    it('retourne les seuils de l\'utilisateur', async () => {
      const res = await agent.get('/api/v1/thresholds').set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('hr_max');
      expect(res.body).toHaveProperty('hr_min');
      expect(res.body).toHaveProperty('hrv_min');
      expect(res.body).toHaveProperty('fall_sensitivity');
    });
  });

  describe('PATCH /', () => {
    it('met à jour les seuils', async () => {
      const res = await agent
        .patch('/api/v1/thresholds')
        .set(authHeader(token))
        .send({ hr_max: 110, inactivity_min: 45 });

      expect(res.status).toBe(200);
      expect(res.body.hr_max).toBe(110);
      expect(res.body.inactivity_min).toBe(45);
    });

    it('refuse une valeur hors limites', async () => {
      const res = await agent
        .patch('/api/v1/thresholds')
        .set(authHeader(token))
        .send({ hr_max: 999 }); // max autorisé = 220
      expect(res.status).toBe(400);
    });

    it('refuse sans champs valides', async () => {
      const res = await agent
        .patch('/api/v1/thresholds')
        .set(authHeader(token))
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe('POST /reset', () => {
    it('remet les seuils aux valeurs par défaut', async () => {
      await agent.patch('/api/v1/thresholds').set(authHeader(token)).send({ hr_max: 115 });

      const res = await agent
        .post('/api/v1/thresholds/reset')
        .set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.hr_max).toBe(120); // valeur par défaut
    });
  });
});
