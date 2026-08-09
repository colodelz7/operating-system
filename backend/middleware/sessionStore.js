'use strict';

/**
 * Fabrica o store de sessao conforme o ambiente.
 *  - Com DATABASE_URL  -> connect-pg-simple (persiste no Postgres).
 *  - Sem DATABASE_URL  -> undefined (express-session usa o MemoryStore
 *    padrao, bom para dev local; nao usar em producao).
 *
 * A tabela usada pelo connect-pg-simple e criada por db/session.sql
 * (ou automaticamente, ver createTableIfMissing abaixo).
 */

const config = require('../config');

function criarSessionStore(session) {
  if (!config.usePostgres) return undefined; // MemoryStore padrao (dev)

  const PgSession = require('connect-pg-simple')(session);
  return new PgSession({
    conString: config.databaseUrl,
    tableName: 'session',
    createTableIfMissing: true, // cria a tabela "session" se ainda nao existir
    pruneSessionInterval: 60 * 15, // limpa sessoes expiradas a cada 15 min
  });
}

module.exports = { criarSessionStore };
