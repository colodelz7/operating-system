# 🗂️ Sistema Operacional - Colodel

Sistema interno de gestao de tarefas por setores, com quadro Kanban, clientes, historico, calendario da equipe e controle de usuarios.

## 🛠️ Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite 5 |
| Backend | Node.js + Express |
| Storage | Memoria (dev) e PostgreSQL (producao) |
| Bibliotecas | @dnd-kit e react-router-dom |
| Seguranca | express-session, bcryptjs, express-rate-limit, zod |

## 📁 Estrutura

```
├── frontend/
│   ├── src/
│   │   ├── components/         # Sidebar, Topbar, Filtros, TarefaModal, etc.
│   │   ├── pages/               # Kanban, Clientes, Calendario, Usuarios, Historico
│   │   ├── context/             # AuthContext, AppContext, NotificacoesContext, etc.
│   │   ├── lib/                 # api.js, format.js, filtros.js, constants.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
└── backend/
    ├── server.js                # Servidor Express
    ├── config/                  # Variaveis de ambiente
    ├── routes/                  # auth, tarefas, clientes, setores, usuarios, anexos
    ├── data/                    # seedData.js (memoria), memoryRepo.js, pgRepo.js
    ├── db/                      # schema.sql, seed.sql, migracao.sql (PostgreSQL)
    ├── middleware/               # auth, upload, rateLimit, sessionStore
    ├── .env.example              # Variaveis de ambiente necessarias
    └── package.json
```

## 🚀 Rodando localmente

### ⚙️ Backend

Por padrao roda em memoria, nao precisa instalar banco de dados.

```bash
cd backend
npm install
cp .env.example .env
npm run dev
```

API em http://localhost:3000.

### 💻 Frontend

```bash
cd frontend
npm install
npm run dev
```

Acesse http://localhost:5173 (o Vite ja faz proxy de /api para o backend).

Login padrao: admin / colodel2026

Demais usuarios de exemplo: usuario02 ate usuario11, mesma senha.

## 🗄️ Banco de dados (opcional)

Para usar PostgreSQL em vez de memoria:

```bash
psql "$DATABASE_URL" -f backend/db/schema.sql
psql "$DATABASE_URL" -f backend/db/seed.sql
```

E preencher o DATABASE_URL no .env do backend.
