// server-backend/utils/whisperTranscriber.js
import fs from 'fs';
import path from 'path';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { OpenAI } from 'openai';
import dotenv from 'dotenv';

dotenv.config();
ffmpeg.setFfmpegPath(ffmpegPath.path);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const TEMP_DIR = path.join(process.cwd(), 'temp');

if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export async function transcribeAudio(inputPath) {
  const baseName = path.basename(inputPath, path.extname(inputPath));
  const outputPath = path.join(TEMP_DIR, `${baseName}_converted.mp3`);

  console.log('🎙️ Converting audio file:', inputPath);

  try {
    // Convert with 16kHz sample rate for Whisper compatibility
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions('-ar', '16000') // force sample rate to 16kHz
        .toFormat('mp3')
        .on('start', commandLine => {
          console.log('⚙️ FFmpeg started with command:', commandLine);
        })
        .on('end', () => {
          console.log('✅ FFmpeg conversion completed:', outputPath);
          resolve();
        })
        .on('error', err => {
          console.error('❌ FFmpeg conversion error:', err.message);
          reject(err);
        })
        .save(outputPath);
    });

    const stats = await fs.promises.stat(outputPath);
    console.log('📦 Converted file size:', stats.size, 'bytes');

    if (stats.size < 1000) {
      console.warn('🟡 File too small — likely no audio recorded.');
      return '[No speech detected]';
    }

    if (stats.size > 25 * 1024 * 1024) {
      throw new Error(`Audio file is too large (${(stats.size / 1024 / 1024).toFixed(2)} MB).`);
    }

    console.log('📤 Sending audio to Whisper API...');
    const fileStream = fs.createReadStream(outputPath);

    const transcription = await openai.audio.transcriptions.create({
      file: fileStream,
      model: 'whisper-1',
      response_format: 'verbose_json', // <-- gives richer info
    });

    console.log('🔍 Whisper response:', transcription);

    const result = transcription.text;
    if (!result || !result.trim()) {
      console.warn('🟡 Whisper returned no transcription.');
      console.warn('🧪 Check converted file manually:', outputPath);
      return '[No speech detected]';
    }

    console.log('📝 Whisper transcript:', result.trim());
    return result.trim();
  } catch (err) {
    console.error('❌ Whisper transcription failed:', err.message || err);
    return '[Transcription failed]';
  } finally {
    // Optional: keep for debugging
    // Clean up later
  }
}
