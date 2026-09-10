'use strict';

/**
 * Resumo do dia.
 *
 * Números calculados no servidor, sobre o que a pessoa logada pode ver:
 * admin enxerga todos os setores, membro só o próprio. O ColodelBot também
 * usa isto como ferramenta, então o resumo que ele conta é o mesmo que a tela
 * mostraria, sem o modelo inventar contagem.
 */

const express = require('express');
const repo = require('../data');
const { exigirLogin } = require('../middleware/auth');

const router = express.Router();
router.use(exigirLogin);

const hojeIso = () => new Date().toISOString().slice(0, 10);
const soData = (v) => (v ? String(v).slice(0, 10) : null);

// Versão enxuta da tarefa: o resumo é uma lista de leitura, não a tela toda.
function resumir(t) {
  return {
    id: t.id,
    titulo: t.titulo,
    cliente: t.cliente_nome || null,
    setor: t.setor_nome || null,
    prioridade: t.prioridade,
    data_entrega: soData(t.data_entrega),
    responsaveis: (t.responsaveis || []).map((r) => r.nome),
  };
}

// GET /api/resumo-dia
router.get('/', async (req, res, next) => {
  try {
    const hoje = hojeIso();
    const tarefas = req.usuario.papel === 'admin'
      ? await repo.listarTodasTarefas()
      : await repo.listarTarefasPorSetor(req.usuario.setor_id);

    const abertas = tarefas.filter((t) => !t.concluida_em);

    const atrasadas = abertas.filter((t) => t.atrasada);
    const vencemHoje = abertas.filter((t) => soData(t.data_entrega) === hoje);
    const urgentes = abertas.filter((t) => t.prioridade === 'urgente');
    const semResponsavel = abertas.filter((t) => !(t.responsaveis || []).length);
    const concluidasHoje = tarefas.filter((t) => soData(t.concluida_em) === hoje);

    // quanto cada setor tem em aberto (o membro vê só o dele)
    const porSetor = {};
    abertas.forEach((t) => {
      const nome = t.setor_nome || ('Setor ' + t.setor_id);
      porSetor[nome] = (porSetor[nome] || 0) + 1;
    });

    res.json({
      data: hoje,
      escopo: req.usuario.papel === 'admin' ? 'todos os setores' : (req.usuario.setor_nome || 'seu setor'),
      totais: {
        abertas: abertas.length,
        atrasadas: atrasadas.length,
        vencem_hoje: vencemHoje.length,
        urgentes: urgentes.length,
        sem_responsavel: semResponsavel.length,
        concluidas_hoje: concluidasHoje.length,
      },
      por_setor: porSetor,
      // listas curtas: o suficiente para agir, sem virar um despejo de dados
      atrasadas: atrasadas.slice(0, 15).map(resumir),
      vencem_hoje: vencemHoje.slice(0, 15).map(resumir),
      urgentes: urgentes.slice(0, 10).map(resumir),
      concluidas_hoje: concluidasHoje.slice(0, 10).map(resumir),
    });
  } catch (e) { next(e); }
});

module.exports = router;
