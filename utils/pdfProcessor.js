import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { PDFDocument } from 'pdf-lib';
import { OpenAI } from 'openai';
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import os from 'os';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
export async function downloadPdfFromUrl(url) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  const tempFilePath = path.join(os.tmpdir(), `temp_${Date.now()}.pdf`);
  fs.writeFileSync(tempFilePath, response.data);
  return tempFilePath;
}
// ✅ MAIN: Process PDF into note pages and store in Supabase
export async function processPdfToNotes(filePath, originalName, userId, notebookId) {
  const dataBuffer = fs.readFileSync(filePath);
  const fullPdf = await PDFDocument.load(dataBuffer);
  const pageCount = fullPdf.getPageCount();

  const title = path.basename(originalName, path.extname(originalName));
  const generatedPages = [];

  for (let i = 0; i < pageCount; i++) {
    const newPdf = await PDFDocument.create();
    const [copiedPage] = await newPdf.copyPages(fullPdf, [i]);
    newPdf.addPage(copiedPage);
    const singlePageBuffer = await newPdf.save();

    const { text: pageText } = await pdfParse(singlePageBuffer);
    const cleaned = pageText.trim();

    let aiNote = '⚠️ No readable content on this page.';

    if (cleaned) {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'user',
            content: `Create clear, organized notes from this lecture page:\n\n${cleaned}`,
          },
        ],
        temperature: 0.4,
      });

      aiNote = completion.choices[0].message.content?.trim() || aiNote;
    }

    generatedPages.push({
      id: i + 1,
      content: aiNote,
    });
  }

  const { data, error } = await supabase
    .from('notes')
    .insert([
      {
        user_id: userId,
        notebook_id: notebookId,
        title,
        type: 'Summary',
        pages: generatedPages,
        pinned: false,
        quick_note: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])
    .select()
    .single();

  fs.unlinkSync(filePath);

  if (error) {
    console.error('❌ Supabase insert error:', error);
    throw new Error('Failed to save note to database');
  }

  return { success: true, noteId: data.id };
}

// ✅ HELPER: Extract plain text from entire PDF file (used by quiz generator)
export async function extractTextFromPDF(pdfPath) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const { text } = await pdfParse(dataBuffer);
  return text.trim();
}
export async function extractTextChunksFromPDF(pdfPath, chunkSize = 5) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const fullPdf = await PDFDocument.load(dataBuffer);
  const pageCount = fullPdf.getPageCount();
  const textChunks = [];

  for (let i = 0; i < pageCount; i++) {
    const newPdf = await PDFDocument.create();
    const [copiedPage] = await newPdf.copyPages(fullPdf, [i]);
    newPdf.addPage(copiedPage);
    const pageBuffer = await newPdf.save();
    const { text: pageText } = await pdfParse(pageBuffer);
    textChunks.push(pageText.trim());
  }

  // Group into overlapping chunks (e.g., 1–5, 4–8, etc.)
  const grouped = [];
  for (let i = 0; i < textChunks.length; i += chunkSize - 1) {
    const chunk = textChunks.slice(i, i + chunkSize).join('\n\n');
    if (chunk.length > 100) grouped.push(chunk); // skip empty
  }

  return grouped;
}

export async function extractAndSummarizeChunks(pdfPath, chunkSize = 5) {
  const dataBuffer = fs.readFileSync(pdfPath);
  const fullPdf = await PDFDocument.load(dataBuffer);
  const pageCount = fullPdf.getPageCount();

  const slideTexts = [];

  for (let i = 0; i < pageCount; i++) {
    const newPdf = await PDFDocument.create();
    const [copiedPage] = await newPdf.copyPages(fullPdf, [i]);
    newPdf.addPage(copiedPage);
    const buffer = await newPdf.save();
    const { text } = await pdfParse(buffer);
    slideTexts.push(text.trim());
  }

  // Group slides into overlapping chunks
  const chunks = [];
  for (let i = 0; i < slideTexts.length; i += chunkSize - 1) {
    const chunk = slideTexts.slice(i, i + chunkSize).join('\n\n');
    if (chunk.length > 100) chunks.push(chunk);
  }

  // Summarize each chunk
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const summaries = [];

  for (const [i, chunk] of chunks.entries()) {
    const prompt = `Summarize the following lecture slides into concise bullet point takeaways:\n\n${chunk}`;
    const res = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    });
    const content = res.choices[0].message.content.trim();
    summaries.push(content);
  }

  return summaries;
}
export async function extractGlobalTags(pdfText) {
  const prompt = `
  You are an AI assistant helping extract consistent, high-quality topic tags from a full lecture.

  From the following lecture text, identify key concepts, subtopics, and themes. Return a JSON array of 8–20 short, unique tags (1–3 words max each). These tags will be reused across flashcards to group related concepts.

  Avoid duplicates, general terms like "Lecture", and overly long phrases.

  Return ONLY the JSON array.

  LECTURE TEXT:
  ${pdfText}
  `;

    try {
      const res = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
      });

      let raw = res.choices[0]?.message?.content?.trim() || '';
      console.log('🧠 Raw GPT tag response:', raw);

      // Remove markdown formatting if present (```json ... ```)
      if (raw.startsWith('```')) {
        raw = raw.replace(/```(?:json)?/gi, '').replace(/```$/, '').trim();
        console.log('🧹 Cleaned markdown-wrapped JSON:', raw);
      }

      const tags = JSON.parse(raw);

      if (Array.isArray(tags) && tags.every(t => typeof t === 'string')) {
        console.log('✅ Extracted global tags:', tags);
        return tags;
      } else {
        console.warn('⚠️ GPT returned unexpected tag structure:', tags);
        return [];
      }
    } catch (err) {
      console.error('❌ Failed to extract global tags:', err);
      return [];
    }
}
export async function detectSubjectFromPdf(pdfPath, numPages = 3) {
  const knownSubjects = [
    'Biology',
    'General Chemistry',
    'Organic Chemistry',
    'Physics',
    'Math',
    'Biochemistry',
    'Psychology',
    'Sociology',
    'Anatomy',
    'Physiology',
    'Statistics',
    'Computer Science',
    'Economics',
  ];

  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const fullPdf = await PDFDocument.load(dataBuffer);
    const pageCount = fullPdf.getPageCount();
    const limit = Math.min(numPages, pageCount);

    const textSamples = [];

    for (let i = 0; i < limit; i++) {
      const newPdf = await PDFDocument.create();
      const [copiedPage] = await newPdf.copyPages(fullPdf, [i]);
      newPdf.addPage(copiedPage);
      const pageBuffer = await newPdf.save();
      const { text: pageText } = await pdfParse(pageBuffer);
      textSamples.push(pageText.trim());
    }

    const combinedText = textSamples.join('\n\n').slice(0, 4000); // trim to token budget

    const prompt = `
  You're an expert academic classifier. Based on the lecture content below, identify the subject from the following list only:

  ${knownSubjects.map(s => `- ${s}`).join('\n')}

  If uncertain, choose the most appropriate category. Respond ONLY with the subject name, no explanation.

  LECTURE EXCERPT:
  ${combinedText}
  `;

    const res = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    });

    const subject = res.choices[0]?.message?.content?.trim();

    if (knownSubjects.includes(subject)) {
      console.log('📚 Detected subject:', subject);
      return subject;
    } else {
      console.warn('⚠️ Subject not confidently matched:', subject);
      return 'General';
    }
  } catch (err) {
    console.error('❌ Failed to detect subject:', err);
    return 'General';
  }
}