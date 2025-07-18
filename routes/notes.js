// server/routes/notes.js
import express from 'express';
import multer from 'multer';
import { processPdfToNotes } from '../utils/pdfProcessor.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' }); // make sure /uploads exists

router.post('/upload', upload.single('file'), async (req, res) => {
  console.log('📥 Upload endpoint hit');

  const file = req.file;
  const { userId, notebookId } = req.body;

  console.log('🧾 Received:', { file, userId, notebookId });

  if (!file || !userId || !notebookId) {
    console.error('⚠️ Missing data');
    return res.status(400).json({ error: 'Missing file, userId, or notebookId' });
  }

  try {
    const result = await processPdfToNotes(file.path, file.originalname, userId, notebookId);
    console.log('✅ Note generated:', result);
    res.json(result);
  } catch (err) {
    console.error('❌ Error processing PDF:', err);
    res.status(500).json({ error: 'Something went wrong' });
  }
});


export default router;