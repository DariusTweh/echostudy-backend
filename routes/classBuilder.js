import express from 'express';
import multer from 'multer';
import { processSyllabusToClass } from '../utils/classProcessor.js';
import path from 'path';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/', upload.single('file'), async (req, res) => {
  const file = req.file;
  const userId = req.body.userId; // ✅ Grab userId from body

  if (!file) {
    console.warn('⚠️ No file received in request');
    return res.status(400).json({ error: 'No syllabus uploaded' });
  }

  if (!userId) {
    console.warn('⚠️ No userId provided in request');
    return res.status(400).json({ error: 'Missing userId' });
  }

  console.log('📎 File received:', {
    originalname: file.originalname,
    mimetype: file.mimetype,
    path: file.path,
  });

  try {
    console.log('🔍 Starting syllabus processing...');

    const result = await processSyllabusToClass(file.path, userId); // ✅ Pass userId

    console.log('✅ Parsed class data:', result);

    res.json(result);
  } catch (err) {
    console.error('❌ Error while processing syllabus:', err);
    res.status(500).json({ error: 'Syllabus parsing failed', details: err.message });
  }
});

export default router;
