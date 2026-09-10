# 🗂️ Colodel · Sistema Operacional

Sistema interno de gestão de trabalho por setores: quadro Kanban com arrastar e soltar, calendário de entregas, cadastro de clientes, comentários e anexos por demanda, tarefas recorrentes, trilha de auditoria de tudo que acontece no sistema, e um assistente virtual (ColodelBot) que opera o sistema por conversa, sempre dentro das permissões de quem está logado.

## 🛠️ Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite 6 |
| Backend | Node.js + Express 4 |
| Banco de dados | Memória (dev) e PostgreSQL 16 (produção, via Docker) |
| Autenticação | bcrypt + sessão em cookie httpOnly (connect-pg-simple) |
| Assistente virtual | Gemini com function calling (opera o sistema pela própria API) |
| Validação | zod em todo corpo e filtro de query |
| Bibliotecas | @dnd-kit · react-router-dom · multer · express-rate-limit |
| Testes | Suíte de integração própria (memória e Postgres) · Vitest + Testing Library |

## ✨ Principais telas

- **Visão Geral**: indicadores por setor, atrasos, urgências e tempo de andamento.
- **Kanban**: quadro por setor com colunas configuráveis, arrastar e soltar, prioridade, cronômetro e contadores de retrabalho. Cada card mostra anexos, comentários e se a tarefa repete.
- **Detalhe da demanda**: descrição com checklist, status editável, comentários da equipe e anexos com pré-visualização de imagem e PDF na própria tela.
- **Calendário**: entregas do mês, com remarcação arrastando o card para outro dia.
- **Clientes**: ficha completa com logo, restrita a quem tem permissão.
- **Calendário da Equipe**: calendário externo incorporado, aceito apenas em https e de domínio conhecido.
- **Datas Comemorativas**: calendário de marketing do ano.
- **Histórico**: registro de tudo que acontece no sistema (acessos, tentativas de senha, bloqueios, e cada registro criado, editado ou excluído), com autor, data, IP e navegador. Filtros por tipo, ação, pessoa e período, busca por texto e painel de detalhes ao clicar em um evento. Filtros e paginação rodam no servidor.
- **Usuários**: gestão de contas, papéis, setor, colunas visíveis e ativação, restrita a administradores.
- **ColodelBot**: botão flutuante com assistente que cria, edita, move, comenta, duplica, consulta e exclui demandas, clientes e usuários por conversa, com a resposta chegando em tempo real.

## 🔁 Tarefas recorrentes

Uma demanda pode repetir todo dia, toda semana, a cada 15 dias ou todo mês, com prazo final opcional. Ao concluir a tarefa, a próxima ocorrência é criada na hora; se ninguém concluir, uma varredura horária cria a seguinte quando a entrega vence. Cada ocorrência gera no máximo uma seguinte, então reiniciar o servidor, rodar a varredura de novo ou ter mais de uma instância da API nunca duplica a série. Uma série esquecida há meses gera uma ocorrência para esta semana, e não uma pilha de atrasadas.

## 🔒 Segurança

O projeto passou por uma auditoria completa de código, configuração, dependências e superfície de rede. O que está implementado hoje:

**Autenticação e sessão**
- Senhas com bcrypt, nunca retornadas pela API.
- Sessão em cookie `httpOnly` com `SameSite=Lax` e `Secure` em produção, regenerada no login para evitar fixation.
- O segredo de sessão é obrigatório e precisa ter no mínimo 32 caracteres: sem ele o servidor se recusa a iniciar, em vez de cair num padrão publicado no código.
- Papel, setor e situação da conta são recarregados do banco a cada requisição: promover, rebaixar, desativar ou excluir alguém tem efeito imediato, inclusive em sessões já abertas.
- Bloqueio de 5 minutos após 3 tentativas erradas, contado por IP e por conta, com cronômetro regressivo na tela de login. Com Postgres, o bloqueio fica no banco e sobrevive a restart.
- Resposta genérica e comparação bcrypt mesmo quando a conta não existe, para o tempo de resposta não revelar quais logins são válidos.
- Proteção contra o sistema ficar sem nenhum administrador ativo.

**Dados e autorização**
- Todo SQL é parametrizado, e o `:id` da URL é validado antes de qualquer consulta.
- Membro alcança apenas o próprio setor; exclusões de tarefa e de cliente exigem administrador.
- Todo corpo e todo filtro de query passam por schema zod antes de tocar no banco.
- Upload com allowlist de tipo, limite de 25 MB, nome no disco sempre aleatório e leitura por um resolvedor que recusa qualquer caminho que tente sair da pasta de uploads.
- A pré-visualização de anexo serve inline apenas os formatos que o navegador exibe com segurança (SVG fica de fora de propósito, por ser um documento que pode carregar script).

**Superfície e infraestrutura**
- A API escuta apenas em `127.0.0.1` por padrão. Expor na rede exige `HOST` explícito no `.env`.
- Cabeçalhos de segurança em toda resposta: CSP, `nosniff`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, COOP e CORP.
- Escritas conferem a origem da requisição, e alguns WAFs de hospedagem bloqueiam PUT, PATCH e DELETE: o front envia essas escritas como POST com `X-HTTP-Method-Override` e o servidor restaura o método, aceitando só esses três verbos.
- Rate limit no login e no assistente, e `npm audit` zerado nos dois projetos.
- Nenhum segredo versionado: os arquivos `.env` ficam fora do repositório e os `.env.example` não trazem valores de exemplo para senha ou chave.
- O endereço do calendário incorporado só vai para o iframe se for https e de um domínio de calendário conhecido.

**Assistente**
- A chave do modelo fica apenas no servidor, e o navegador nunca a recebe.
- O modelo não tem caminho próprio para o banco: cada ação é uma chamada à própria API com a sessão de quem está conversando, então ele consegue exatamente o que aquela pessoa conseguiria pela tela, com a mesma validação e a mesma auditoria.
- Exclusão exige confirmação explícita, e quando a API recusa algo a resposta avisa o que não foi feito, mesmo que o texto do modelo diga o contrário.
- Toda ação do assistente entra no histórico marcada como feita pelo ColodelBot.

## 📁 Estrutura

```
├── docker-compose.yml            # API, frontend em nginx e Postgres opcional
├── backend/
│   ├── server.js                 # Servidor Express (API pura)
│   ├── config/                   # Leitura e validação do ambiente
│   ├── middleware/               # auth, auditoria, bloqueioLogin, seguranca, upload, validate
│   ├── routes/                   # auth, tarefas, clientes, usuarios, historico, assistente, resumo
│   ├── schemas/                  # Validação zod por recurso
│   ├── services/                 # recorrencia, notificacoes, eventos, assistente/
│   ├── data/                     # memoryRepo e pgRepo (mesma interface)
│   ├── db/                       # schema.sql, seed.sql, migracao.sql
│   └── test/                     # Suíte de integração
└── frontend/
    ├── src/
    │   ├── components/           # TarefaModal, Comentarios, Anexos, AssistenteColodelBot, etc.
    │   ├── pages/                # Kanban, Calendario, Clientes, Usuarios, Historico, etc.
    │   ├── context/              # AuthContext, AppContext, NotificacoesContext, etc.
    │   ├── lib/                  # api.js, format.js, filtros.js, calendario.js
    │   ├── App.jsx
    │   └── main.jsx
    ├── nginx.conf
    ├── vite.config.js
    └── package.json
```

## 🚀 Rodando localmente

### ⚙️ Backend

```bash
cd backend
npm install
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Cole o valor gerado em `SESSION_SECRET` dentro do `.env` (o servidor não sobe sem isso) e inicie:

```bash
npm run dev
```

A API sobe em `http://127.0.0.1:3001/api`, escutando apenas na própria máquina.

### 💻 Frontend

```bash
cd frontend
npm install
npm run dev
```

Acesse `http://localhost:5174`. O Vite faz proxy de `/api` para o backend, o que mantém o cookie de sessão na mesma origem.

### 🤖 Assistente (opcional)

O ColodelBot liga quando existe uma chave do Google AI Studio no `backend/.env`:

```bash
GEMINI_API_KEY=sua-chave
```

Sem a chave o botão simplesmente não aparece e o resto do sistema segue normal.

### 🐘 Banco de dados (opcional)

Por padrão o sistema roda em memória, com dados de exemplo que voltam ao estado inicial a cada reinício. Para usar Postgres de verdade, preencha `DATABASE_URL` e `POSTGRES_PASSWORD` no `.env` da raiz e suba tudo em containers:

```bash
docker compose --profile pg up -d --build
```

O banco sobe na porta 5433 do host, e `schema.sql`, `seed.sql` e `session.sql` rodam sozinhos na primeira criação do volume. Em um banco que já existe, aplique as colunas novas com `backend/db/migracao.sql`.

### 🧪 Testes

```bash
cd backend && npm test        # 102 verificações de fluxo e de segurança
cd frontend && npm test       # 24 testes de componente e de biblioteca
```

A mesma suíte do backend roda contra o Postgres, o que prova que os dois repositórios se comportam igual:

```bash
cd backend
DATABASE_URL=postgres://usuario:senha@localhost:5433/operacional_teste npm run test:pg
```

Use sempre um banco separado para isso: a suíte cria e apaga dados.

### 👤 Usuários de exemplo

| Login | Senha | Papel | Setor |
|---|---|---|---|
| `admin` | `colodel` | admin | Atendimento |
| `colodel` | `colodel` | admin | Atendimento |
| `morning` | `colodel` | membro | Criativo |

Dados de exemplo totalmente genéricos, sem informação real de clientes, colaboradores ou empresa. Troque as senhas pela tela de Usuários assim que subir o sistema.

## 📄 Licença

MIT. Veja o arquivo [LICENSE](LICENSE).
