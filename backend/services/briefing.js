'use strict';

/**
 * Perguntas do briefing de entrada do cliente.
 *
 * A lista vive SO aqui: a tela pede em GET /api/briefings/campos, e a rota
 * guarda apenas as chaves que existem nesta lista. Pergunta nova: basta
 * acrescentar abaixo, o banco guarda as respostas em JSON.
 *
 * alto = campo de texto longo (ocupa a linha inteira na tela).
 */

const CAMPOS = [
  {
    titulo: 'Empresa',
    itens: [
      { k: 'nome_fantasia', r: 'Nome fantasia' },
      { k: 'razao_social', r: 'Razão social' },
      { k: 'cnpj', r: 'CNPJ' },
      { k: 'publico', r: 'Público-alvo', dica: 'B2B, B2C ou os dois.' },
      { k: 'servicos', r: 'Principais serviços ou produtos', dica: 'Em ordem de prioridade: o que mais dá dinheiro primeiro.', alto: true },
      { k: 'diferenciais', r: 'Diferenciais reais', dica: 'Tempo de mercado, certificações, garantias, números.', alto: true },
      { k: 'cliente_ideal', r: 'Perfil do cliente ideal', dica: 'Quem compra, o que resolve para ele, quanto costuma gastar.', alto: true },
      { k: 'concorrentes', r: 'Concorrentes', alto: true },
      { k: 'referencias', r: 'Sites que ele gosta, e por quê', alto: true },
    ],
  },
  {
    titulo: 'Local e atendimento',
    itens: [
      { k: 'endereco', r: 'Endereço completo' },
      { k: 'atendimento_local', r: 'Como atende', dica: 'Loja, escritório, só em domicílio, só online.' },
      { k: 'horario', r: 'Horário de funcionamento' },
      { k: 'whatsapp', r: 'WhatsApp' },
      { k: 'telefone', r: 'Telefone' },
      { k: 'email_contato', r: 'E-mail de contato' },
      { k: 'regioes', r: 'Cidades e bairros atendidos', dica: 'Em ordem de importância.', alto: true },
      { k: 'redes', r: 'Redes sociais', dica: 'Links do Instagram, Facebook, LinkedIn, YouTube, TikTok.', alto: true },
    ],
  },
  {
    titulo: 'Marca e conteúdo',
    itens: [
      { k: 'cores', r: 'Cores' },
      { k: 'manual_marca', r: 'Manual de marca', dica: 'Tem? Onde está?', alto: true },
      { k: 'logo', r: 'Logo', dica: 'Vetor (SVG, AI ou PDF) ou PNG em alta. Onde está o arquivo.', alto: true },
      { k: 'fotos', r: 'Fotos reais', dica: 'Equipe, fachada, obras ou produtos. Precisa de ensaio?', alto: true },
      { k: 'cases', r: 'Clientes, cases e logos que pode mostrar', alto: true },
    ],
  },
  {
    titulo: 'Site e objetivos',
    itens: [
      { k: 'objetivo', r: 'Objetivo principal', dica: 'Lead no WhatsApp, formulário, orçamento, venda, catálogo.', alto: true },
      { k: 'paginas', r: 'Páginas que ele imagina', dica: 'Home, sobre, serviços, contato, blog.', alto: true },
      { k: 'nao_quer', r: 'O que não quer', dica: 'Estilos, cores, seções ou referências que ele rejeita.', alto: true },
    ],
  },
  {
    titulo: 'Acessos técnicos',
    itens: [
      { k: 'dominio', r: 'Domínio', dica: 'Onde está registrado e quem tem o acesso. Senha vai no Cofre de acessos, nunca aqui.' },
      { k: 'hospedagem', r: 'Hospedagem', dica: 'Tem? Qual?' },
      { k: 'site_atual', r: 'Site atual', dica: 'Plataforma e endereço, para não perder URL indexada.', alto: true },
      { k: 'email_corporativo', r: 'E-mail corporativo', dica: 'Onde roda (Google, Microsoft, hospedagem).', alto: true },
    ],
  },
];

const CHAVES = CAMPOS.flatMap((b) => b.itens.map((i) => i.k));
const TAMANHO_MAX = 5000;

// Guarda so as chaves conhecidas, em texto e com tamanho limitado.
function limparRespostas(bruto) {
  const fonte = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
  const limpo = {};
  CHAVES.forEach((k) => {
    if (fonte[k] === undefined || fonte[k] === null) return;
    const v = String(fonte[k]).trim().slice(0, TAMANHO_MAX);
    if (v) limpo[k] = v;
  });
  return limpo;
}

function contarPreenchidos(respostas) {
  return CHAVES.filter((k) => String((respostas || {})[k] || '').trim()).length;
}

module.exports = { CAMPOS, CHAVES, limparRespostas, contarPreenchidos };
