/* ============================================================
   Cliente HTTP do front. O front so pede e desenha; toda regra
   de negocio fica no servidor. Mesma semantica do antigo API:
   lanca Error(mensagem) com .status quando a resposta nao e ok.
   ============================================================ */

async function req(metodo, url, corpo, ehFormData = false) {
  const opts = { method: metodo, headers: {}, credentials: 'same-origin' };
  if (corpo !== undefined && corpo !== null) {
    if (ehFormData) {
      opts.body = corpo; // FormData: o browser define o Content-Type
    } else {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(corpo);
    }
  }
  const resp = await fetch(url, opts);
  let dados = null;
  try { dados = await resp.json(); } catch (_) { /* respostas sem corpo */ }
  if (!resp.ok) {
    const msg = (dados && dados.erro) || 'Ocorreu um erro';
    const err = new Error(msg);
    err.status = resp.status;
    throw err;
  }
  return dados;
}

export const API = {
  req,
  get: (url) => req('GET', url),
  post: (url, corpo, fd) => req('POST', url, corpo, fd),
  put: (url, corpo, fd) => req('PUT', url, corpo, fd),
  patch: (url, corpo) => req('PATCH', url, corpo),
  del: (url) => req('DELETE', url),
};

export default API;
