require('dotenv').config({ path: '.env.test' });
const { agent, registerUser, authHeader } = require('./helpers');

describe('Auth — /api/v1/auth', () => {
  // ── POST /register ──────────────────────────────────────────
  describe('POST /register', () => {
    it('crée un nouvel utilisateur et retourne un token', async () => {
      const email = `reg_${Date.now()}@example.com`;
      const res = await agent.post('/api/v1/auth/register').send({
        email,
        password: 'Test1234!',
        first_name: 'Alice',
        last_name: 'Dupont',
        age: 35,
      });

      expect(res.status).toBe(201);
      expect(res.body.access_token).toBeDefined();
      expect(res.body.user.email).toBe(email);
      expect(res.body.user.password).toBeUndefined(); // pas de fuite de mot de passe
    });

    it('refuse un email invalide', async () => {
      const res = await agent.post('/api/v1/auth/register').send({
        email: 'not-an-email',
        password: 'Test1234!',
      });
      expect(res.status).toBe(400);
    });

    it('refuse un mot de passe trop court', async () => {
      const res = await agent.post('/api/v1/auth/register').send({
        email: `short_${Date.now()}@example.com`,
        password: '123',
      });
      expect(res.status).toBe(400);
    });

    it('refuse un email déjà utilisé', async () => {
      const email = `dup_${Date.now()}@example.com`;
      await agent.post('/api/v1/auth/register').send({ email, password: 'Test1234!' });
      const res = await agent.post('/api/v1/auth/register').send({ email, password: 'Test1234!' });
      expect(res.status).toBe(409);
    });
  });

  // ── POST /login ─────────────────────────────────────────────
  describe('POST /login', () => {
    let email;

    beforeAll(async () => {
      email = `login_${Date.now()}@example.com`;
      await agent.post('/api/v1/auth/register').send({ email, password: 'Test1234!' });
    });

    it('connecte avec des identifiants valides', async () => {
      const res = await agent.post('/api/v1/auth/login').send({ email, password: 'Test1234!' });
      expect(res.status).toBe(200);
      expect(res.body.access_token).toBeDefined();
      expect(res.body.user.email).toBe(email);
    });

    it('refuse un mauvais mot de passe', async () => {
      const res = await agent.post('/api/v1/auth/login').send({ email, password: 'WrongPass!' });
      expect(res.status).toBe(401);
    });

    it('refuse un email inconnu', async () => {
      const res = await agent.post('/api/v1/auth/login').send({
        email: 'nobody@example.com',
        password: 'Test1234!',
      });
      expect(res.status).toBe(401);
    });
  });

  // ── GET /me ─────────────────────────────────────────────────
  describe('GET /me', () => {
    it('retourne le profil de l\'utilisateur connecté', async () => {
      const { token, user } = await registerUser();
      const res = await agent.get('/api/v1/auth/me').set(authHeader(token));

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(user.id);
      expect(res.body.email).toBe(user.email);
    });

    it('refuse sans token', async () => {
      const res = await agent.get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });

    it('refuse avec un token invalide', async () => {
      const res = await agent.get('/api/v1/auth/me').set({ Authorization: 'Bearer fake.token.here' });
      expect(res.status).toBe(401);
    });
  });

  // ── PATCH /device ────────────────────────────────────────────
  describe('PATCH /device', () => {
    it('enregistre un device_id', async () => {
      const { token } = await registerUser();
      const res = await agent
        .patch('/api/v1/auth/device')
        .set(authHeader(token))
        .send({ device_id: 'AA:BB:CC:DD:EE:FF', fcm_token: 'fcm_abc123' });

      expect(res.status).toBe(200);
      expect(res.body.message).toMatch(/success/i);
    });

    it('refuse sans device_id', async () => {
      const { token } = await registerUser();
      const res = await agent
        .patch('/api/v1/auth/device')
        .set(authHeader(token))
        .send({});
      expect(res.status).toBe(400);
    });
  });
});
