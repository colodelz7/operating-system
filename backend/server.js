'use strict';

const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');

const config = require('./config');
const repo = require('./data');
const { criarSessionStore } = require('./middleware/sessionStore');

const app = express();
app.disable('x-powered-by');

// Atras de proxy reverso (nginx/host): habilita cookie secure e IP real
// do rate-limit. Controlado por TRUST_PROXY no .env.
if (config.trustProxy) app.set('trust proxy', 1);

// ---------- parsers ----------
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// ---------- sessao ----------
// Local (sem DATABASE_URL): MemoryStore.
// Producao (com DATABASE_URL): connect-pg-simple persiste no Postgres.
app.use(session({
  name: 'colodel.sid',
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

app.get('/api/health', (req, res) => res.json({ ok: true, modo: repo.modo }));

// 404 para qualquer rota nao-API (o front vive noutro lugar agora)
app.use((req, res) => res.status(404).json({ erro: 'Rota não encontrada' }));

// ---------- tratamento de erros ----------
app.use((err, req, res, next) => {
  if (err && err.message === 'Tipo de arquivo não permitido') {
    return res.status(400).json({ erro: err.message });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ erro: 'Arquivo excede o limite de 25MB' });
  }
  console.error('[erro]', err);
  res.status(500).json({ erro: 'Erro interno do servidor' });
});

// ---------- boot ----------
async function iniciar(porta = config.port) {
  await repo.init();
  return new Promise((resolve) => {
    const servidor = app.listen(porta, () => resolve(servidor));
  });
}

// exporta para testes; so sobe sozinho se executado diretamente
module.exports = { app, iniciar };

if (require.main === module) {
  (async () => {
    try {
      await repo.init();
      app.listen(config.port, () => {
        console.log('==================================================');
        console.log('  Colodel · Sistema de Tarefas (API)');
        console.log(`  API em:  http://localhost:${config.port}/api`);
        console.log(`  Armazenamento: ${repo.modo.toUpperCase()}`);
        console.log(`  Sessao: ${config.usePostgres ? 'Postgres (connect-pg-simple)' : 'MemoryStore (local)'}`);
        if (repo.modo === 'memoria') {
          console.log('  (dados em memoria — resetam ao reiniciar)');
          console.log('  Login de teste: admin / colodel2026');
        }
        console.log('==================================================');
      });
    } catch (e) {
      console.error('Falha ao iniciar:', e.message);
      process.exit(1);
    }
  })();
}