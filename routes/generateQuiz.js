import express from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';
import { generateQuizFromDeck, generateQuizFromPdf } from '../utils/quizGenerator.js';
import { downloadPdfFromUrl } from '../utils/pdfProcessor.js'; // ✅ Add this import

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const router = express.Router();

router.post('/generate-quiz', async (req, res) => {
  const {
    title,
    types = ['mcq', 'short', 'fillinblank', 'truefalse'],
    source,
    numberOfQuestions = 5,
    userId,
    deckId,
    pdfPath,
    notebookId,
    difficulty,
    topic
  } = req.body;

  console.log('🧾 Raw body:', req.body);

  try {
    if (!userId || !title || !source) {
      return res.status(400).json({ error: 'Missing required fields: userId, title, or source' });
    }

    let questions = [];
    const normalizedSource = source.trim().toLowerCase();

    switch (normalizedSource) {
      case 'deck':
        if (!deckId) return res.status(400).json({ error: 'Missing deckId' });
        questions = await generateQuizFromDeck(deckId, types, numberOfQuestions, difficulty);
        break;

      case 'pdf':
      case 'class_resource':
        if (!pdfPath) return res.status(400).json({ error: 'Missing pdfPath' });

        const localPath = await downloadPdfFromUrl(pdfPath); // ✅ Download PDF
        questions = await generateQuizFromPdf(localPath, types, numberOfQuestions, difficulty);
        fs.unlinkSync(localPath); // ✅ Clean up
        break;

      case 'manual':
        if (!topic) return res.status(400).json({ error: 'Missing topic' });
        questions = await generateQuizFromTopic(topic, types, numberOfQuestions, difficulty);
        break;

      default:
        return res.status(400).json({ error: 'Unsupported source type' });
    }

    if (!questions || questions.length === 0) {
      return res.status(500).json({ error: 'No quiz questions generated' });
    }

    // Save quiz metadata
    const { data: quizData, error: quizError } = await supabase
      .from('quizzes')
      .insert([{ title, user_id: userId }])
      .select();

    if (quizError || !quizData?.[0]) throw quizError || new Error('Quiz creation failed');

    const quizId = quizData[0].id;

    const formattedQuestions = questions.map((q) => ({
      quiz_id: quizId,
      user_id: userId,
      type: q.type,
      prompt: q.question,
      options: q.options || null,
      answer: q.answer,
      explanation: q.explanation || '',
      difficulty: q.difficulty || difficulty || 'medium',
    }));

    const { error: insertError } = await supabase
      .from('quiz_questions')
      .insert(formattedQuestions);

    if (insertError) throw insertError;

    res.json({ quizId, questions });
  } catch (err) {
    console.error('❌ Quiz generation error:', err.message || err);
    res.status(500).json({ error: 'Quiz generation failed' });
  }
});

export default router;
