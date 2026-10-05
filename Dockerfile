FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

# Dependências do servidor (sem as de dev — drizzle-kit só roda local)
COPY package*.json ./
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

# Código + migrations (server/drizzle) + página
COPY public ./public
COPY server ./server

EXPOSE 8080

# As migrations do Drizzle rodam sozinhas no boot (server/index.js)
CMD ["node", "server/index.js"]
