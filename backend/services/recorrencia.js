'use strict';

/**
 * Tarefas recorrentes.
 *
 * Como funciona: a tarefa "cabeça" da série guarda a frequência
 * (diaria/semanal/quinzenal/mensal) e, opcionalmente, até quando repetir.
 * Quando ela é concluída (ou quando a data de entrega dela passa), o sistema
 * cria a próxima ocorrência e anota o id da nova em recorrencia_gerou_id.
 *
 * Esse campo é o que garante que cada ocorrência gere no máximo uma seguinte:
 * pode rodar a varredura dez vezes seguidas, reiniciar o servidor no meio ou
 * ter duas instâncias da API que a série não duplica.
 *
 * A nova ocorrência nasce na primeira coluna do setor, com os mesmos
 * responsáveis, cliente e prioridade, e com as datas deslocadas pelo mesmo
 * intervalo.
 */

const repo = require('../data');
const { criarNotificacao } = require('./notificacoes');

const FREQUENCIAS = {
  diaria: { dias: 1, rotulo: 'diária' },
  semanal: { dias: 7, rotulo: 'semanal' },
  quinzenal: { dias: 14, rotulo: 'quinzenal' },
  mensal: { meses: 1, rotulo: 'mensal' },
};

const RECORRENCIAS = Object.keys(FREQUENCIAS);

const hojeIso = () => new Date().toISOString().slice(0, 10);

// --- datas em 'AAAA-MM-DD', sem fuso: dia de calendário é dia de calendário ---
function partes(iso) {
  const [a, m, d] = String(iso).slice(0, 10).split('-').map(Number);
  return { ano: a, mes: m, dia: d };
}
function paraIso(ano, mes, dia) {
  const p = (n) => String(n).padStart(2, '0');
  return `${ano}-${p(mes)}-${p(dia)}`;
}
function somarDias(iso, dias) {
  const { ano, mes, dia } = partes(iso);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}
// Mês a mais mantendo o dia; se o mês seguinte não tem aquele dia (31 -> 30),
// cai para o último dia do mês.
function somarMeses(iso, meses) {
  const { ano, mes, dia } = partes(iso);
  const alvoMes = mes - 1 + meses;
  const alvoAno = ano + Math.floor(alvoMes / 12);
  const mesNorm = ((alvoMes % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(alvoAno, mesNorm + 1, 0)).getUTCDate();
  return paraIso(alvoAno, mesNorm + 1, Math.min(dia, ultimoDia));
}

function proximaData(iso, recorrencia) {
  const f = FREQUENCIAS[recorrencia];
  if (!f || !iso) return null;
  return f.meses ? somarMeses(iso, f.meses) : somarDias(iso, f.dias);
}

/**
 * Avança a data até ela ser hoje ou depois. Serve para a série que ficou
 * parada: uma tarefa semanal esquecida há dois meses gera UMA próxima
 * ocorrência nesta semana, não nove atrasadas de uma vez.
 */
function proximaDataUtil(iso, recorrencia, referencia = hojeIso()) {
  let proxima = proximaData(iso, recorrencia);
  let voltas = 0;
  while (proxima && proxima < referencia && voltas < 400) {
    proxima = proximaData(proxima, recorrencia);
    voltas += 1;
  }
  return proxima;
}

/**
 * Cria a próxima ocorrência de uma tarefa recorrente.
 * Devolve a tarefa criada, ou null quando não havia o que gerar (série
 * encerrada, já gerada, ou sem data de entrega para se apoiar).
 */
async function gerarProxima(tarefa, { motivo = 'recorrência' } = {}) {
  if (!tarefa || !tarefa.recorrencia || tarefa.recorrencia_gerou_id) return null;
  if (!FREQUENCIAS[tarefa.recorrencia]) return null;

  // a série se apoia na data de entrega; sem ela, usa hoje como referência
  const base = tarefa.data_entrega ? String(tarefa.data_entrega).slice(0, 10) : hojeIso();
  const novaEntrega = proximaDataUtil(base, tarefa.recorrencia);
  if (!novaEntrega) return null;

  // acabou o prazo da série: encerra sem gerar. -1 (e não 0) porque zero é
  // falso em JavaScript e a série voltaria a parecer pendente na varredura.
  if (tarefa.recorrencia_ate && novaEntrega > String(tarefa.recorrencia_ate).slice(0, 10)) {
    await repo.marcarRecorrenciaGerada(tarefa.id, -1);
    return null;
  }

  // desloca início e publicação pelo mesmo tanto de dias que a entrega andou
  const deslocamento = (novaData, dataAntiga) => {
    if (!dataAntiga) return null;
    const dias = Math.round(
      (Date.parse(novaEntrega + 'T00:00:00Z') - Date.parse(base + 'T00:00:00Z')) / 86400000,
    );
    return somarDias(String(dataAntiga).slice(0, 10), dias);
  };

  const colunas = await repo.listarColunas(tarefa.setor_id);
  if (!colunas.length) return null;

  // Reserva a serie no banco ANTES de criar: so uma chamada consegue (dois
  // cliques em "concluir", ou a conclusao junto com a varredura, geravam duas
  // proximas tarefas). Quem perde a reserva sai sem fazer nada.
  if (!(await repo.reservarRecorrencia(tarefa.id))) return null;

  let nova;
  try {
    nova = await repo.criarTarefa({
      titulo: tarefa.titulo,
      descricao: tarefa.descricao,
      setor_id: tarefa.setor_id,
      coluna_id: colunas[0].id, // sempre recomeça no início do fluxo
      cliente_id: tarefa.cliente_id,
      prioridade: tarefa.prioridade,
      data_inicio: deslocamento(novaEntrega, tarefa.data_inicio),
      data_entrega: novaEntrega,
      data_publicacao: deslocamento(novaEntrega, tarefa.data_publicacao),
      criado_por: tarefa.criado_por,
      responsaveis: (tarefa.responsaveis || []).map((r) => r.id),
      recorrencia: tarefa.recorrencia,
      recorrencia_ate: tarefa.recorrencia_ate,
      recorrencia_origem_id: tarefa.id,
    });
  } catch (e) {
    // nao conseguiu criar: libera a serie para a proxima tentativa
    await repo.marcarRecorrenciaGerada(tarefa.id, null).catch(() => {});
    throw e;
  }

  await repo.marcarRecorrenciaGerada(tarefa.id, nova.id);

  await criarNotificacao({
    tipo: 'nova_demanda',
    setor_id: nova.setor_id,
    tarefa_id: nova.id,
    titulo: `Tarefa recorrente · ${nova.setor_nome || ''}`.trim(),
    mensagem: `"${nova.titulo}" foi criada automaticamente (${FREQUENCIAS[tarefa.recorrencia].rotulo}) com entrega em ${novaEntrega}.`,
  });

  // quem gerou foi o sistema, e isso fica explícito na trilha de auditoria
  await repo.registrarHistorico({
    tipo: 'criada', entidade: 'tarefa', entidade_id: nova.id, tarefa_id: nova.id,
    titulo: nova.titulo, setor_id: nova.setor_id,
    usuario_id: null, usuario_nome: 'Sistema',
    cliente_id: nova.cliente_id, cliente_nome: nova.cliente_nome,
    responsaveis: nova.responsaveis || [],
    detalhe: `criou a tarefa por ${motivo} (${FREQUENCIAS[tarefa.recorrencia].rotulo}, a partir de #${tarefa.id})`,
    ip: 'servidor', user_agent: 'rotina de recorrência',
  });

  return nova;
}

/**
 * Varredura: gera o que estiver devendo.
 * Uma ocorrência é gerada quando a tarefa foi concluída ou quando a data de
 * entrega dela já passou (a série não trava porque alguém esqueceu de fechar
 * a tarefa da semana passada).
 */
async function sweepRecorrencias() {
  const hoje = hojeIso();
  let geradas = 0;
  try {
    const cabecas = await repo.listarTarefasRecorrentesPendentes();
    for (const tarefa of cabecas) {
      const venceu = tarefa.data_entrega && String(tarefa.data_entrega).slice(0, 10) < hoje;
      if (!tarefa.concluida_em && !venceu) continue;
      const nova = await gerarProxima(tarefa, {
        motivo: tarefa.concluida_em ? 'recorrência (após conclusão)' : 'recorrência (entrega vencida)',
      });
      if (nova) geradas += 1;
    }
  } catch (e) {
    console.error('[recorrencia] falha na varredura:', e.message);
  }
  return geradas;
}

// Roda no boot e de hora em hora. unref para não segurar o processo.
function iniciarRotina() {
  sweepRecorrencias().then((n) => {
    if (n) console.log(`[recorrencia] ${n} tarefa(s) recorrente(s) gerada(s) no boot`);
  });
  const timer = setInterval(sweepRecorrencias, 60 * 60 * 1000);
  if (timer.unref) timer.unref();
  return timer;
}

module.exports = {
  RECORRENCIAS, FREQUENCIAS, proximaData, proximaDataUtil,
  gerarProxima, sweepRecorrencias, iniciarRotina,
};
