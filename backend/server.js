'use strict';

const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');

const config = require('./config');
const repo = require('./data');
const { criarSessionStore } = require('./middleware/sessionStore');
const { cabecalhosSeguranca, verificarOrigem } = require('./middleware/seguranca');
const { methodOverride } = require('./middleware/methodOverride');
const { marcarChamadaDoAssistente } = require('./middleware/assistenteInterno');

const app = express();
app.disable('x-powered-by');

// Atras de proxy reverso (nginx/host): habilita cookie secure e IP real
// do rate-limit. Controlado por TRUST_PROXY no .env.
if (config.trustProxy) app.set('trust proxy', config.trustProxy);

// ---------- cabecalhos de seguranca (todas as respostas) ----------
app.use(cabecalhosSeguranca);

// ---------- parsers ----------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ---------- metodo real ----------
// O WAF de algumas hospedagens barra PUT/PATCH/DELETE; o front manda POST
// com X-HTTP-Method-Override e aqui o metodo volta a ser o verdadeiro.
// Precisa vir antes das rotas (e depois dos parsers).
app.use(methodOverride);

// ---------- origem da chamada ----------
// Quando o assistente executa uma acao, ele chama a propria API. Este
// middleware reconhece essa chamada (por um token so deste processo) para a
// auditoria registrar que a acao veio pelo ColodelBot.
app.use(marcarChamadaDoAssistente);

// ---------- anti-CSRF ----------
// Escrita vinda de outro site nao passa: o cookie ja e sameSite=lax e aqui o
// cabecalho Origin e conferido. Precisa vir depois do methodOverride, para
// valer tambem para o PUT/PATCH/DELETE que chegou disfarcado de POST.
app.use(verificarOrigem);

// ---------- sessao ----------
// Local (sem DATABASE_URL): MemoryStore.
// Producao (com DATABASE_URL): connect-pg-simple persiste no Postgres.
app.use(session({
  name: config.cookieName,
  store: criarSessionStore(session),
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,              // JS do navegador nao le o cookie
    sameSite: 'lax',             // front e API no mesmo dominio
    secure: config.cookieSecure, // true so em HTTPS (producao)
    maxAge: 1000 * 60 * 60 * 8,  // 8h
  },
}));

// ---------- API pura ----------
// Este servico NAO serve mais o frontend. O build do front (frontend/dist)
// e publicado como estatico atras do mesmo dominio/reverse-proxy que
// encaminha /api para ca (ver README).
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/usuarios',      require('./routes/usuarios'));
app.use('/api/setores',       require('./routes/setores'));
app.use('/api/tarefas',       require('./routes/tarefas'));
app.use('/api/clientes',      require('./routes/clientes'));
app.use('/api/notificacoes',  require('./routes/notificacoes'));
app.use('/api/anexos',        require('./routes/anexos'));
app.use('/api/historico',     require('./routes/historico'));
app.use('/api/resumo-dia',    require('./routes/resumo'));
app.use('/api/assistente',    require('./routes/assistente'));
app.use('/api/equipe',        require('./routes/equipe'));
app.use('/api/eventos',       require('./routes/eventos'));
app.use('/api/chat',          require('./routes/chat'));
app.use('/api/prompts',       require('./routes/textos')('prompt'));
app.use('/api/mensagens-salvas', require('./routes/textos')('mensagem'));
app.use('/api/briefings',     require('./routes/briefings'));
app.use('/api/acessos',       require('./routes/acessos'));
app.use('/api/push',          require('./routes/push'));

app.get('/api/health', (req, res) => res.json({ ok: true, modo: repo.modo }));

// 404 para qualquer rota nao-API (o front vive noutro lugar agora)
app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

// ---------- tratamento de erros ----------
// Erro de cliente (corpo torto, corpo grande demais, arquivo recusado) tem
// que responder 4xx e NAO virar rastro de erro no log: antes tudo isso caia
// no 500 generico, o que escondia problema de verdade no meio de requisicao
// malformada e ainda enchia o log de stack trace.
app.use((err, req, res, next) => {
  if (err && err.message === 'Tipo de arquivo não permitido') {
    return res.status(400).json({ erro: err.message });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ erro: 'Arquivo excede o limite (25MB para anexos, 3MB para foto de perfil)' });
  }
  if (err && (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')) {
    return res.status(400).json({ erro: 'Envie um arquivo por vez, no campo esperado' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ erro: 'Corpo da requisição não é um JSON válido' });
  }
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ erro: 'Conteúdo grande demais para esta rota' });
  }
  if (err && (err.type === 'encoding.unsupported' || err.type === 'charset.unsupported')) {
    return res.status(415).json({ erro: 'Codificação não suportada' });
  }
  // chave unica do Postgres: dois pedidos iguais ao mesmo tempo (ex.: o mesmo
  // login criado duas vezes) passam pela checagem da rota e o banco barra o
  // segundo. Isso e conflito do cliente, nao erro do servidor.
  if (err && err.code === '23505') {
    return res.status(409).json({ erro: 'Esse registro já existe' });
  }

  console.error('[erro]', err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// ---------- boot ----------
// Escuta so no loopback por padrao; expor na rede exige HOST explicito.
async function iniciar(porta = config.port, host = config.host) {
  await repo.init();
  return new Promise((resolve) => {
    const servidor = app.listen(porta, host, () => resolve(servidor));
  });
}

// exporta para testes; so sobe sozinho se executado diretamente
module.exports = { app, iniciar };

if (require.main === module) {
  (async () => {
    try {
      await repo.init();
      require('./services/recorrencia').iniciarRotina();
      // contadores de limite vencidos saem da tabela de hora em hora
      setInterval(() => { repo.limparUsoVencido().catch(() => {}); }, 60 * 60 * 1000).unref();
      app.listen(config.port, config.host, () => {
        const publico = config.host === '0.0.0.0' || config.host === '::';
        console.log('==================================================');
        console.log('  Sistema Operacional (API)');
        console.log(`  API em:  http://${publico ? 'localhost' : config.host}:${config.port}/api`);
        console.log(`  Escutando em: ${config.host}${publico ? '  (exposto na rede, HOST definido)' : '  (somente esta máquina)'}`);
        console.log(`  Armazenamento: ${repo.modo.toUpperCase()}`);
        console.log(`  Sessao: ${config.usePostgres ? 'Postgres (connect-pg-simple)' : 'MemoryStore (local)'}`);
        if (repo.modo === 'memoria') {
          console.log('  (dados em memoria, resetam ao reiniciar)');
          console.log('  Usuarios de exemplo em data/seedData.js (troque as senhas ao subir)');
        }
        console.log('==================================================');
      });
    } catch (e) {
      console.error('Falha ao iniciar:', e.message);
      process.exit(1);
    }
  })();
}
