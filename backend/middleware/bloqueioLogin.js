'use strict';

/**
 * Bloqueio temporario de login.
 *
 * O desenho tem tres contadores, e a diferenca entre eles e o que impede que
 * a protecao vire arma:
 *
 *   ip:<ip>            bloqueia a origem depois de N falhas. Segura quem
 *                      varre varias contas a partir do mesmo lugar.
 *   par:<conta>|<ip>   bloqueia aquela conta VINDA DAQUELA ORIGEM. Segura a
 *                      forca bruta de senha sem afetar a pessoa de verdade,
 *                      que entra de outro IP.
 *   conta:<conta>      NAO bloqueia nada. So conta as falhas espalhadas e
 *                      avisa a auditoria quando passam do teto, que e o
 *                      sinal de ataque distribuido.
 *
 * Antes, o contador por conta bloqueava de verdade, e bastava errar a senha
 * de alguem tres vezes para deixar essa pessoa de fora do sistema por cinco
 * minutos, quantas vezes o atacante quisesse. Agora quem erra tranca a si
 * mesmo, nao o dono da conta.
 *
 * O estado vive no repositorio: em memoria no modo local, e no Postgres
 * quando ha DATABASE_URL, entao o bloqueio sobrevive a restart e vale para
 * todas as instancias da API.
 */

const config = require('../config');
const repo = require('../data');

// Quantas falhas espalhadas por varios IPs ate a auditoria registrar que
// aquela conta esta sob ataque. Nao bloqueia, so avisa.
const FATOR_ALERTA = 4;

const normalizarConta = (usuario) => String(usuario || '').toLowerCase().trim();

const chaveIp = (ip) => 'ip:' + String(ip || 'desconhecido');
const chavePar = (usuario, ip) => `par:${normalizarConta(usuario)}|${String(ip || 'desconhecido')}`;
const chaveConta = (usuario) => 'conta:' + normalizarConta(usuario);

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

/**
 * Quanto falta (ms) para destravar. Olha apenas as chaves que bloqueiam:
 * a origem e o par conta+origem.
 */
async function estado(ip, usuario) {
  const regs = await Promise.all([ler(chaveIp(ip)), ler(chavePar(usuario, ip))]);
  const agora = Date.now();
  const ms = regs.reduce((max, reg) => (reg && reg.ate ? Math.max(max, reg.ate - agora) : max), 0);
  const restanteMs = Math.max(0, ms);
  return { bloqueado: restanteMs > 0, restanteMs, segundos: Math.ceil(restanteMs / 1000) };
}

/**
 * Registra uma falha nos tres contadores e devolve o estado resultante.
 * O retorno traz ainda:
 *   restantes          quantas tentativas faltam antes de travar
 *   ataqueDistribuido  true quando a conta acumulou falhas de varias origens
 */
async function registrarFalha(ip, usuario) {
  const limite = config.loginBloqueioTentativas;
  const agora = Date.now();

  // as duas chaves que travam
  for (const chave of [chaveIp(ip), chavePar(usuario, ip)]) {
    const reg = (await ler(chave)) || { falhas: 0, ate: null };
    const falhas = reg.falhas + 1;
    await repo.salvarBloqueio(chave, {
      falhas,
      ate: falhas >= limite ? agora + config.loginBloqueioMs : null,
      visto: agora,
    });
  }

  // o contador da conta so observa, nunca bloqueia
  const regConta = (await ler(chaveConta(usuario))) || { falhas: 0, ate: null };
  const falhasDaConta = regConta.falhas + 1;
  await repo.salvarBloqueio(chaveConta(usuario), { falhas: falhasDaConta, ate: null, visto: agora });

  const st = await estado(ip, usuario);
  const par = await ler(chavePar(usuario, ip));
  st.restantes = Math.max(0, limite - ((par && par.falhas) || 0));
  st.ataqueDistribuido = falhasDaConta >= limite * FATOR_ALERTA;
  st.falhasDaConta = falhasDaConta;
  return st;
}

// Login deu certo: zera as contagens daquela pessoa naquela origem.
async function limpar(ip, usuario) {
  await repo.limparBloqueios([chaveIp(ip), chavePar(usuario, ip), chaveConta(usuario)]);
}

// Faxina periodica para a tabela (ou o mapa) nao crescer sem limite.
const faxina = setInterval(() => {
  repo.limparBloqueiosVelhos(Date.now() - config.loginBloqueioMs)
    .catch((e) => console.error('[bloqueio] falha na limpeza:', e.message));
}, 5 * 60 * 1000);
if (faxina.unref) faxina.unref();

module.exports = { estado, registrarFalha, limpar };
