'use strict';

const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');

const PASTA_UPLOADS = path.join(__dirname, '..', 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PASTA_UPLOADS),
  filename: (req, file, cb) => {
    // nome no disco = aleatorio (nunca confiar no nome do usuario)
    const ext = path.extname(file.originalname).slice(0, 10);
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
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

module.exports = { upload, PASTA_UPLOADS };
