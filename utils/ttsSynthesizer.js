// server-backend/utils/ttsSynthesizer.js
import fs from 'fs';
import path from 'path';
import { OpenAI } from 'openai';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import dotenv from 'dotenv';

dotenv.config();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
ffmpeg.setFfmpegPath(ffmpegPath.path);

const OUTPUT_DIR = process.env.TTS_OUTPUT_DIR || 'output';

export async function synthesizeSpeech(text, filename = 'speech.mp3') {
  try {
    const speechResponse = await openai.audio.speech.create({
      model: 'gpt-4o-mini-tts',
      voice: 'fable', // louder voice than 'nova'
      input: text,
    });

    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    const basePath = path.join(OUTPUT_DIR, `${Date.now()}_${filename}`);
    const rawPath = basePath.replace('.mp3', '_raw.mp3');
    const boostedPath = basePath;

    // Save original raw MP3
    const buffer = Buffer.from(await speechResponse.arrayBuffer());
    fs.writeFileSync(rawPath, buffer);

    // 🔊 Boost volume with ffmpeg (2.0 = 200%)
    await new Promise((resolve, reject) => {
      ffmpeg(rawPath)
        .audioFilters('acompressor=threshold=-18dB:ratio=6:attack=20:release=250, volume=4.0') // or try 'volume=3.0' if still too quiet
        .on('end', resolve)
        .on('error', reject)
        .save(boostedPath);
    });

    // Delete raw quiet version
    fs.unlinkSync(rawPath);

    return `/${boostedPath.replace(/\\/g, '/')}`;
  } catch (error) {
    console.error('TTS synthesis failed:', error);
    throw new Error('Failed to synthesize speech');
  }
}
