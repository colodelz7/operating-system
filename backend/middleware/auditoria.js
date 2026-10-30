'use strict';

/**
 * Trilha de auditoria. TUDO e gravado aqui no servidor: o navegador nunca
 * escolhe o que entra no histórico, nem quem e o autor do evento.
 *
 * Cada registro guarda: acao, entidade afetada, autor, quando, IP e navegador.
 */

const repo = require('../data');

// IP real do cliente. Com TRUST_PROXY=true o express ja resolve o
// X-Forwarded-For; sem isso, usa o socket. Normaliza o IPv4 mapeado em IPv6.
function ipDe(req) {
  const bruto = (req && (req.ip || (req.connection && req.connection.remoteAddress))) || '';
  return String(bruto).replace(/^::ffff:/, '').slice(0, 60) || 'desconhecido';
}

function navegadorDe(req) {
  return String((req && req.get && req.get('user-agent')) || '').slice(0, 300);
}

// Autor: sempre o usuario da sessao recarregado pelo exigirLogin. Em eventos
// de login/logout o chamador passa o autor explicitamente.
function autorDe(req, extra) {
  if (extra && ('usuario_id' in extra || 'usuario_nome' in extra)) {
    return { id: extra.usuario_id ?? null, nome: extra.usuario_nome || '' };
  }
  const u = req && req.usuario;
  return { id: u ? u.id : null, nome: u ? u.nome : '' };
}

/**
 * registrar(req, { tipo, entidade, entidade_id, titulo, detalhe, ... })
 * Nunca lanca: uma falha ao auditar nao pode derrubar a operacao do usuario.
 */
async function registrar(req, dados = {}) {
  try {
    const autor = autorDe(req, dados);
    return await repo.registrarHistorico({
      tipo: dados.tipo,
      entidade: dados.entidade || 'tarefa',
      entidade_id: dados.entidade_id ?? dados.tarefa_id ?? null,
      tarefa_id: dados.entidade === 'tarefa' || !dados.entidade ? (dados.tarefa_id ?? dados.entidade_id ?? null) : null,
      titulo: dados.titulo || '',
      setor_id: dados.setor_id || null,
      usuario_id: autor.id,
      usuario_nome: autor.nome,
      detalhe: (dados.detalhe || '') + (req && req.viaAssistente ? ' (pelo ColodelBot)' : ''),
      cliente_id: dados.cliente_id || null,
      cliente_nome: dados.cliente_nome || '',
      responsaveis: Array.isArray(dados.responsaveis) ? dados.responsaveis : [],
      prioridade: dados.prioridade || '',
      ip: ipDe(req),
      user_agent: navegadorDe(req),
    });
  } catch (e) {
    console.error('[auditoria] falha ao registrar evento:', e.message);
    return null;
  }
}

module.exports = { registrar, ipDe, navegadorDe };
