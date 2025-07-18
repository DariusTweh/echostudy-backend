// server-backend/routes/voiceMode.js
import express from 'express';
import multer from 'multer';
import { transcribeAudio } from '../utils/whisperTranscriber.js';
import { evaluateAnswer } from '../utils/evaluateAnswer.js';
import { synthesizeSpeech } from '../utils/ttsSynthesizer.js';
import fs from 'fs';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/voice-check', upload.single('audio'), async (req, res) => {
  const { term, definition } = req.body;
  const audioPath = req.file?.path;

  if (!term || !definition || !audioPath) {
    return res.status(400).json({ error: 'Missing term, definition, or audio file' });
  }

  console.log('📁 Received file:', req.file);
  console.log('🧾 MIME type:', req.file.mimetype);
  console.log('📍 Path:', req.file.path);

  try {
    const transcript = await transcribeAudio(audioPath);
    const evaluation = await evaluateAnswer(term, definition, transcript);
  const explanation = evaluation.explanation || 'Response evaluated.';
  const speechUrl = await synthesizeSpeech(explanation);
    res.json({ transcript, evaluation, speechUrl });
  } catch (err) {
    console.error('❌ Voice check error:', err);
    res.status(500).json({ error: 'Voice check failed' });
  } finally {
    try {
      if (audioPath && fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
        console.log('🧹 Deleted temp upload:', audioPath);
      }
    } catch (e) {
      console.warn('🧹 Failed to delete temp upload:', e);
    }
  }
});
router.post('/tts', async (req, res) => {
  const { text } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Missing text' });
  }

  try {
    const speechUrl = await synthesizeSpeech(text);
    console.log('🗣️ TTS generated:', speechUrl);
    res.json({ speechUrl });
  } catch (err) {
    console.error('❌ TTS synthesis error:', err.message || err);
    res.status(500).json({ error: 'TTS synthesis failed' });
  }
});

export default router;
