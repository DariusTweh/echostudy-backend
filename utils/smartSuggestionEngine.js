import { createClient } from '@supabase/supabase-js';
import { OpenAI } from 'openai';
import { fetchYoutubeSuggestions } from './youtubeFetcher.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function generateAISuggestion(type, metadata = {}) {
  const promptMap = {
    assignment: `A student has an assignment titled "${metadata.title}" due on ${metadata.due_date}. Suggest a study reminder.`,
    quiz_tag: `The student is weak on "${metadata.tag}". Suggest a quiz practice tip.`,
    video: `Encourage watching "${metadata.videoTitle}" to understand "${metadata.topic}" better.`,
    motivation: `Give a short, motivational message to help a student start their study session. Make it encouraging and not generic.`,
  };

  const prompt = promptMap[type];
  if (!prompt) return '';

  const res = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.8,
  });

  return res.choices?.[0]?.message?.content?.trim() || '';
}


const suggestionGenerators = {
  dashboard: async (userId) => {
    const suggestions = [];
    const todayStr = new Date().toISOString().split('T')[0];

    const { data: classes } = await supabase
      .from('classes')
      .select('id, title')
      .eq('user_id', userId);

    for (const cls of classes) {
      // Assignment due
      const { data: assignments } = await supabase
        .from('assignments')
        .select('*')
        .eq('user_id', userId)
        .eq('class_id', cls.id)
        .gte('due_date', new Date().toISOString())
        .order('due_date', { ascending: true })
        .limit(1);

      if (assignments?.[0]) {
        const a = assignments[0];
        const text = await generateAISuggestion('assignment', {
          title: a.title,
          due_date: a.due_date,
        });

        suggestions.push({
          user_id: userId,
          class_id: cls.id,
          type: 'review',
          context: 'dashboard',
          text,
          metadata: { assignment_id: a.id },
        });
      }

      // Flashcards due (SM-2)
      const { data: overdueDecks } = await supabase
        .from('user_deck_progress')
        .select('deck_id')
        .eq('user_id', userId)
        .lt('next_review', new Date().toISOString());

      if (overdueDecks?.length) {
        for (const deck of overdueDecks.slice(0, 1)) {
          suggestions.push({
            user_id: userId,
            class_id: cls.id,
            type: 'flashcard',
            context: 'dashboard',
            text: `Review flashcards in deck ID ${deck.deck_id} — it’s due today.`,
            metadata: { deck_id: deck.deck_id },
          });
        }
      }

      // Scheduled topic
      const { data: scheduleToday } = await supabase
        .from('class_schedule')
        .select('*')
        .eq('user_id', userId)
        .eq('class_id', cls.id)
        .eq('date', todayStr)
        .limit(1);

      if (scheduleToday?.[0]) {
        const t = scheduleToday[0];
        suggestions.push({
          user_id: userId,
          class_id: cls.id,
          type: 'study',
          context: 'dashboard',
          text: `Study today’s topic: "${t.topic}"`,
          metadata: { topic: t.topic },
        });
      }
    }

    return suggestions;
  },

  class: async (userId, classId) => {
    const suggestions = [];

    const { data: cls } = await supabase
      .from('classes')
      .select('id, title')
      .eq('user_id', userId)
      .eq('id', classId)
      .maybeSingle();

    if (!cls) return [];

    const todayStr = new Date().toISOString().split('T')[0];

    // Assignment
    const { data: assignments } = await supabase
      .from('assignments')
      .select('*')
      .eq('user_id', userId)
      .eq('class_id', cls.id)
      .gte('due_date', new Date().toISOString())
      .order('due_date', { ascending: true })
      .limit(1);

    if (assignments?.[0]) {
      const a = assignments[0];
      const text = await generateAISuggestion('assignment', {
        title: a.title,
        due_date: a.due_date,
      });

      suggestions.push({
        user_id: userId,
        class_id: cls.id,
        type: 'review',
        context: 'class',
        text,
        metadata: { assignment_id: a.id },
      });
    }

    // Today’s topic + YouTube
    const { data: scheduleToday } = await supabase
      .from('class_schedule')
      .select('*')
      .eq('user_id', userId)
      .eq('class_id', cls.id)
      .eq('date', todayStr)
      .limit(1);

    if (scheduleToday?.[0]) {
      const t = scheduleToday[0];

      suggestions.push({
        user_id: userId,
        class_id: cls.id,
        type: 'study',
        context: 'class',
        text: `Study today’s topic: "${t.topic}"`,
        metadata: { topic: t.topic },
      });

      const yt = await fetchYoutubeSuggestions(t.topic);
      if (yt?.[0]) {
        const videoText = await generateAISuggestion('video', {
          videoTitle: yt[0].title,
          topic: t.topic,
        });

        suggestions.push({
          user_id: userId,
          class_id: cls.id,
          type: 'video',
          context: 'class',
          text: videoText,
          metadata: { video_url: `https://www.youtube.com/watch?v=${yt[0].videoId}` },
        });
      }
    }

    // Weak tag
    const { data: weakTags } = await supabase.rpc('get_weak_topics', {
      user_id: userId,
      class_id: cls.id,
    });

    if (weakTags?.length) {
      const t = weakTags[0];
      const quizText = await generateAISuggestion('quiz_tag', { tag: t.tag });

      suggestions.push({
        user_id: userId,
        class_id: cls.id,
        type: 'quiz',
        context: 'class',
        text: quizText,
        metadata: { tag: t.tag },
      });
    }

    return suggestions;
  },

  quiz: async (userId, classId) => {
    const suggestions = [];

    const { data: weakTags } = await supabase.rpc('get_weak_topics', {
      user_id: userId,
      class_id,
    });

    if (weakTags?.length) {
      const tag = weakTags[0].tag;
      const text = await generateAISuggestion('quiz_tag', { tag });

      suggestions.push({
        user_id: userId,
        class_id,
        type: 'tag_focus',
        context: 'quiz',
        text,
        metadata: { tag },
      });
    }

    const { data: lowQuizzes } = await supabase.rpc('get_low_score_quizzes', {
      user_id: userId,
      class_id,
    });

    if (lowQuizzes?.[0]) {
      const q = lowQuizzes[0];
      suggestions.push({
        user_id: userId,
        class_id,
        type: 'retake',
        context: 'quiz',
        text: `Retake "${q.quiz_title}" — your score was ${q.score}%.`,
        metadata: { quiz_id: q.quiz_id },
      });
    }

    return suggestions;
  },

  flashcard: async (userId) => {
    const suggestions = [];

    const { data: overdueDecks } = await supabase
      .from('user_deck_progress')
      .select('deck_id, last_reviewed')
      .eq('user_id', userId)
      .lt('next_review', new Date().toISOString());

    for (const deck of overdueDecks?.slice(0, 2) || []) {
      suggestions.push({
        user_id: userId,
        class_id: null,
        type: 'deck_due',
        context: 'flashcard',
        text: `Review deck ID ${deck.deck_id} — last reviewed on ${deck.last_reviewed}.`,
        metadata: { deck_id: deck.deck_id },
      });
    }

    return suggestions;
  },

  semester: async (userId) => {
    const suggestions = [];

    const { data: overdue } = await supabase.rpc('get_overdue_reviews_by_class', {
      user_id: userId,
    });

    for (const o of overdue?.slice(0, 2) || []) {
      suggestions.push({
        user_id: userId,
        class_id: o.class_id,
        type: 'flashcard',
        context: 'semester',
        text: `Review flashcards in ${o.class_title} — ${o.deck_count} decks overdue.`,
        metadata: { class_id: o.class_id },
      });
    }

    const { data: weakTags } = await supabase.rpc('get_weakest_tags_across_classes', {
      user_id: userId,
    });

    for (const w of weakTags?.slice(0, 1) || []) {
      suggestions.push({
        user_id: userId,
        class_id: w.class_id,
        type: 'quiz',
        context: 'semester',
        text: `Weak tag: "${w.tag}" — practice this across classes.`,
        metadata: { tag: w.tag },
      });
    }

    return suggestions;
  },
};

export async function generateSmartSuggestions(userId, context = 'dashboard', classId = null) {
  if (!suggestionGenerators[context]) return [];

  const suggestions = await suggestionGenerators[context](userId, classId);

  for (const s of suggestions) {
    await supabase.from('smart_suggestions').insert([s]);
  }

  return suggestions;
}
