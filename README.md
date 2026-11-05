# 🗂️ Colodel · Sistema Operacional

Sistema interno de gestão de trabalho por setores: Kanban, calendário de entregas, clientes, chat, tarefas recorrentes e histórico de auditoria. Inclui o ColodelBot, assistente que opera o sistema por conversa dentro das permissões de quem está logado.

## 🛠️ Tecnologias

| Camada | Tecnologia |
|---|---|
| Frontend | React 19 + Vite 6 |
| Backend | Node.js + Express 4 |
| Banco de dados | Memória (dev) · PostgreSQL 16 (Docker) |
| IA | Google Gemini (function calling) |
| Bibliotecas | @dnd-kit · zod · multer · react-router-dom |

## 📁 Estrutura

```
├── docker-compose.yml        # API, frontend em nginx e Postgres opcional
├── frontend/
│   ├── src/
│   │   ├── components/       # TarefaModal, Comentarios, Anexos, etc.
│   │   ├── pages/            # Kanban, Calendario, Clientes, Historico, etc.
│   │   ├── context/          # AuthContext, AppContext, etc.
│   │   ├── lib/              # api.js, format.js, filtros.js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── nginx.conf
│   ├── vite.config.js
│   └── package.json
└── backend/
    ├── server.js             # Servidor Express
    ├── config/               # Leitura e validação do ambiente
    ├── middleware/           # auth, auditoria, segurança, upload
    ├── routes/               # auth, tarefas, clientes, usuarios, assistente
    ├── schemas/              # Validação zod
    ├── services/             # recorrência, notificações, assistente
    ├── data/                 # memoryRepo e pgRepo
    ├── db/                   # schema.sql, seed.sql
    ├── test/                 # Testes de integração
    └── .env.example          # Variáveis de ambiente necessárias
```

## 🚀 Rodando localmente

### ⚙️ Backend

```bash
cd backend
npm install
cp .env.example .env      # defina SESSION_SECRET (mínimo 32 caracteres)
npm run dev
```

### 💻 Frontend

```bash
cd frontend
npm install
npm run dev
```
