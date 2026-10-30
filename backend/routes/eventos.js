'use strict';

/**
 * Calendario da Equipe: eventos internos (reunioes, gravacoes, visitas,
 * folgas), sem depender de calendario externo.
 *
 * Quem ve: admin ve tudo. Os demais veem os eventos da equipe toda
 * (sem setor), os do proprio setor, os que criaram e aqueles em que sao
 * participantes.
 * Quem edita/exclui: quem criou e o admin.
 */

const express = require('express');
const repo = require('../data');
const { exigirLogin } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { registrar } = require('../middleware/auditoria');
const { comIdValidado } = require('../middleware/params');
const push = require('../services/push');
const { criarEventoSchema, atualizarEventoSchema, filtroEventosSchema } = require('../schemas/evento.schema');

const router = express.Router();
comIdValidado(router);
router.use(exigirLogin);

function podeVer(usuario, e) {
  if (usuario.papel === 'admin') return true;
  if (e.setor_id == null || e.setor_id === usuario.setor_id) return true;
  if (e.criado_por === usuario.id) return true;
  return (e.participantes || []).some((p) => p.id === usuario.id);
}

function podeEditar(usuario, e) {
  return usuario.papel === 'admin' || e.criado_por === usuario.id;
}

// participante tem que ser alguem ativo da equipe
async function filtrarParticipantes(ids) {
  const equipe = new Set((await repo.listarEquipe()).map((u) => u.id));
  return Array.from(new Set(ids)).filter((id) => equipe.has(id));
}

async function setorValido(setorId) {
  if (setorId == null) return true;
  return (await repo.listarSetores()).some((s) => s.id === setorId);
}

function dataBR(iso) {
  const [a, m, d] = String(iso).split('-');
  return `${d}/${m}/${a}`;
}

// avisa no aparelho quem foi chamado (menos quem esta fazendo a acao)
function avisarParticipantes(evento, autorId, novos) {
  const alvo = (novos || []).filter((id) => id !== autorId);
  if (!alvo.length) return;
  push.enviarPara(alvo, {
    titulo: `Novo evento: ${evento.titulo}`,
    corpo: `${dataBR(evento.data)}${evento.hora_inicio ? ' às ' + evento.hora_inicio : ''}${evento.local ? ' · ' + evento.local : ''}`,
    url: `/calendario-equipe?data=${evento.data}`,
    tag: `evento-${evento.id}`,
  }).catch(() => {});
}

// GET /api/eventos?de=AAAA-MM-DD&ate=AAAA-MM-DD
router.get('/', validate(filtroEventosSchema, 'query'), async (req, res, next) => {
  try {
    const lista = await repo.listarEventos({ de: req.query.de, ate: req.query.ate });
    res.json({ eventos: lista.filter((e) => podeVer(req.usuario, e)) });
  } catch (e) { next(e); }
});

// GET /api/eventos/:id
router.get('/:id', async (req, res, next) => {
  try {
    const e = await repo.buscarEvento(Number(req.params.id));
    if (!e || !podeVer(req.usuario, e)) return res.status(404).json({ erro: 'Evento não encontrado' });
    res.json({ evento: e });
  } catch (e) { next(e); }
});

// POST /api/eventos
router.post('/', validate(criarEventoSchema), async (req, res, next) => {
  try {
    const d = req.body;
    // membro so marca evento para a equipe toda ou para o proprio setor
    if (req.usuario.papel !== 'admin' && d.setor_id != null && d.setor_id !== req.usuario.setor_id) {
      return res.status(403).json({ erro: 'Você só pode criar eventos do seu setor ou da equipe toda' });
    }
    if (!(await setorValido(d.setor_id))) return res.status(400).json({ erro: 'Setor inválido' });

    const participantes = await filtrarParticipantes(d.participantes);
    const ev = await repo.criarEvento({ ...d, participantes, criado_por: req.usuario.id });
    await registrar(req, {
      tipo: 'criada', entidade: 'evento', entidade_id: ev.id, titulo: ev.titulo,
      setor_id: ev.setor_id, detalhe: `marcou um evento para ${dataBR(ev.data)}`,
    });
    avisarParticipantes(ev, req.usuario.id, participantes);
    res.status(201).json({ evento: ev });
  } catch (e) { next(e); }
});

// PUT /api/eventos/:id
router.put('/:id', validate(atualizarEventoSchema), async (req, res, next) => {
  try {
    const atual = await repo.buscarEvento(Number(req.params.id));
    if (!atual || !podeVer(req.usuario, atual)) return res.status(404).json({ erro: 'Evento não encontrado' });
    if (!podeEditar(req.usuario, atual)) {
      return res.status(403).json({ erro: 'Só quem criou o evento (ou o admin) pode alterá-lo' });
    }
    const d = { ...req.body };
    if ('setor_id' in d) {
      if (req.usuario.papel !== 'admin' && d.setor_id != null && d.setor_id !== req.usuario.setor_id) {
        return res.status(403).json({ erro: 'Você só pode marcar eventos do seu setor ou da equipe toda' });
      }
      if (!(await setorValido(d.setor_id))) return res.status(400).json({ erro: 'Setor inválido' });
    }
    // a checagem de horario do schema so ve o que veio; aqui junta com o que ja existia
    const ini = 'hora_inicio' in d ? d.hora_inicio : atual.hora_inicio;
    const fim = 'hora_fim' in d ? d.hora_fim : atual.hora_fim;
    if (ini && fim && fim < ini) return res.status(400).json({ erro: 'O horário de término é antes do início' });

    let novos = [];
    if ('participantes' in d) {
      d.participantes = await filtrarParticipantes(d.participantes);
      const antes = new Set((atual.participantes || []).map((p) => p.id));
      novos = d.participantes.filter((id) => !antes.has(id));
    }
    const ev = await repo.atualizarEvento(atual.id, d);
    await registrar(req, {
      tipo: 'editada', entidade: 'evento', entidade_id: ev.id, titulo: ev.titulo,
      setor_id: ev.setor_id, detalhe: 'editou o evento',
    });
    avisarParticipantes(ev, req.usuario.id, novos);
    res.json({ evento: ev });
  } catch (e) { next(e); }
});

// DELETE /api/eventos/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const atual = await repo.buscarEvento(Number(req.params.id));
    if (!atual || !podeVer(req.usuario, atual)) return res.status(404).json({ erro: 'Evento não encontrado' });
    if (!podeEditar(req.usuario, atual)) {
      return res.status(403).json({ erro: 'Só quem criou o evento (ou o admin) pode excluí-lo' });
    }
    await repo.excluirEvento(atual.id);
    await registrar(req, {
      tipo: 'excluida', entidade: 'evento', entidade_id: atual.id, titulo: atual.titulo,
      setor_id: atual.setor_id, detalhe: 'excluiu o evento',
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
