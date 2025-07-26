// scripts/nightlySuggestionGenerator.js
import { createClient } from '@supabase/supabase-js';
import { generateSmartSuggestions } from '../utils/smartEngine.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function runNightlySuggestions() {
  console.log('🌙 Starting nightly smart suggestion job...');

  const { data: users, error } = await supabase.from('profiles').select('id');
  if (error) {
    console.error('❌ Failed to fetch users:', error.message);
    return;
  }

  const contexts = ['dashboard', 'class', 'quiz', 'flashcard', 'semester'];

  for (const user of users) {
    const userId = user.id;
    console.log(`🔁 Generating suggestions for user: ${userId}`);

    // Optional: clear previous suggestions for today
    await supabase
      .from('smart_suggestions')
      .delete()
      .eq('user_id', userId)
      .gte('created_at', new Date().toISOString().split('T')[0]);

    for (const context of contexts) {
      try {
        const suggestions = await generateSmartSuggestions(userId, context);

        // 🎯 Send notification if a top suggestion exists
        if (suggestions?.[0]) {
          const top = suggestions[0];
          await supabase.from('notifications').insert([
            {
              user_id: userId,
              title: '🧠 New AI Study Suggestions Ready',
              body: top.text,
              context: top.context,
              metadata: top.metadata,
              link: `/screen/${top.context}`, // you can route this client-side
            },
          ]);
        }

        console.log(`✅ ${context} suggestions generated for ${userId}`);
      } catch (err) {
        console.error(`❌ Error generating ${context} suggestions for ${userId}:`, err.message);
      }
    }
  }

  console.log('✅ Nightly suggestion job complete.');
}

runNightlySuggestions();
