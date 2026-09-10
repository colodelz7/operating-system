'use strict';

const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');

const PASTA_UPLOADS = path.join(__dirname, '..', 'uploads');

// Extensao vinda do nome enviado pelo usuario: so letras/numeros, curta.
// Qualquer outra coisa (".", "..", "/", nulos, extensao gigante) e descartada.
function extensaoSegura(nomeOriginal) {
  const ext = path.extname(String(nomeOriginal || '')).toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '';
}

/**
 * Resolve o caminho de um arquivo DENTRO da pasta de uploads.
 * Devolve null se o nome tentar sair da pasta (../, caminho absoluto,
 * separador de diretorio, byte nulo). Use sempre isto antes de ler do disco.
 */
function caminhoSeguro(nomeArquivo) {
  const nome = String(nomeArquivo || '');
  if (!nome || nome.includes('\0')) return null;
  if (nome !== path.basename(nome)) return null; // barra, ../, absoluto
  const destino = path.resolve(PASTA_UPLOADS, nome);
  const raiz = path.resolve(PASTA_UPLOADS) + path.sep;
  return destino.startsWith(raiz) ? destino : null;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PASTA_UPLOADS),
  filename: (req, file, cb) => {
    // nome no disco = aleatorio (nunca confiar no nome do usuario)
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extensaoSegura(file.originalname)}`);
  },
});

function fileFilter(req, file, cb) {
  if (config.uploadAllowedMime.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Tipo de arquivo não permitido'));
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.uploadMaxBytes }, // 25MB
});

module.exports = { upload, PASTA_UPLOADS, caminhoSeguro, extensaoSegura };
