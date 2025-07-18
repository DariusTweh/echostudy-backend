import { OpenAI } from 'openai';
import dotenv from 'dotenv';
dotenv.config();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function evaluateAnswer(term, definition, userResponse) {
const prompt = `
You are a friendly and intelligent flashcard tutor. Evaluate the user's spoken answer in a supportive, conversational tone.

Flashcard Term: ${term}
Correct Answer: ${definition}
User's Answer: ${userResponse}

Respond ONLY in strict JSON format like this:
{
  "correctness": "correct" | "partial" | "incorrect",
  "quality": 5 | 3 | 2,
  "explanation": "Brief, kind explanation — be encouraging and helpful. Avoid harsh or robotic tone. Use phrases like 'almost', 'good try', 'not quite', 'you're close', or 'here's how to think about it' when needed."
}

Scoring Rules:
- If fully correct, use "correct" and quality 5.
- If partially correct or missing a key detail, use "partial" and quality 3.
- If mostly wrong or unrelated, use "incorrect" and quality 2.

Additional Style Tips:
- Never shame the user.
- Sound like a helpful human tutor, not a judge.
- For wrong or partial answers, offer a tip or helpful way to remember it.
`;

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: 'You evaluate flashcard responses with SM-2 logic.' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.3
  });

  const response = completion.choices[0]?.message?.content?.trim();

  try {
    const parsed = JSON.parse(response);
    return parsed;
  } catch (err) {
    console.error('❌ Failed to parse GPT response:', response);
    return {
      correctness: 'unknown',
      quality: 2,
      explanation: 'Could not evaluate response due to formatting error.'
    };
  }
}
