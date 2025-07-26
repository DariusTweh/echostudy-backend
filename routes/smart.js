import express from 'express';
import { generateSmartSuggestions } from '../utils/smartSuggestionEngine.js';

const router = express.Router();

router.post('/generate-suggestions', async (req, res) => {
  const { userId } = req.body;

  if (!userId) return res.status(400).json({ error: 'Missing userId' });

  try {
    const results = await generateSmartSuggestions(userId);
    res.status(200).json({ success: true, suggestions: results });
  } catch (err) {
    console.error('❌ Smart suggestion error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
