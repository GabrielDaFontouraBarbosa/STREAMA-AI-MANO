FROM node:20-alpine

WORKDIR /app

# Copia package.json da raiz e do server
COPY package*.json ./
COPY server/package*.json ./server/

# Instala dependências da raiz e do server
RUN npm install
RUN cd server && npm install

# Copia o código
COPY public ./public
COPY server ./server

# Expõe a porta (Railway vai usar PORT env var)
EXPOSE 8080

# Roda o servidor
CMD ["npm", "start"]
