# ============================================================
#  API (Node + Express)
# ============================================================
FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependencias primeiro: aproveita o cache quando so o codigo muda.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

# Pasta de uploads pertence ao usuario da aplicacao (o container nao roda
# como root).
RUN mkdir -p uploads && chown -R node:node /app
USER node

# Dentro do container escutamos em todas as interfaces: quem limita o acesso
# e a publicacao de porta do compose, presa em 127.0.0.1 no host.
ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
