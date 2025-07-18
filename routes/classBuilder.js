import express from 'express';
import multer from 'multer';
import { processSyllabusToClass } from '../utils/classProcessor.js';
import path from 'path';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/', upload.single('file'), async (req, res) => {
  const file = req.file;

  // ✅ DEBUG 1: File presence
  if (!file) {
    console.warn('⚠️ No file received in request');
    return res.status(400).json({ error: 'No syllabus uploaded' });
  }

  console.log('📎 File received:', {
    originalname: file.originalname,
    mimetype: file.mimetype,
    path: file.path,
  });

  try {
    // ✅ DEBUG 2: Start processing
    console.log('🔍 Starting syllabus processing...');

    const result = await processSyllabusToClass(file.path);

    // ✅ DEBUG 3: Log result
    console.log('✅ Parsed class data:', result);

    res.json(result);
  } catch (err) {
    // ✅ DEBUG 4: Error handling
    console.error('❌ Error while processing syllabus:', err);
    res.status(500).json({ error: 'Syllabus parsing failed', details: err.message });
  }
});

export default router;
