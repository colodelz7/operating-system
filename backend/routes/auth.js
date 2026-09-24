'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const repo = require('../data');
const config = require('../config');
const { exigirLogin } = require('../middleware/auth');
const { loginRateLimit } = require('../middleware/rateLimit');
const { validate } = require('../middleware/validate');
const { loginSchema } = require('../schemas/auth.schema');
const bloqueio = require('../middleware/bloqueioLogin');
const { registrar, ipDe } = require('../middleware/auditoria');

const router = express.Router();

const minutos = (ms) => Math.max(1, Math.round(ms / 60000));

/**
 * Isca para quando a conta nao existe.
 *
 * Precisa ser um hash bcrypt DE VERDADE, com o mesmo custo dos hashes reais.
 * A versao anterior usava uma string invalida: o bcrypt recusava na hora e a
 * resposta voltava em 3ms, contra 120ms de uma conta existente. Esses 117ms
 * de diferenca eram suficientes para descobrir quais logins existem, mesmo
 * com a mensagem de erro sendo a mesma.
 *
 * Gerado uma vez no boot, sobre um valor aleatorio que ninguem conhece.
 */
const HASH_ISCA = bcrypt.hashSync(require('crypto').randomBytes(24).toString('hex'), 10);

// POST /api/auth/login  { usuario, senha }
// Camadas: rate-limit por IP -> schema -> bloqueio temporario -> senha.
router.post('/login', loginRateLimit, validate(loginSchema), async (req, res, next) => {
  try {
    const usuario = String(req.body.usuario || '').toLowerCase().trim();
    const senha = String(req.body.senha || '');
    const ip = ipDe(req);

    // 1) ja esta de castigo? nem chega a comparar a senha.
    const travado = await bloqueio.estado(ip, usuario);
    if (travado.bloqueado) {
      await registrar(req, {
        tipo: 'login_bloqueio', entidade: 'sessao', usuario_id: null, usuario_nome: usuario,
        titulo: usuario, detalhe: `tentou entrar durante o bloqueio (faltavam ${travado.segundos}s)`,
      });
      return res.status(429).json({
        erro: `Muitas tentativas. Tente de novo em ${travado.segundos > 60 ? minutos(travado.restanteMs) + ' minuto(s)' : travado.segundos + ' segundos'}.`,
        segundos_restantes: travado.segundos,
        bloqueado_ate: new Date(Date.now() + travado.restanteMs).toISOString(),
      });
    }

    const u = await repo.buscarUsuarioPorLogin(usuario);
    // mensagem generica de proposito (nao revela se o usuario existe)
    const generico = { erro: 'Usuário ou senha inválidos' };
    // compara mesmo sem usuario, para o tempo de resposta nao entregar a conta
    const ok = u
      ? await bcrypt.compare(senha, u.senha_hash)
      : (await bcrypt.compare(senha, HASH_ISCA), false);

    // 2) falhou: conta a tentativa (por IP e por conta) e audita.
    if (!ok) {
      const st = await bloqueio.registrarFalha(ip, usuario);
      await registrar(req, {
        tipo: st.bloqueado ? 'login_bloqueio' : 'login_falha',
        entidade: 'sessao', usuario_id: u ? u.id : null, usuario_nome: usuario, titulo: usuario,
        detalhe: st.bloqueado
          ? `errou a senha e esta origem ficou bloqueada por ${minutos(config.loginBloqueioMs)} minuto(s)`
          : `errou a senha (restam ${st.restantes} tentativa(s) desta origem)`,
      });

      // Falhas espalhadas por varias origens na mesma conta: nao bloqueia
      // ninguem (senao qualquer um trancaria a conta alheia), mas fica
      // registrado para o Atendimento enxergar o ataque no historico.
      if (st.ataqueDistribuido) {
        await registrar(req, {
          tipo: 'login_bloqueio', entidade: 'sessao',
          usuario_id: u ? u.id : null, usuario_nome: usuario, titulo: usuario,
          detalhe: `possivel ataque distribuido: ${st.falhasDaConta} falhas nesta conta vindas de varias origens`,
        });
      }
      if (st.bloqueado) {
        return res.status(429).json({
          erro: `Muitas tentativas. Acesso bloqueado por ${minutos(config.loginBloqueioMs)} minuto(s).`,
          segundos_restantes: st.segundos,
          bloqueado_ate: new Date(Date.now() + st.restanteMs).toISOString(),
        });
      }
      return res.status(401).json(generico);
    }

    // 3) conta desativada nao entra. A mensagem e a mesma de senha errada, de
    // proposito: quem esta tentando adivinhar nao descobre quais contas existem.
    if (u.ativo === false) {
      await registrar(req, {
        tipo: 'login_falha', entidade: 'sessao', usuario_id: u.id, usuario_nome: usuario,
        titulo: usuario, detalhe: 'tentou entrar com a conta desativada',
      });
      return res.status(401).json(generico);
    }

    // 4) acertou: zera as contagens e regenera a sessao (evita fixation)
    await bloqueio.limpar(ip, usuario);
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.usuarioId = u.id;
      // versao da senha no momento do login: se a senha mudar depois, esta
      // sessao deixa de casar e cai no proximo pedido
      req.session.senhaVersao = u.senha_versao || 0;
      req.session.save(async (err2) => {
        if (err2) return next(err2);
        await registrar(req, {
          tipo: 'login', entidade: 'sessao', entidade_id: u.id,
          usuario_id: u.id, usuario_nome: u.nome, titulo: u.nome,
          setor_id: u.setor_id, detalhe: 'entrou no sistema',
        });
        res.json({ ok: true });
      });
    });
  } catch (e) { next(e); }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  // le quem esta saindo ANTES de destruir a sessao (auditoria pelo servidor)
  let quem = null;
  try {
    const uid = req.session && req.session.usuarioId;
    if (uid) quem = await repo.buscarUsuarioPorId(uid);
  } catch (_) { /* segue o logout mesmo se a leitura falhar */ }

  if (quem) {
    await registrar(req, {
      tipo: 'logout', entidade: 'sessao', entidade_id: quem.id,
      usuario_id: quem.id, usuario_nome: quem.nome, titulo: quem.nome,
      setor_id: quem.setor_id, detalhe: 'saiu do sistema',
    });
  }

  req.session.destroy(() => {
    res.clearCookie(config.cookieName);
    res.json({ ok: true });
  });
});

// GET /api/auth/me  -> dados do usuario logado (sem senha)
router.get('/me', exigirLogin, (req, res) => {
  res.json({ usuario: req.usuario });
});

module.exports = router;
