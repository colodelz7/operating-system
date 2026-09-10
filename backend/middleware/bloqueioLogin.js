'use strict';

/**
 * Bloqueio temporario de login.
 *
 * Depois de N falhas seguidas (padrao 3), o login fica travado por X minutos
 * (padrao 5). A contagem e feita em DUAS chaves independentes:
 *   - por IP    -> impede varredura de varias contas a partir da mesma origem;
 *   - por conta -> impede varredura de senhas da mesma conta a partir de
 *                  varios IPs.
 * O que estourar primeiro bloqueia, e o tempo restante volta na resposta para
 * a tela de login mostrar o cronometro regressivo.
 *
 * O estado vive no repositorio: em memoria no modo local, e no Postgres
 * quando ha DATABASE_URL. Com banco, o bloqueio sobrevive a restart do
 * servidor e vale para todas as instancias da API ao mesmo tempo, que era a
 * brecha da versao anterior (bastava reiniciar para zerar a contagem).
 */

const config = require('../config');
const repo = require('../data');

const chaveIp = (ip) => 'ip:' + String(ip || 'desconhecido');
const chaveConta = (usuario) => 'conta:' + String(usuario || '').toLowerCase().trim();

// Le o registro descartando o que ja expirou (janela de contagem ou bloqueio).
async function ler(chave) {
  const reg = await repo.lerBloqueio(chave);
  if (!reg) return null;
  const agora = Date.now();
  if (reg.ate && reg.ate <= agora) { await repo.limparBloqueios([chave]); return null; }
  if (!reg.ate && reg.visto && agora - reg.visto > config.loginBloqueioMs) {
    await repo.limparBloqueios([chave]);
    return null;
  }
  return reg;
}

// Quanto falta (ms) para destravar. 0 = liberado.
async function estado(ip, usuario) {
  const regs = await Promise.all([ler(chaveIp(ip)), ler(chaveConta(usuario))]);
  const agora = Date.now();
  const ms = regs.reduce((max, reg) => (reg && reg.ate ? Math.max(max, reg.ate - agora) : max), 0);
  const restanteMs = Math.max(0, ms);
  return { bloqueado: restanteMs > 0, restanteMs, segundos: Math.ceil(restanteMs / 1000) };
}

// Registra uma falha nas duas chaves e devolve o estado resultante.
async function registrarFalha(ip, usuario) {
  const limite = config.loginBloqueioTentativas;
  const agora = Date.now();

  for (const chave of [chaveIp(ip), chaveConta(usuario)]) {
    const reg = (await ler(chave)) || { falhas: 0, ate: null };
    const falhas = reg.falhas + 1;
    await repo.salvarBloqueio(chave, {
      falhas,
      ate: falhas >= limite ? agora + config.loginBloqueioMs : null,
      visto: agora,
    });
  }

  const st = await estado(ip, usuario);
  const reg = await ler(chaveConta(usuario));
  st.restantes = Math.max(0, limite - ((reg && reg.falhas) || 0));
  return st;
}

// Login deu certo: zera as duas contagens.
async function limpar(ip, usuario) {
  await repo.limparBloqueios([chaveIp(ip), chaveConta(usuario)]);
}

// Faxina periodica para a tabela (ou o mapa) nao crescer sem limite.
const faxina = setInterval(() => {
  repo.limparBloqueiosVelhos(Date.now() - config.loginBloqueioMs)
    .catch((e) => console.error('[bloqueio] falha na limpeza:', e.message));
}, 5 * 60 * 1000);
if (faxina.unref) faxina.unref();

module.exports = { estado, registrarFalha, limpar };
