'use strict';

/**
 * Rate limit do login. Mitiga forca bruta limitando tentativas por IP.
 * Janela e teto configuraveis via .env (LOGIN_RATE_WINDOW_MS / LOGIN_RATE_MAX).
 */

const rateLimit = require('express-rate-limit');
const config = require('../config');

const loginRateLimit = rateLimit({
  windowMs: config.loginRateWindowMs,
  max: config.loginRateMax,
  standardHeaders: true,
  legacyHeaders: false,
  // conta so as tentativas que falharam (login OK nao gasta cota)
  skipSuccessfulRequests: true,
  message: { erro: 'Muitas tentativas de login. Tente novamente em alguns minutos.' },
});

module.exports = { loginRateLimit };
