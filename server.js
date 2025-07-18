import dotenv from 'dotenv';
dotenv.config(); // 👈
import express from 'express';
import cors from 'cors';
import path from 'path';
import multer from 'multer';
import fs from 'fs';
import echoChatRoute from './routes/echoChat.js'; // 👈 Add this
import notesRoutes from './routes/notes.js';
import classBuilderRoute from './routes/classBuilder.js';
import voiceModeRouter from './routes/voiceMode.js';
import flashcardRoutes from './routes/flashcards.js';
import generateQuizRoutes from './routes/generateQuiz.js';

const app = express();
const port = 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));


// ✅ Ensure /output exists
const outputDir = path.join(process.cwd(), 'output');
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir);
}
// 🔧 Set up storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
});

const upload = multer({ storage });

// 📥 PDF upload route
app.post('/upload-pdf', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const filePath = `./uploads/${req.file.filename}`;
  console.log('📄 Uploaded file saved to:', filePath);
  res.json({ filePath });
});

// 📥 PDF upload route

app.use('/api/notes', notesRoutes);
app.use('/api/class-builder', classBuilderRoute);
app.use('/api/flashcards', flashcardRoutes);
app.use('/api', voiceModeRouter); // ✅ /api/voice-check
app.use('/api/quizzes', generateQuizRoutes);
app.use('/api/echochat', echoChatRoute); // 👈 Mount route
// ✅ Serve TTS mp3 files
app.use('/output', express.static(outputDir));

// Start server
app.listen(port, () => {
  console.log(`🚀 EchoStudy backend running at http://192.168.0.187:${port}`);
});
