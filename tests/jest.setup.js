// Force le chargement de .env.test avant chaque fichier de test
// override:true écrase les variables déjà définies (y compris les vars CI vides)
require('dotenv').config({ path: '.env.test', override: true });
