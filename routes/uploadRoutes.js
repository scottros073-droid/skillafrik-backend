// backend/routes/uploadRoutes.js
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { authMiddleware } = require('../middleware/authMiddleware');
const logger = require('../utils/logger');

const router = express.Router();
const uploadDir = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.txt', '.doc', '.docx']);
const MIME_TO_EXTENSIONS = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/jpg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'application/pdf': ['.pdf'],
  'text/plain': ['.txt'],
  'application/msword': ['.doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx']
};

// storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomUUID()}${ext}`);
  }
});

// whitelist mime types
const ALLOWED_MIMES = [
  'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
];

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024, files: 1 }, // 8MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const validMime = ALLOWED_MIMES.includes(file.mimetype);
    const validExt = ALLOWED_EXTENSIONS.has(ext);
    const validPair = MIME_TO_EXTENSIONS[file.mimetype]?.includes(ext);

    if (validMime && validExt && validPair) {
      return cb(null, true);
    }

    return cb(new Error('File type not allowed'), false);
  }
});

router.post('/file', authMiddleware, (req, res) => {
  upload.single('file')(req, res, (error) => {
    if (error) {
      logger.warn('Upload rejected', {
        requestId: req.requestId,
        userId: req.user?.id,
        error: error.message,
        ip: req.ip
      });
      return res.status(400).json({ success: false, message: error.message });
    }

    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    logger.audit('File uploaded', {
      requestId: req.requestId,
      userId: req.user?.id,
      filename: req.file.filename,
      mimetype: req.file.mimetype,
      size: req.file.size
    });

  const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    return res.json({ success: true, url, data: { url } });
  });
});

module.exports = router;
