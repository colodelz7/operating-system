'use strict';

/**
 * Seletor de repositorio.
 * - Sem DATABASE_URL  -> memoryRepo (teste local, dados voláteis)
 * - Com DATABASE_URL  -> pgRepo (Postgres, producao)
 *
 * O resto do sistema importa SEMPRE este arquivo e nunca precisa
 * saber qual dos dois esta ativo.
 */

const config = require('../config');

const repo = config.usePostgres
  ? require('./pgRepo')
  : require('./memoryRepo');

module.exports = repo;
