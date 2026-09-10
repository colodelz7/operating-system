'use strict';

/**
 * Ferramentas do assistente (ColodelBot dentro do sistema).
 *
 * Ideia central: o assistente NAO tem um caminho proprio para o banco. Cada
 * ferramenta e uma chamada HTTP para a nossa propria API, com o cookie de
 * sessao de quem esta conversando. Ou seja, ele consegue exatamente o que
 * aquela pessoa conseguiria pela tela: as mesmas permissoes, a mesma
 * validacao zod, os mesmos limites e a mesma auditoria. Se a pessoa e membro
 * do Criativo, o assistente tambem e.
 *
 * A requisicao interna leva um token aleatorio gerado no boot
 * (config.tokenInterno), que so este processo conhece. Ele serve apenas para
 * a auditoria saber que a acao veio pelo assistente.
 */

const config = require('../../config');

// Porta em que a requisicao original chegou: assim a chamada interna acerta
// o alvo mesmo quando o servidor sobe noutra porta (teste, container).
function baseDe(req) {
  const porta = (req.socket && req.socket.localPort) || config.port;
  return `http://127.0.0.1:${porta}`;
}

// ------------------------------------------------------------
//  Declaracoes que vao para o modelo
// ------------------------------------------------------------
// Formato do Gemini: type/properties em maiusculas, no estilo OpenAPI.
const S = {
  texto: (d) => ({ type: 'STRING', description: d }),
  inteiro: (d) => ({ type: 'INTEGER', description: d }),
  bool: (d) => ({ type: 'BOOLEAN', description: d }),
  listaInteiros: (d) => ({ type: 'ARRAY', description: d, items: { type: 'INTEGER' } }),
};

const DATA = 'Data no formato AAAA-MM-DD.';

const FERRAMENTAS = [
  // ---------------- consultas ----------------
  {
    name: 'listar_setores',
    description: 'Lista os setores que a pessoa logada pode ver, com id, nome e slug. Use para descobrir o id de um setor citado pelo nome.',
    parameters: { type: 'OBJECT', properties: {} },
    http: () => ({ metodo: 'GET', caminho: '/api/setores' }),
  },
  {
    name: 'listar_colunas',
    description: 'Lista as colunas (etapas do kanban) de um setor, com id e nome. Use antes de mover um card ou para criar a tarefa direto numa coluna.',
    parameters: {
      type: 'OBJECT',
      properties: { setor_id: S.inteiro('Id do setor.') },
      required: ['setor_id'],
    },
    http: (a) => ({ metodo: 'GET', caminho: `/api/setores/${Number(a.setor_id)}/colunas` }),
  },
  {
    name: 'listar_pessoas_do_setor',
    description: 'Lista as pessoas de um setor (id, nome, usuario). Use para transformar nomes de responsaveis em ids.',
    parameters: {
      type: 'OBJECT',
      properties: { setor_id: S.inteiro('Id do setor.') },
      required: ['setor_id'],
    },
    http: (a) => ({ metodo: 'GET', caminho: `/api/setores/${Number(a.setor_id)}/usuarios` }),
  },
  {
    name: 'listar_clientes',
    description: 'Lista os clientes cadastrados, com id e empresa. Use para transformar o nome de um cliente no id certo.',
    parameters: { type: 'OBJECT', properties: {} },
    http: () => ({ metodo: 'GET', caminho: '/api/clientes' }),
  },
  {
    name: 'listar_tarefas',
    description: 'Lista as tarefas que a pessoa pode ver. Sem setor_id, traz tudo que ela alcanca.',
    parameters: {
      type: 'OBJECT',
      properties: { setor_id: S.inteiro('Opcional: limita a um setor.') },
    },
    http: (a) => ({
      metodo: 'GET',
      caminho: a.setor_id ? `/api/tarefas?setor=${Number(a.setor_id)}` : '/api/tarefas',
    }),
  },
  {
    name: 'resumo_do_dia',
    description: 'Resumo do dia calculado pelo servidor: quantas tarefas estao abertas, atrasadas, vencendo hoje, urgentes, sem responsavel e concluidas hoje, com as listas curtas de cada grupo. Use sempre que pedirem "resumo do dia", "o que esta atrasado" ou "o que vence hoje", em vez de contar na mao.',
    parameters: { type: 'OBJECT', properties: {} },
    http: () => ({ metodo: 'GET', caminho: '/api/resumo-dia' }),
  },
  {
    name: 'listar_comentarios',
    description: 'Lista os comentarios de uma tarefa, com autor e data.',
    parameters: {
      type: 'OBJECT',
      properties: { id: S.inteiro('Id da tarefa.') },
      required: ['id'],
    },
    http: (a) => ({ metodo: 'GET', caminho: `/api/tarefas/${Number(a.id)}/comentarios` }),
  },
  {
    name: 'buscar_tarefa',
    description: 'Traz uma tarefa especifica pelo id, com cliente, coluna, responsaveis e datas.',
    parameters: {
      type: 'OBJECT',
      properties: { id: S.inteiro('Id da tarefa.') },
      required: ['id'],
    },
    http: (a) => ({ metodo: 'GET', caminho: `/api/tarefas/${Number(a.id)}` }),
  },
  {
    name: 'listar_usuarios',
    description: 'Lista todos os usuarios do sistema com papel e setor. So funciona para quem e admin (Atendimento).',
    parameters: { type: 'OBJECT', properties: {} },
    http: () => ({ metodo: 'GET', caminho: '/api/usuarios' }),
  },
  {
    name: 'consultar_historico',
    description: 'Consulta a trilha de auditoria (acessos e alteracoes). So para admin. Filtros opcionais.',
    parameters: {
      type: 'OBJECT',
      properties: {
        entidade: S.texto('tarefa, cliente, usuario, setor ou sessao.'),
        tipo: S.texto('criada, editada, movida, concluida, excluida, login, login_falha, login_bloqueio ou logout.'),
        de: S.texto('Inicio do periodo. ' + DATA),
        ate: S.texto('Fim do periodo. ' + DATA),
        q: S.texto('Busca livre por titulo, pessoa, detalhe ou IP.'),
        limit: S.inteiro('Quantos registros no maximo (padrao 50 aqui).'),
      },
    },
    http: (a) => {
      const p = new URLSearchParams();
      ['entidade', 'tipo', 'de', 'ate', 'q'].forEach((k) => { if (a[k]) p.set(k, String(a[k])); });
      p.set('limit', String(Math.min(Number(a.limit) || 50, 200)));
      return { metodo: 'GET', caminho: `/api/historico?${p.toString()}` };
    },
  },

  // ---------------- tarefas ----------------
  {
    name: 'criar_tarefa',
    description: 'Cria uma demanda/tarefa num setor. Confirme com a pessoa os dados principais antes de criar se algo estiver ambiguo.',
    parameters: {
      type: 'OBJECT',
      properties: {
        setor_id: S.inteiro('Id do setor onde a tarefa vai nascer.'),
        titulo: S.texto('Titulo da demanda.'),
        descricao: S.texto('Descricao detalhada. Opcional.'),
        cliente_id: S.inteiro('Id do cliente. Opcional.'),
        prioridade: S.texto('baixa, normal, alta ou urgente. Padrao normal.'),
        coluna_id: S.inteiro('Coluna inicial. Opcional: sem isso entra na primeira do setor.'),
        data_inicio: S.texto('Opcional. ' + DATA),
        data_entrega: S.texto('Opcional. ' + DATA),
        data_publicacao: S.texto('Opcional. ' + DATA),
        responsaveis: S.listaInteiros('Ids das pessoas responsaveis. Opcional.'),
        recorrencia: S.texto('Repeticao: diaria, semanal, quinzenal ou mensal. Opcional; sem isso a tarefa nao repete.'),
        recorrencia_ate: S.texto('Ate quando repetir. Opcional. ' + DATA),
      },
      required: ['setor_id', 'titulo'],
    },
    http: (a) => ({ metodo: 'POST', caminho: '/api/tarefas', corpo: a }),
  },
  {
    name: 'editar_tarefa',
    description: 'Edita campos de uma tarefa. Envie apenas os campos que devem mudar.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: S.inteiro('Id da tarefa.'),
        titulo: S.texto('Novo titulo.'),
        descricao: S.texto('Nova descricao.'),
        cliente_id: S.inteiro('Novo cliente.'),
        prioridade: S.texto('baixa, normal, alta ou urgente.'),
        data_inicio: S.texto(DATA),
        data_entrega: S.texto(DATA),
        data_publicacao: S.texto(DATA),
        responsaveis: S.listaInteiros('Lista completa de responsaveis (substitui a atual).'),
        recorrencia: S.texto('Repeticao: diaria, semanal, quinzenal, mensal, ou vazio para parar de repetir.'),
        recorrencia_ate: S.texto('Ate quando repetir. ' + DATA),
      },
      required: ['id'],
    },
    http: (a) => {
      const { id, ...campos } = a;
      return { metodo: 'PUT', caminho: `/api/tarefas/${Number(id)}`, corpo: campos };
    },
  },
  {
    name: 'mover_tarefa',
    description: 'Move a tarefa para outra coluna do kanban. Descubra o id da coluna com listar_colunas.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: S.inteiro('Id da tarefa.'),
        coluna_id: S.inteiro('Id da coluna de destino.'),
      },
      required: ['id', 'coluna_id'],
    },
    http: (a) => ({ metodo: 'PATCH', caminho: `/api/tarefas/${Number(a.id)}/mover`, corpo: { coluna_id: a.coluna_id } }),
  },
  {
    name: 'comentar_tarefa',
    description: 'Escreve um comentario na tarefa. O comentario sai no nome da pessoa que esta conversando.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: S.inteiro('Id da tarefa.'),
        texto: S.texto('O comentario.'),
      },
      required: ['id', 'texto'],
    },
    http: (a) => ({ metodo: 'POST', caminho: `/api/tarefas/${Number(a.id)}/comentarios`, corpo: { texto: a.texto } }),
  },
  {
    name: 'duplicar_tarefa',
    description: 'Cria uma copia da tarefa, no inicio do fluxo do setor. Nao leva anexos nem comentarios.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: S.inteiro('Id da tarefa a copiar.'),
        titulo: S.texto('Titulo da copia. Opcional: sem isso vira "<titulo> (copia)".'),
      },
      required: ['id'],
    },
    http: (a) => ({
      metodo: 'POST',
      caminho: `/api/tarefas/${Number(a.id)}/duplicar`,
      corpo: a.titulo ? { titulo: a.titulo } : {},
    }),
  },
  {
    name: 'excluir_tarefa',
    description: 'Exclui uma tarefa em definitivo. Pergunte antes e so chame com confirmar=true depois que a pessoa confirmar.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: S.inteiro('Id da tarefa.'),
        confirmar: S.bool('true somente depois que a pessoa confirmar a exclusao.'),
      },
      required: ['id', 'confirmar'],
    },
    destrutiva: true,
    http: (a) => ({ metodo: 'DELETE', caminho: `/api/tarefas/${Number(a.id)}` }),
  },

  // ---------------- clientes ----------------
  {
    name: 'criar_cliente',
    description: 'Cadastra um cliente novo. Apenas empresa e obrigatorio.',
    parameters: {
      type: 'OBJECT',
      properties: {
        empresa: S.texto('Nome da empresa.'),
        razao_social: S.texto('Opcional.'),
        cnpj: S.texto('Opcional.'),
        nicho: S.texto('Opcional.'),
        tamanho: S.texto('Opcional.'),
        cidade: S.texto('Opcional.'),
        estado: S.texto('Opcional (UF).'),
        contato: S.texto('Opcional.'),
        telefone: S.texto('Opcional.'),
        email: S.texto('Opcional.'),
        site: S.texto('Opcional.'),
        instagram: S.texto('Opcional.'),
      },
      required: ['empresa'],
    },
    http: (a) => ({ metodo: 'POST', caminho: '/api/clientes', corpo: a }),
  },
  {
    name: 'editar_cliente',
    description: 'Edita a ficha de um cliente. Envie so os campos que mudam.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: S.inteiro('Id do cliente.'),
        empresa: S.texto(''), razao_social: S.texto(''), cnpj: S.texto(''),
        nicho: S.texto(''), tamanho: S.texto(''), cidade: S.texto(''), estado: S.texto(''),
        contato: S.texto(''), telefone: S.texto(''), email: S.texto(''),
        site: S.texto(''), instagram: S.texto(''),
      },
      required: ['id'],
    },
    http: (a) => {
      const { id, ...campos } = a;
      return { metodo: 'PUT', caminho: `/api/clientes/${Number(id)}`, corpo: campos };
    },
  },
  {
    name: 'excluir_cliente',
    description: 'Exclui um cliente (so admin). Pergunte antes e so chame com confirmar=true apos a confirmacao.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: S.inteiro('Id do cliente.'),
        confirmar: S.bool('true somente depois que a pessoa confirmar.'),
      },
      required: ['id', 'confirmar'],
    },
    destrutiva: true,
    http: (a) => ({ metodo: 'DELETE', caminho: `/api/clientes/${Number(a.id)}` }),
  },

  // ---------------- usuarios (admin) ----------------
  {
    name: 'criar_usuario',
    description: 'Cria um usuario do sistema (so admin). A senha precisa ter ao menos 6 caracteres e deve ser dita pela pessoa, nunca inventada em segredo.',
    parameters: {
      type: 'OBJECT',
      properties: {
        nome: S.texto('Nome completo.'),
        usuario: S.texto('Login (minusculas, sem espaco).'),
        senha: S.texto('Senha inicial, minimo 6 caracteres.'),
        setor_id: S.inteiro('Id do setor.'),
        papel: S.texto('admin ou membro.'),
        colunas_visiveis: S.listaInteiros('Opcional, so no Criativo: ids das colunas que a pessoa enxerga.'),
      },
      required: ['nome', 'usuario', 'senha', 'setor_id', 'papel'],
    },
    http: (a) => ({ metodo: 'POST', caminho: '/api/usuarios', corpo: a }),
  },
  {
    name: 'editar_usuario',
    description: 'Edita um usuario (so admin): nome, login, setor, papel, senha ou colunas visiveis.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: S.inteiro('Id do usuario.'),
        nome: S.texto(''), usuario: S.texto(''), senha: S.texto('Nova senha, minimo 6 caracteres.'),
        setor_id: S.inteiro(''), papel: S.texto('admin ou membro.'),
        colunas_visiveis: S.listaInteiros(''),
      },
      required: ['id'],
    },
    http: (a) => {
      const { id, ...campos } = a;
      return { metodo: 'PUT', caminho: `/api/usuarios/${Number(id)}`, corpo: campos };
    },
  },
  {
    name: 'excluir_usuario',
    description: 'Exclui um usuario (so admin). Pergunte antes e so chame com confirmar=true apos a confirmacao.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: S.inteiro('Id do usuario.'),
        confirmar: S.bool('true somente depois que a pessoa confirmar.'),
      },
      required: ['id', 'confirmar'],
    },
    destrutiva: true,
    http: (a) => ({ metodo: 'DELETE', caminho: `/api/usuarios/${Number(a.id)}` }),
  },
];

const PORNOME = new Map(FERRAMENTAS.map((f) => [f.name, f]));

// O que vai no campo "tools" da chamada ao Gemini (sem os campos internos).
function declaracoes() {
  return [{
    functionDeclarations: FERRAMENTAS.map((f) => ({
      name: f.name,
      description: f.description,
      parameters: f.parameters,
    })),
  }];
}

// Limpa argumentos que o modelo mandou vazios (evita apagar campo sem querer).
function limparArgs(args) {
  const limpo = {};
  Object.entries(args || {}).forEach(([k, v]) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string' && v.trim() === '') return;
    limpo[k] = v;
  });
  return limpo;
}

/**
 * Executa uma ferramenta chamando a propria API com a sessao de quem
 * conversa. Devolve sempre um objeto serializavel para o modelo ler.
 */
async function executar(nome, args, req) {
  const ferramenta = PORNOME.get(nome);
  if (!ferramenta) return { erro: `Ferramenta desconhecida: ${nome}` };

  const limpos = limparArgs(args);

  // Confere o que o modelo mandou ANTES de virar URL. Sem isto, um id que
  // veio vazio virava "NaN" no caminho e explodia la no banco.
  const faltando = (ferramenta.parameters.required || []).filter((campo) => !(campo in limpos));
  if (faltando.length) {
    return { ok: false, erro: `Faltou informar: ${faltando.join(', ')}. Pergunte à pessoa ou descubra com uma consulta.` };
  }
  const props = ferramenta.parameters.properties || {};
  const invalidos = Object.keys(limpos).filter((campo) => {
    if (!props[campo] || props[campo].type !== 'INTEGER') return false;
    return !Number.isFinite(Number(limpos[campo]));
  });
  if (invalidos.length) {
    return { ok: false, erro: `Valor inválido em: ${invalidos.join(', ')}. Esses campos precisam de um número (id).` };
  }

  // Acao destrutiva so roda com confirmacao explicita da pessoa.
  if (ferramenta.destrutiva && limpos.confirmar !== true) {
    return {
      erro: 'Exclusão não confirmada. Pergunte à pessoa se ela confirma e chame de novo com confirmar=true.',
    };
  }
  delete limpos.confirmar;

  const { metodo, caminho, corpo } = ferramenta.http(limpos);

  const headers = {
    // repassa a sessao de quem esta conversando: as permissoes sao dela
    Cookie: req.headers.cookie || '',
    'User-Agent': req.get('user-agent') || 'ColodelBot',
    // preserva o IP real na auditoria (a API confia no proxy quando TRUST_PROXY)
    'X-Forwarded-For': req.ip,
    // marca a chamada como interna do assistente (token so deste processo)
    'X-Assistente-Interno': config.tokenInterno,
  };
  if (corpo !== undefined) headers['Content-Type'] = 'application/json';

  try {
    const resp = await fetch(baseDe(req) + caminho, {
      method: metodo,
      headers,
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    });
    let dados = null;
    try { dados = await resp.json(); } catch (_) { dados = null; }

    if (!resp.ok) {
      return { ok: false, status: resp.status, erro: (dados && dados.erro) || 'A API recusou a operação.' };
    }
    return { ok: true, status: resp.status, ...(dados || {}) };
  } catch (e) {
    return { ok: false, erro: 'Falha ao falar com a API: ' + e.message };
  }
}

// Ferramentas que mudam dados: o front usa isso para recarregar as telas.
const ESCRITAS = new Set(FERRAMENTAS
  .filter((f) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(f.http({ id: 1, setor_id: 1 }).metodo))
  .map((f) => f.name));

module.exports = { FERRAMENTAS, declaracoes, executar, ESCRITAS };
