import express from 'express';
import multer from 'multer';
import path from 'path';
import { generateFlashcardsFromPdf } from '../utils/flashcardGenerator.js';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/generate', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const result = await generateFlashcardsFromPdf(file.path, file.originalname, req.body.deckId);
    res.json(result);
  } catch (err) {
    console.error('❌ Error generating flashcards:', err);
    res.status(500).json({ error: 'Failed to process PDF' });
  }
});

router.post('/explain', async (req, res) => {
  const { flashcardId, userId } = req.body;

  if (!flashcardId || !userId) {
    return res.status(400).json({ error: 'Missing flashcardId or userId' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const [{ data: flashcard }, { data: profile }] = await Promise.all([
    supabase
      .from('flashcards')
      .select('term, definition')
      .eq('id', flashcardId)
      .single(),

    supabase
      .from('profiles')
      .select('interests, tone_preference')
      .eq('id', userId)
      .single(),
  ]);

  if (!flashcard || !profile) {
    return res.status(404).json({ error: 'Flashcard or user profile not found' });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  let interestContext = 'general';
  if (Array.isArray(profile.interests) && profile.interests.length > 0) {
    const randomIndex = Math.floor(Math.random() * profile.interests.length);
    interestContext = profile.interests[randomIndex];
  }
    const tone = profile.tone_preference || 'friendly';

  const prompt = `
  You are a study tutor who adapts to the user's interest in "${interestContext}" and preferred tone (${tone}).

  Explain the following flashcard content in a way that creatively connects to this interest to make it more memorable.

  Term: ${flashcard.term}
  Definition: ${flashcard.definition}

  Return a concise, helpful explanation.**no more than 5 sentences**. Use a fresh analogy or connection each time.
  `;

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: 'You generate smart, memorable background explanations.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.8,
      });

      const explanation = completion.choices[0]?.message?.content?.trim();
      res.json({ explanation });
    } catch (err) {
      console.error('❌ AI explain error:', err);
      res.status(500).json({ error: 'AI explanation failed' });
    }
  });

export default router;
