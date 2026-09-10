/* ============================================================
   Cliente HTTP do front. O front so pede e desenha; toda regra
   de negocio fica no servidor. Lanca Error(mensagem) com .status
   (e .dados, quando a API devolve detalhes) se a resposta nao e ok.
   ============================================================ */

// Mensagem amigavel quando a resposta de erro NAO e um JSON do app (ex.: o
// proxy devolveu HTML: 502/503/504 durante um restart, 403 do WAF, 429 sem
// corpo).
function mensagemErro(status) {
  if (status === 502 || status === 503 || status === 504) {
    return 'Servidor reiniciando. Tente de novo em instantes.';
  }
  if (status === 429) return 'Muitas requisições. Aguarde um instante e tente de novo.';
  if (status === 401) return 'Sua sessão expirou. Entre novamente.';
  if (status === 413) return 'Arquivo grande demais para enviar.';
  return 'Não foi possível completar agora. Tente de novo.';
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(metodo, url, corpo, ehFormData = false) {
  // Alguns WAFs de hospedagem bloqueiam PUT/PATCH/DELETE com 403 antes de a
  // requisicao chegar no Node. Mandamos essas escritas como POST com o metodo
  // verdadeiro no cabecalho; o backend restaura o metodo (middleware
  // methodOverride) antes de casar as rotas.
  let metodoHttp = metodo;
  const headers = {};
  if (metodo === 'PUT' || metodo === 'PATCH' || metodo === 'DELETE') {
    headers['X-HTTP-Method-Override'] = metodo;
    metodoHttp = 'POST';
  }

  const opts = { method: metodoHttp, headers, credentials: 'same-origin' };
  if (corpo !== undefined && corpo !== null) {
    if (ehFormData) {
      opts.body = corpo; // FormData: o browser define o Content-Type
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(corpo);
    }
  }

  // GET e idempotente: se cair a rede ou o proxy responder 502/503/504 (tipico
  // de um restart curto do app), tenta mais uma vez antes de mostrar erro.
  const podeRetentar = metodo === 'GET';
  let resp;
  for (let tentativa = 0; ; tentativa++) {
    try {
      resp = await fetch(url, opts);
    } catch (_) {
      if (podeRetentar && tentativa < 1) { await espera(700); continue; }
      const err = new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.');
      err.status = 0;
      throw err;
    }
    if (podeRetentar && tentativa < 1 && [502, 503, 504].includes(resp.status)) {
      await espera(700); continue;
    }
    break;
  }

  let dados = null;
  try { dados = await resp.json(); } catch (_) { /* respostas sem corpo ou HTML do proxy */ }
  if (!resp.ok) {
    const err = new Error((dados && dados.erro) || mensagemErro(resp.status));
    err.status = resp.status;
    err.dados = dados; // ex.: segundos_restantes no bloqueio de login
    throw err;
  }
  return dados;
}

/**
 * POST que recebe a resposta em pedaços (Server-Sent Events sobre POST).
 * Usado pelo ColodelBot: o texto aparece enquanto o modelo escreve.
 *
 * aoEvento(tipo, dados) é chamado para cada evento do servidor. Devolve o
 * último evento "fim". Se o streaming não estiver disponível (proxy que
 * segura o fluxo, navegador antigo), quem chama decide o que fazer com o
 * erro, no chat, cai para a rota normal.
 */
async function stream(url, corpo, aoEvento, sinal) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(corpo),
    credentials: 'same-origin',
    signal: sinal,
  });

  if (!resp.ok || !resp.body) {
    let dados = null;
    try { dados = await resp.json(); } catch (_) { /* sem corpo */ }
    const err = new Error((dados && dados.erro) || mensagemErro(resp.status));
    err.status = resp.status;
    throw err;
  }

  const leitor = resp.body.getReader();
  const decodificador = new TextDecoder();
  let sobra = '';
  let fim = null;

  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    sobra += decodificador.decode(value, { stream: true }).replace(/\r\n/g, '\n');

    let corte = sobra.indexOf('\n\n');
    while (corte !== -1) {
      const bloco = sobra.slice(0, corte);
      sobra = sobra.slice(corte + 2);
      corte = sobra.indexOf('\n\n');

      const tipo = (bloco.match(/^event: (.+)$/m) || [])[1];
      const cru = (bloco.match(/^data: (.+)$/m) || [])[1];
      if (!tipo || !cru) continue;
      let dados = {};
      try { dados = JSON.parse(cru); } catch (_) { continue; }
      if (tipo === 'fim') fim = dados;
      aoEvento(tipo, dados);
    }
  }
  return fim;
}

export const API = {
  req,
  stream,
  get: (url) => req('GET', url),
  post: (url, corpo, fd) => req('POST', url, corpo, fd),
  put: (url, corpo, fd) => req('PUT', url, corpo, fd),
  patch: (url, corpo) => req('PATCH', url, corpo),
  del: (url) => req('DELETE', url),
};

export default API;
