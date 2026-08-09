'use strict';

// Carrega variaveis do .env (se existir). Nao quebra se nao existir.
try { require('dotenv').config(); } catch (_) { /* dotenv opcional em dev */ }

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-colodel-trocar',
  databaseUrl: (process.env.DATABASE_URL || '').trim(),
  cookieSecure: String(process.env.COOKIE_SECURE).toLowerCase() === 'true',

  // Confie no proxy reverso (necessario p/ cookie secure e IP real do
  // rate-limit quando o Node roda atras de nginx/host). "true" em producao.
  trustProxy: String(process.env.TRUST_PROXY).toLowerCase() === 'true',

  // Rate limit do /api/auth/login (mitiga forca bruta)
  loginRateWindowMs: parseInt(process.env.LOGIN_RATE_WINDOW_MS, 10) || (15 * 60 * 1000), // 15 min
  loginRateMax: parseInt(process.env.LOGIN_RATE_MAX, 10) || 10,                           // 10 tentativas/janela

  // Limite de upload: 25MB (conforme combinado)
  uploadMaxBytes: 25 * 1024 * 1024,
  uploadAllowedMime: [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
};

// true = usa Postgres | false = usa armazenamento em memoria
config.usePostgres = config.databaseUrl.length > 0;

module.exports = config;
