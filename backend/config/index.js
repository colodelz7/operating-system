'use strict';

// Carrega variaveis do .env (se existir). Nao quebra se nao existir.
try { require('dotenv').config(); } catch (_) { /* dotenv opcional em dev */ }

// ------------------------------------------------------------
//  SEGREDO DA SESSAO
// ------------------------------------------------------------
// Sem valor padrao de proposito: um default no codigo significa que
// qualquer pessoa com acesso ao repositorio consegue assinar um cookie
// de sessao valido. Se a variavel faltar (ou vier fraca/placeholder), o
// processo para aqui com uma mensagem explicando como gerar uma boa.
const SEGREDO_MINIMO = 32;
const SEGREDOS_PROIBIDOS = new Set([
  'dev-secret-colodel-trocar',
  'troque-este-segredo-por-uma-string-longa-e-aleatoria',
  'changeme', 'secret', 'session-secret', 'keyboard cat',
]);

function lerSessionSecret() {
  const bruto = String(process.env.SESSION_SECRET || '').trim();
  const comoGerar = 'Gere uma com:  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"';

  if (!bruto) {
    throw new Error(`SESSION_SECRET nao definida. Defina no .env antes de subir o servidor. ${comoGerar}`);
  }
  if (SEGREDOS_PROIBIDOS.has(bruto.toLowerCase())) {
    throw new Error(`SESSION_SECRET esta com um valor de exemplo conhecido. Troque por um segredo unico. ${comoGerar}`);
  }
  if (bruto.length < SEGREDO_MINIMO) {
    throw new Error(`SESSION_SECRET curta demais (${bruto.length} caracteres, minimo ${SEGREDO_MINIMO}). ${comoGerar}`);
  }
  if (new Set(bruto).size < 8) {
    throw new Error(`SESSION_SECRET pouco aleatoria (poucos caracteres distintos). ${comoGerar}`);
  }
  return bruto;
}

/**
 * Le TRUST_PROXY no formato que o express entende, sem nunca cair no
 * "confia em todo mundo". O valor antigo "true" vira as faixas privadas, que
 * e onde vive o proxy reverso em qualquer instalacao normal (nginx ao lado,
 * container na mesma rede, balanceador interno).
 */
function lerTrustProxy() {
  const bruto = String(process.env.TRUST_PROXY || '').trim();
  if (!bruto || bruto.toLowerCase() === 'false') return false;
  if (bruto.toLowerCase() === 'true') return ['loopback', 'linklocal', 'uniquelocal'];
  if (/^\d+$/.test(bruto)) return parseInt(bruto, 10);
  return bruto.split(',').map((s) => s.trim()).filter(Boolean);
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3001,

  // Escuta so no loopback por padrao. Para expor na rede e preciso dizer
  // explicitamente (HOST=0.0.0.0), nunca por acidente.
  host: (process.env.HOST || '127.0.0.1').trim(),

  sessionSecret: lerSessionSecret(),
  // Nome generico: nao entrega marca/cliente para quem olha o trafego.
  cookieName: (process.env.COOKIE_NAME || 'operacional.sid').trim(),

  databaseUrl: (process.env.DATABASE_URL || '').trim(),
  cookieSecure: String(process.env.COOKIE_SECURE).toLowerCase() === 'true',

  // Confie no proxy reverso (necessario p/ cookie secure e IP real do
  // rate-limit quando o Node roda atras de nginx/host).
  //
  // Aceita, do mais seguro para o mais frouxo:
  //   vazio ou "false"  -> nao confia em ninguem (o IP e sempre o do socket)
  //   "10.0.0.0/8, ..." -> confia so nesses enderecos ou faixas
  //   "loopback"        -> presets do express (loopback, linklocal, uniquelocal)
  //   "2"               -> confia nos 2 ultimos saltos
  //   "true"            -> atalho para as faixas privadas (rede do proxy)
  //
  // Por que isso importa: com "trust proxy" aberto demais, qualquer cliente
  // manda X-Forwarded-For inventado e o rate limit passa a contar o IP que o
  // atacante escolheu. Ou seja, limite por IP deixa de existir.
  trustProxy: lerTrustProxy(),

  // Rate limit do /api/auth/login (mitiga forca bruta)
  loginRateWindowMs: parseInt(process.env.LOGIN_RATE_WINDOW_MS, 10) || (15 * 60 * 1000), // 15 min
  loginRateMax: parseInt(process.env.LOGIN_RATE_MAX, 10) || 10,                           // 10 tentativas/janela

  // Bloqueio temporario de login: N falhas seguidas travam por X ms,
  // contando por IP e por conta (o que estourar primeiro).
  loginBloqueioTentativas: parseInt(process.env.LOGIN_BLOQUEIO_TENTATIVAS, 10) || 3,
  loginBloqueioMs: parseInt(process.env.LOGIN_BLOQUEIO_MS, 10) || (5 * 60 * 1000),

  // ------------------------------------------------------------
  //  ASSISTENTE (ColodelBot dentro do sistema)
  // ------------------------------------------------------------
  // A chave fica so no servidor. Sem ela o assistente responde com um
  // aviso claro, em vez de quebrar.
  geminiApiKey: (process.env.GEMINI_API_KEY || '').trim(),
  // Escolhido por medicao: com as 18 ferramentas declaradas, o gemini-2.5-flash
  // passava de 40s e estourava o tempo, enquanto este responde em ~1,4s.
  geminiModel: (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim(),
  // Reserva: se o principal estiver sobrecarregado (503) ou lento, a conversa
  // tenta uma vez neste antes de desistir.
  geminiModeloReserva: (process.env.GEMINI_MODEL_RESERVA || 'gemini-3.5-flash-lite').trim(),
  // Orcamento de "raciocinio". Vazio = nao enviar (alguns modelos recusam o
  // campo). Defina um numero so se quiser controlar isso na mao.
  geminiThinkingBudget: process.env.GEMINI_THINKING_BUDGET
    ? parseInt(process.env.GEMINI_THINKING_BUDGET, 10)
    : null,
  // Quantas rodadas de ferramenta o modelo pode encadear numa resposta.
  assistenteMaxPassos: parseInt(process.env.ASSISTENTE_MAX_PASSOS, 10) || 8,
  // Teto de mensagens do assistente por usuario por minuto.
  assistenteMaxPorMinuto: parseInt(process.env.ASSISTENTE_MAX_POR_MINUTO, 10) || 15,

  // Token aleatorio por processo: marca as chamadas que o proprio servidor
  // faz a si mesmo quando o assistente executa uma acao. Nao vem de fora e
  // nao pode ser forjado por um cliente.
  tokenInterno: require('crypto').randomBytes(24).toString('hex'),

  // ------------------------------------------------------------
  //  NOTIFICACOES PUSH (celular/computador, mesmo com a aba fechada)
  // ------------------------------------------------------------
  // Par de chaves VAPID. Sem elas o push fica desligado e o resto do sistema
  // segue normal. Gere com:  npx web-push generate-vapid-keys
  vapidPublica: (process.env.VAPID_PUBLIC_KEY || '').trim(),
  vapidPrivada: (process.env.VAPID_PRIVATE_KEY || '').trim(),
  // contato do responsavel pelo servidor (exigido pelos servicos de push)
  vapidContato: (process.env.VAPID_SUBJECT || 'mailto:admin@localhost').trim(),

  // ------------------------------------------------------------
  //  COFRE DE ACESSOS
  // ------------------------------------------------------------
  // Chave de 32 bytes (base64) que cifra as senhas guardadas. Sem ela o cofre
  // fica desligado. Trocar a chave torna ilegiveis as senhas ja guardadas.
  // Gere com:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  cofreChave: (process.env.COFRE_CHAVE || '').trim(),

  // Limite de upload: 25MB (conforme combinado)
  uploadMaxBytes: 25 * 1024 * 1024,
  // Foto de perfil: so imagem e bem menor
  avatarMaxBytes: 3 * 1024 * 1024,
  // Cota de upload por pessoa (todos os lugares que recebem arquivo somados):
  // quantos arquivos por hora e quantos bytes por dia.
  uploadMaxPorHora: parseInt(process.env.UPLOAD_MAX_POR_HORA, 10) || 120,
  uploadCotaDiariaBytes: (parseInt(process.env.UPLOAD_COTA_DIARIA_MB, 10) || 2048) * 1024 * 1024,
  // Origens extras aceitas nas escritas (checagem anti-CSRF). Por padrao
  // basta ser o mesmo host da requisicao; aqui entram casos como um dominio
  // diferente do proxy. Lista separada por virgula.
  origensPermitidas: String(process.env.ORIGENS_PERMITIDAS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),

  // SVG ficou de fora de proposito: e um documento que pode carregar script,
  // e ele seria servido pela nossa propria origem.
  uploadAllowedMime: [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
};

// true = usa Postgres | false = usa armazenamento em memoria
config.usePostgres = config.databaseUrl.length > 0;

module.exports = config;
