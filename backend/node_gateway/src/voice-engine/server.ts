import { app } from './app.js';
import { ENV } from './config/env.js';
import { db } from './database/db.js';

async function bootstrap() {
  console.log('🚀 Starting Patient Voice Case-Taking Backend...');

  // Initialize Dual-Mode Database
  await db.connect();

  const server = app.listen(ENV.PORT, () => {
    console.log(`✅ [Server] Running at http://localhost:${ENV.PORT}`);
    console.log(`📍 [API] Voice Case-Taking available at http://localhost:${ENV.PORT}/api/case-taking`);
    console.log(`🎙️ [AI] Sarvam STT: ${ENV.SARVAM_STT_MODEL} | Chat: ${ENV.SARVAM_CHAT_MODEL} | TTS: ${ENV.SARVAM_TTS_MODEL}`);
    console.log(`✨ [AI] Gemini Q2: ${ENV.GEMINI_MODEL}`);
  });

  const gracefulShutdown = () => {
    console.log('Stopping server gracefully...');
    server.close(() => {
      console.log('Server stopped.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
}

bootstrap().catch((err) => {
  console.error('Fatal bootstrapping error:', err);
  process.exit(1);
});
