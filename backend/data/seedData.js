'use strict';

/**
 * Fonte da verdade dos dados iniciais (memoria/local e espelho do seed.sql).
 * Senha padrao de TODOS os usuarios de exemplo: colodel
 * (troque as senhas pela tela de Usuarios assim que subir o sistema)
 */

const SENHA_PADRAO = 'colodel';

// util de data (YYYY-MM-DD)
function hojeMais(dias) {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// ------------------------------------------------------------
// SETORES
// ------------------------------------------------------------
const setores = [
  { id: 1, slug: 'atendimento',   nome: 'Atendimento',   ordem: 1, cor: '#120a8f' },
  { id: 2, slug: 'comercial',     nome: 'Comercial',     ordem: 2, cor: '#009fe3' },
  { id: 3, slug: 'criativo',      nome: 'Criativo',      ordem: 3, cor: '#6a5cff' },
  { id: 4, slug: 'trafego',       nome: 'Tráfego Pago',  ordem: 4, cor: '#00b2a9' },
  { id: 5, slug: 'desenvolvimento', nome: 'Desenvolvimento', ordem: 5, cor: '#3b2fb0' },
];

// ------------------------------------------------------------
// COLUNAS POR SETOR
// "Atrasado" NAO e coluna: e marcador automatico por data.
// Criativo tem o fluxo completo; "Finalizados" e a coluna de conclusao.
// ------------------------------------------------------------
const fluxoPadrao = ['Pendente', 'Em andamento', 'Concluído'];

const colunasPorSetor = {
  atendimento: ['Pendente', 'Em andamento', 'Concluído'],
  comercial:   ['Pendente', 'Em andamento', 'Concluído'],
  criativo: [
    'Pendente', 'Até 2 dias', 'Pra hoje', 'Fazer PDF', 'Aprovação', 'Programar',
    'Finalizados', 'Referências', 'Planejamento', 'Roteiros',
    'Retrabalho Design', 'Retrabalho Edição', 'Retrabalho PDF',
  ],
  trafego:     fluxoPadrao,
  desenvolvimento: fluxoPadrao,
};

// coluna de conclusao por setor (por nome). Default = ultima do setor.
const conclusaoPorSetor = {
  atendimento: 'Concluído',
  comercial: 'Concluído',
  criativo: 'Finalizados',
  trafego: 'Concluído',
  desenvolvimento: 'Concluído',
};

// Monta a lista achatada de colunas com ids sequenciais
const colunas = [];
let colId = 1;
setores.forEach((s) => {
  (colunasPorSetor[s.slug] || fluxoPadrao).forEach((nome, i) => {
    colunas.push({ id: colId++, setor_id: s.id, nome, ordem: i + 1, e_conclusao: false });
  });
});
// marca a coluna de conclusao de cada setor
setores.forEach((s) => {
  const doSetor = colunas.filter((c) => c.setor_id === s.id);
  const alvo = conclusaoPorSetor[s.slug];
  const col = doSetor.find((c) => c.nome === alvo) || doSetor[doSetor.length - 1];
  if (col) col.e_conclusao = true;
});

// ------------------------------------------------------------
// VISIBILIDADE DE COLUNAS POR USUARIO (apenas Criativo restringe)
// null / ausente = ve todas as colunas do seu setor. Admin ve tudo.
// ------------------------------------------------------------
// Exemplo de fluxo focado (Design/PDF) para quem so acompanha parte do
// Criativo. Preencha por login quando quiser restringir alguem no seed;
// pela tela de Usuarios isso e editavel a qualquer momento.
const colsPdfDesign = [
  'Pendente', 'Até 2 dias', 'Pra hoje', 'Fazer PDF', 'Aprovação',
  'Programar', 'Finalizados', 'Retrabalho Design',
];
const colunasVisiveisPorUsuario = {
  // 'login': colsPdfDesign,   // null/ausente = ve todas as colunas do setor
};

// ------------------------------------------------------------
// USUARIOS (login = "usuario", minusculas). papel: 'admin' | 'membro'
// Dados 100% genericos/fictícios - substitua pelos usuarios reais.
// ------------------------------------------------------------
const usuarios = [
  // Atendimento = papel 'admin' (ve todos os setores e gerencia o sistema)
  { id: 1, nome: 'Administrador', usuario: 'admin',   setor_id: 1, papel: 'admin' },
  { id: 2, nome: 'Colodel',       usuario: 'colodel', setor_id: 1, papel: 'admin' },
  // Membro: enxerga apenas o proprio setor
  { id: 3, nome: 'Morning',       usuario: 'morning', setor_id: 3, papel: 'membro' },
];

// ------------------------------------------------------------
// CLIENTES (exemplos fictícios - apenas para demonstração)
// ------------------------------------------------------------
const clientes = [
  {
    id: 1, empresa: 'Cliente Exemplo A', razao_social: 'Cliente Exemplo A LTDA', cnpj: '00.000.000/0001-00',
    nicho: 'Moda', tamanho: 'Pequena', logo_path: null,
    cep: '00000-000', endereco: 'Rua Exemplo, 100', complemento: 'Sala 3',
    cidade: 'Curitiba', estado: 'PR',
    contato: 'Contato Exemplo', telefone: '(41) 00000-0000', email: 'contato@clienteexemploa.com.br',
    site: 'clienteexemploa.com.br', instagram: '@clienteexemploa',
  },
  {
    id: 2, empresa: 'Cliente Exemplo B', razao_social: 'Cliente Exemplo B LTDA', cnpj: '00.000.000/0002-00',
    nicho: 'Telecomunicações', tamanho: 'Média', logo_path: null,
    cep: '00000-000', endereco: 'Av. Exemplo, 2500', complemento: '',
    cidade: 'Curitiba', estado: 'PR',
    contato: 'Contato Exemplo', telefone: '(41) 00000-0001', email: 'contato@clienteexplob.com.br',
    site: 'clienteexemplob.com.br', instagram: '@clienteexemplob',
  },
];

// ------------------------------------------------------------
// TAREFAS (exemplos) - referenciam colunas pelo NOME dentro do setor
// ------------------------------------------------------------
function colDe(setorSlug, nomeColuna) {
  const s = setores.find((x) => x.slug === setorSlug);
  const c = colunas.find((x) => x.setor_id === s.id && x.nome === nomeColuna);
  return c ? c.id : null;
}

const tarefas = [
  {
    id: 1, titulo: 'Cliente Exemplo A: 2 estáticos',
    descricao: 'Desenvolver 2 posts estáticos seguindo o planejamento enviado.',
    setor_id: 3, coluna_id: colDe('criativo', 'Pendente'),
    cliente_id: 1, prioridade: 'normal',
    data_inicio: null, data_entrega: hojeMais(2), data_publicacao: null,
    criado_por: 1, responsaveis: [3], concluida_em: null,
  },
  {
    id: 2, titulo: 'Cliente Exemplo B: Página institucional',
    descricao: 'Desenvolvimento da nova página com SEO on-page.',
    setor_id: 5, coluna_id: colDe('desenvolvimento', 'Em andamento'),
    cliente_id: 2, prioridade: 'alta',
    data_inicio: hojeMais(-3), data_entrega: hojeMais(1), data_publicacao: hojeMais(4),
    criado_por: 1, responsaveis: [2], concluida_em: null,
  },
  {
    id: 3, titulo: 'Cliente Exemplo A: Campanha de tráfego',
    descricao: 'Subir campanha de conversão para a coleção de inverno.',
    setor_id: 4, coluna_id: colDe('trafego', 'Pendente'),
    cliente_id: 1, prioridade: 'normal',
    data_inicio: null, data_entrega: hojeMais(-1), data_publicacao: null,
    criado_por: 1, responsaveis: [2], concluida_em: null,
  },
];

module.exports = {
  SENHA_PADRAO,
  setores,
  colunas,
  colunasPorSetor,
  conclusaoPorSetor,
  colunasVisiveisPorUsuario,
  fluxoPadrao,
  usuarios,
  clientes,
  tarefas,
};