// utils/classProcessor.js
import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export async function processSyllabusToClass(filePath, userId) {
  try {
    console.log('📄 Reading file from path:', filePath);
    const dataBuffer = fs.readFileSync(filePath);

    console.log('📄 Parsing PDF...');
    const pdfData = await pdfParse(dataBuffer);
    const syllabusText = pdfData.text;
    console.log('📝 PDF text length:', syllabusText.length);

    const prompt = `You are an academic assistant. Analyze the following course syllabus and output ONLY valid JSON. Do not include any explanation or formatting.

Extract:
- title
- instructor
- credits (if mentioned)
- schedule (array of { date, topic, chapter })
- assignments (array of { title, dueDate, type })
- learning_goals (array)
- textbook (if mentioned)

Return a valid, parseable JSON object that conforms to JavaScript standards.

Format your response exactly like this:
{
  "title": "Intro to Biology",
  "instructor": "Dr. Smith",
  "credits": 3,
  "schedule": [
    { "date": "2025-07-14", "topic": "Intro", "chapter": "1" }
  ],
  "assignments": [
    { "title": "Exam 1", "dueDate": "2025-07-21", "type": "Exam" }
  ],
  "learning_goals": ["Understand cell structure"],
  "textbook": "Campbell Biology"
}

Syllabus:
"""
${syllabusText}
"""`;

    console.log('🤖 Sending prompt to OpenAI...');
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    });

    const raw = completion.choices[0].message.content;
    console.log('📥 GPT response received. First 200 chars:\n', raw.slice(0, 200));

    let parsed;
    try {
      const cleaned = raw.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(cleaned);
      console.log('✅ Successfully parsed GPT response to JSON');
    } catch (err) {
      console.error('❌ JSON parse failed. Raw GPT output:\n', raw);
      throw new Error('Invalid JSON from GPT. Raw output:\n' + raw);
    }

    console.log('📦 Inserting class into Supabase...');
    const { data: classInsert, error: classError } = await supabase.from('classes').insert({
      title: parsed.title,
      instructor: parsed.instructor,
      credits: parsed.credits,
      focus: parsed.learning_goals?.[0] || null,
      user_id: userId,
      status: 'UP TO DATE',
    }).select().single();

    if (classError) throw new Error('Failed to insert class: ' + classError.message);
    const classId = classInsert.id;

    // Insert class schedule
    let sortedSchedule = [];
    if (parsed.schedule && parsed.schedule.length > 0) {
      sortedSchedule = parsed.schedule.map((item, i) => ({
        ...item,
        dateObj: new Date(item.date),
        lectureNum: i + 1,
      })).sort((a, b) => a.dateObj - b.dateObj);

      const formattedSchedule = sortedSchedule.map(item => ({
        class_id: classId,
        user_id: userId,
        date: item.date,
        topic: item.topic,
        chapter: item.chapter,
      }));

      const { error: scheduleError } = await supabase
        .from('class_schedule')
        .insert(formattedSchedule);

      if (scheduleError) throw new Error('Failed to insert schedule: ' + scheduleError.message);
    }

    // Insert assignments and match lectures to exams
    let examMetaMap = {};
    let formattedAssignments = [];

    if (parsed.assignments && parsed.assignments.length > 0) {
      const sortedExams = parsed.assignments
        .filter(a => a.type.toLowerCase() === 'exam')
        .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

      for (let i = 0; i < sortedExams.length; i++) {
        const exam = sortedExams[i];
        const examDate = new Date(exam.dueDate);
        const prevExamDate = i > 0 ? new Date(sortedExams[i - 1].dueDate) : null;

        const coveredLectures = sortedSchedule.filter(l =>
          (!prevExamDate || l.dateObj > prevExamDate) && l.dateObj <= examDate
        );

        const lectureRange = coveredLectures.length
          ? `Lectures ${coveredLectures[0].lectureNum}–${coveredLectures[coveredLectures.length - 1].lectureNum}`
          : null;

        const topics = coveredLectures.map(l => l.topic).filter(Boolean);

        examMetaMap[exam.title] = {
          lecture_range: lectureRange,
          covered_topics: topics,
        };
      }

      formattedAssignments = parsed.assignments.map(a => {
        const meta = examMetaMap[a.title] || {};
        return {
          title: a.title,
          due_date: /^\d{4}-\d{2}-\d{2}$/.test(a.dueDate) ? a.dueDate : null,
          type: a.type,
          priority: ['exam', 'quiz'].includes(a.type.toLowerCase()) ? 'High' : 'Normal',
          class_id: classId,
          user_id: userId,
          lecture_range: meta.lecture_range || null,
          covered_topics: meta.covered_topics || null,
        };
      });

      const { error: assignErr } = await supabase.from('assignments').insert(formattedAssignments);
      if (assignErr) throw new Error('Failed to insert assignments: ' + assignErr.message);
    }

    // Insert exam flashcard decks
    const examAssignments = formattedAssignments.filter(a => a.type.toLowerCase() === 'exam');
    const examDecks = examAssignments.map(a => ({
      title: `${parsed.title} - ${a.title} Deck`,
      class_id: classId,
      user_id: userId,
      lecture_range: a.lecture_range,
      covered_topics: a.covered_topics,
    }));

    const { data: insertedDecks, error: deckErr } = await supabase
      .from('flashcard_decks')
      .insert(examDecks)
      .select();

    if (deckErr) throw new Error('Failed to insert decks: ' + deckErr.message);
    console.log('✅ Inserted decks:', insertedDecks);

    return parsed;
  } catch (err) {
    console.error('❌ Error in processSyllabusToClass:', err);
    throw err;
  } finally {
    console.log('🧹 Cleaning up uploaded file:', filePath);
    fs.unlinkSync(filePath);
  }
}