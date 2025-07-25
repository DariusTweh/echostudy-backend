import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { extractTextFromPDF } from './pdfProcessor.js'; // requires a proper ESM export!
import { OpenAI } from 'openai';
import { extractTextChunksFromPDF } from './pdfProcessor.js'; // new import
import { extractAndSummarizeChunks } from './pdfProcessor.js';
import { detectSubjectFromPdf } from './pdfProcessor.js';

dotenv.config();


const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
export async function generateQuizFromDeck(deckId, types, count, difficulty) {
  console.log('📚 [Deck] Starting quiz generation from deck:', deckId);

  const { data, error } = await supabase
    .from('flashcards')
    .select('*')
    .eq('deck_id', deckId);

  if (error) {
    console.error('❌ [Deck] Error fetching flashcards:', error.message || error);
    throw error;
  }

  console.log(`✅ [Deck] Retrieved ${data.length} flashcards from deck`);

  const prompt = `
  You are an AI quiz generator.

  Using the following flashcards, generate ${count} quiz questions.

  🎯 Required difficulty: ${difficulty || 'medium'}
  🧩 Allowed types: ${types.join(', ')}

  Format:
  [
    {
      "type": "mcq" | "short" | "fillblank" | "truefalse",
      "question": "string",
      "options": ["..."],           // only if type === "mcq"
      "answer": "string or boolean",
      "explanation": "string",
      "difficulty": "easy" | "medium" | "hard"
    }
  ]

  Rules:
  - All questions must match the "${difficulty || 'medium'}" level.
  - Only include "options" if type is "mcq".
  - Only use allowed types.
  - Respond ONLY with valid JSON. No extra text.

  FLASHCARDS:
  ${JSON.stringify(data, null, 2)}
  `;

    console.log('🧠 [Deck] Sending prompt to OpenAI...');
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });

    console.log('✅ [Deck] Received response from OpenAI');

    let content = response.choices[0].message.content.trim();
    if (content.startsWith('```json')) {
      content = content.replace(/```json\s*|\s*```/g, '');
    }

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.error('❌ Quiz generation error: Could not parse JSON:', err.message);
      throw new Error('Failed to parse OpenAI quiz response. Check formatting.');
    }

    const filtered = parsed.filter((q) => types.includes(q.type));
    console.log(`✅ [Deck] Parsed ${filtered.length} valid questions`);
    return filtered.slice(0, count);
}
export async function generateQuizFromPdf(pdfPath, types, count, difficulty) {
  console.log('📄 [PDF] Using RAW chunks — targeting exactly', count, 'questions');
  const chunks = await extractTextChunksFromPDF(pdfPath);
  const allQuestions = [];
  const seen = new Set();

  const getPrompt = (chunk) => `
  You are an expert AI test writer.

  Generate exactly 3 quiz questions that:
  - Are based primarily on the lecture content provided below
  - Can also incorporate relevant external knowledge from your training to simulate real test environments
  - Reflect the style of challenging academic or standardized exams
  - Match the specified difficulty: "${difficulty}"
  - Use only these types: ${types.join(', ')}

  Instructions:
  - Mix factual recall with reasoning or application
  - Use your knowledge to enhance clarity and rigor
  - Ensure all questions are answerable using the lecture text and logical inference
  - Avoid repetitive phrasing or trivial questions

  Return ONLY valid JSON in the following format:
  [
    {
      "type": "mcq" | "short" | "fillblank" | "truefalse",
      "question": "string",
      "options": ["..."],        // only if type === "mcq"
      "answer": "string or boolean",
      "explanation": "string",
      "difficulty": "${difficulty}"
    }
  ]

  No markdown, no commentary, no explanations outside JSON.

  LECTURE TEXT:
  """
  ${chunk}
  """
  `;

  let attemptCount = 0;
  let chunkIndex = 0;

  while (allQuestions.length < count && attemptCount < chunks.length * 2) {
    const chunk = chunks[chunkIndex % chunks.length];
    console.log(`📦 Prompting chunk ${chunkIndex % chunks.length + 1}/${chunks.length}`);

    try {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: getPrompt(chunk) }],
        temperature: 0.4,
      });

      let content = res.choices[0].message.content.trim();
      if (content.startsWith('```json')) {
        content = content.replace(/```json\s*|\s*```/g, '');
      }

      const parsed = JSON.parse(content);

      const filtered = parsed.filter((q) => {
        const key = q.question?.toLowerCase().trim();
        const isValid = q.question && q.type && types.includes(q.type) && !seen.has(key);
        if (isValid) seen.add(key);
        return isValid;
      });

      allQuestions.push(...filtered);
      console.log(`✅ Added ${filtered.length} unique questions. Total: ${allQuestions.length}/${count}`);
    } catch (err) {
      console.warn(`⚠️ Error on chunk ${chunkIndex % chunks.length + 1}:`, err.message);
    }

    chunkIndex++;
    attemptCount++;
  }

  if (allQuestions.length < count) {
    console.warn(`⚠️ Only generated ${allQuestions.length} out of ${count} requested questions`);
  }

  return allQuestions.slice(0, count);
}