import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import dotenv from 'dotenv';
dotenv.config();

const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
import { extractTextFromPDF, extractGlobalTags } from './pdfProcessor.js';

const Papa = require('papaparse');
const { createClient } = require('@supabase/supabase-js');
import { OpenAI } from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const generateFlashcardsFromPdf = async (pdfPath, originalName, deckId,userId) => {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const pdfDoc = await pdfjsLib.getDocument({ data }).promise;

  console.log('📥 Extracting global tags...');
  const fullText = await extractTextFromPDF(pdfPath);
  const globalTags = await extractGlobalTags(fullText);
  console.log('🏷️ Global tags:', globalTags);

  const cards = [];

  for (let i = 0; i < pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i + 1);
    const content = await page.getTextContent();
    const strings = content.items.map(item => item.str).join(' ');
    const slideText = strings.trim();

    if (!slideText || slideText.length < 20) continue;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `You're an expert flashcard assistant helping students learn using active recall and spaced repetition.

Return only a clean JSON array of flashcards like:
[
  {
    "question": "What enzyme catalyzes the first step of glycolysis?",
    "answer": "Hexokinase",
    "tags": ["Glycolysis", "Enzymes"]
  }
]

Rules:
- Each flashcard should test ONE specific concept.
- Use natural, specific questions (not vague or cloze deletions).
- Avoid compound or multi-part questions.
- Do not include trivial or redundant cards.
- Assign 1–2 relevant tags from a provided list.
- If helpful, ask the reverse direction as a second card.
- Do NOT include explanations or markdown formatting.`
        },
        {
          role: 'user',
          content: `Create flashcards from this slide:\n\n${slideText}

Use only these tags: ${JSON.stringify(globalTags)}

Return a clean JSON array as described above.`
        }
      ],
      temperature: 0.4
    });

    let raw = completion.choices[0]?.message?.content || '';

    if (raw.startsWith('```')) {
      raw = raw.replace(/```(?:json)?/gi, '').replace(/```$/, '').trim();
    }

    try {
      const parsed = JSON.parse(raw);
      parsed.forEach(card => cards.push(card));
      console.log(`✅ Slide ${i + 1} complete with ${parsed.length} cards`);
      await supabase
        .from('flashcard_decks')
        .update({
          progress: {
            page: i + 1,
            totalPages: pdfDoc.numPages,
            file: originalName
          },
          tags: globalTags // 👈 save the final extracted tags
        })
        .eq('id', deckId);
    } catch (err) {
      console.error(`❌ JSON parse error on slide ${i + 1}:`, raw);
    }
  }

  const outputDir = path.join(process.cwd(), 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }
  const filename = `${originalName.replace('.pdf', '')}.csv`;
  const filepath = path.join(outputDir, filename);
  const csv = cards.map(c => `"${c.question}","${c.answer}"`).join('\n');
  fs.writeFileSync(filepath, 'Term,Definition\n' + csv);

  if (deckId && cards.length > 0) {
    const flashcards = cards.map(card => ({
      deck_id: deckId,
      user_id: userId, // ✅ Pass this from outside (see below)
      term: card.question?.trim() || '',
      definition: card.answer?.trim() || '',
      tags: Array.isArray(card.tags) ? card.tags : [],
      ai_generated: true,
      ease_factor: 2.5,
      interval: 1,
      repetitions: 0,
      last_reviewed: null,
      next_review_date: null,
      source_note_id: null,
    }));

    console.log('🧪 Sample flashcard:', flashcards[0]);

    try {
      const { error: insertError } = await supabase.from('flashcards').insert(flashcards);
      if (insertError) {
        console.error('❌ Flashcard insert error:', insertError);
      } else {
        console.log(`✅ ${flashcards.length} flashcards inserted`);
      }
    } catch (err) {
      console.error('❌ Supabase insert exception:', err);
    }

    try {
      const { error: updateError } = await supabase
        .from('flashcard_decks')
        .update({ status: 'ready', progress: null,tags:globalTags })
        
        .eq('id', deckId);

      if (updateError) {
        console.error('❌ Failed to update deck status:', updateError);
      } else {
        console.log(`✅ Deck ${deckId} marked as ready`);
      }
    } catch (err) {
      console.error('❌ Supabase update exception:', err);
    }
  }

  return { filename, totalCards: cards.length };
};
