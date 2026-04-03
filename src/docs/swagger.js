const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SENSO+ API',
      version: '1.0.0',
      description: `
API REST du bracelet connecté **SENSO+** — monitoring santé en temps réel.

## Authentification
Toutes les routes (sauf \`/auth/register\` et \`/auth/login\`) nécessitent un token JWT.

Ajouter dans le header : \`Authorization: Bearer <token>\`

## États de santé
| État | Couleur | Signification |
|------|---------|---------------|
| \`green\` | 🟢 | Tout va bien |
| \`orange\` | 🟠 | Attention requise |
| \`red\` | 🔴 | Alerte — réagissez maintenant |

## WebSocket
Connectez-vous sur \`ws://<host>\` avec \`{ auth: { token: "Bearer ..." } }\`.

Événements reçus : \`state:update\`, \`alert:new\`
      `.trim(),
      contact: {
        name: 'SENSO+ Support',
        email: 'support@sensoplus.com',
      },
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Développement' },
      { url: 'https://api.sensoplus.com', description: 'Production' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid', example: 'a1b2c3d4-...' },
            email: { type: 'string', format: 'email', example: 'marie@example.com' },
            first_name: { type: 'string', example: 'Marie' },
            last_name: { type: 'string', example: 'Dupont' },
            age: { type: 'integer', example: 72 },
            weight: { type: 'number', example: 65.5 },
            height: { type: 'number', example: 165.0 },
            device_id: { type: 'string', example: 'AA:BB:CC:DD:EE:FF' },
            role: { type: 'string', enum: ['user', 'admin'], example: 'user' },
            created_at: { type: 'string', format: 'date-time' },
          },
        },
        PhysiologicalData: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            heart_rate: { type: 'integer', example: 72, description: 'bpm' },
            hrv: { type: 'number', example: 45.5, description: 'ms' },
            accel_x: { type: 'number', example: 0.02, description: 'g' },
            accel_y: { type: 'number', example: -0.01, description: 'g' },
            accel_z: { type: 'number', example: 9.8, description: 'g' },
            steps: { type: 'integer', example: 1250 },
            activity: { type: 'string', enum: ['rest', 'walking', 'active', 'sleep'] },
            stress: { type: 'number', minimum: 0, maximum: 1, example: 0.3 },
            battery: { type: 'integer', minimum: 0, maximum: 100, example: 80 },
            state: { type: 'string', enum: ['green', 'orange', 'red'] },
            recorded_at: { type: 'string', format: 'date-time' },
          },
        },
        Alert: {
          type: 'object',
          properties: {
            id: { type: 'integer', example: 1 },
            type: {
              type: 'string',
              enum: ['tachycardia', 'bradycardia', 'fall', 'inactivity', 'stress', 'hrv_anomaly', 'low_battery'],
            },
            severity: { type: 'string', enum: ['orange', 'red'] },
            message: { type: 'string', example: 'Rythme cardiaque élevé : 145 bpm' },
            suggestion: { type: 'string', example: 'Asseyez-vous et respirez lentement.' },
            acknowledged: { type: 'boolean', example: false },
            acknowledged_at: { type: 'string', format: 'date-time', nullable: true },
            triggered_at: { type: 'string', format: 'date-time' },
          },
        },
        Thresholds: {
          type: 'object',
          properties: {
            hr_max: { type: 'integer', example: 120, description: 'bpm max avant alerte' },
            hr_min: { type: 'integer', example: 45, description: 'bpm min avant alerte' },
            hrv_min: { type: 'number', example: 20.0, description: 'HRV min en ms' },
            inactivity_min: { type: 'integer', example: 60, description: 'minutes d\'inactivité' },
            fall_sensitivity: { type: 'number', example: 2.5, description: 'seuil en g' },
            stress_threshold: { type: 'number', example: 0.75, description: '0.0 à 1.0' },
            alert_vibration: { type: 'boolean', example: true },
            alert_push: { type: 'boolean', example: true },
          },
        },
        Error: {
          type: 'object',
          properties: {
            error: { type: 'string', example: 'Message d\'erreur' },
          },
        },
        ValidationError: {
          type: 'object',
          properties: {
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },
      },
      responses: {
        Unauthorized: {
          description: 'Token manquant ou invalide',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        Forbidden: {
          description: 'Accès refusé',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        NotFound: {
          description: 'Ressource introuvable',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
        BadRequest: {
          description: 'Paramètres invalides',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } } },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js'],
};

module.exports = swaggerJsdoc(options);
