# ── Stage 1 : dépendances ─────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2 : image finale ────────────────────────────────────
FROM node:20-alpine AS runner

# Sécurité — utilisateur non-root
RUN addgroup -S senso && adduser -S senso -G senso

WORKDIR /app

# Copier les dépendances depuis le stage précédent
COPY --from=deps /app/node_modules ./node_modules

# Copier le code source
COPY src ./src
COPY package.json ./

# Permissions + script exécutable
RUN chown -R senso:senso /app && chmod +x /app/src/entrypoint.sh
USER senso

EXPOSE 3000

ENV NODE_ENV=production

ENTRYPOINT ["sh", "/app/src/entrypoint.sh"]
CMD ["node", "src/server.js"]
