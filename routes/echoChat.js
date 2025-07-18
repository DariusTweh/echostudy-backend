// routes/echochat.ts
import express from 'express';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

router.post('/', async (req, res) => {
  const { messages = [], context = '', tone = 'neutral' } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'Messages array is required' });
  }

  try {
    // Optional: Add a system prompt at the beginning
    const systemPrompt = {
      role: 'system',
      content: `You are Echo, a smart AI tutor. Respond in a ${tone} tone. ${
        context ? `Keep in mind: ${context}` : ''
      }`,
    };

    const chatMessages = [systemPrompt, ...messages];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: chatMessages,
    });

    const aiReply = completion.choices[0].message.content;
    res.json({ reply: aiReply });
  } catch (err) {
    console.error('EchoChat Error:', err.message);
    res.status(500).json({ error: 'AI response failed' });
  }
});

export default router;
