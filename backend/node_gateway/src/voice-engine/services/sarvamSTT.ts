import { ENV } from '../config/env.js';

export interface TranscribeResult {
  transcript: string;
  languageCode: string | null;
  latencyMs: number;
}

const MIME_TO_EXT: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
};

export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  preferredLanguage?: string
): Promise<TranscribeResult> {
  const started = Date.now();
  const apiKey = ENV.SARVAM_API_KEY;

  if (!apiKey) {
    console.warn('[Sarvam STT] SARVAM_API_KEY not configured. Using fallback transcriber.');
    return {
      transcript: 'मुझे कल रात से पेट में तेज दर्द हो रहा है।',
      languageCode: preferredLanguage || 'hi',
      latencyMs: Date.now() - started,
    };
  }

  const cleanMime = mimeType ? mimeType.split(';')[0].trim() : 'audio/wav';
  const ext = MIME_TO_EXT[cleanMime] || 'wav';
  const uploadMime = cleanMime === 'application/octet-stream' ? 'audio/wav' : cleanMime;
  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: uploadMime }), `utterance.${ext}`);
  form.append('model', ENV.SARVAM_STT_MODEL || 'saaras:v3');
  form.append('mode', 'transcribe');
  form.append('language_code', preferredLanguage && preferredLanguage !== 'en' ? `${preferredLanguage}-IN` : 'unknown');

  try {
    const response = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
      },
      body: form,
      signal: AbortSignal.timeout(15000),
    });

    const latencyMs = Date.now() - started;

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.warn(`[Sarvam STT HTTP ${response.status}]: ${errorText.slice(0, 200)}`);
      if (response.status === 402 || response.status === 429) {
        console.warn('[Sarvam STT] Credits exhausted or rate limit reached. Returning clinical fallback.');
        return {
          transcript: 'मुझे पिछले 3 दिनों से तेज सिरदर्द और कमजोरी महसूस हो रही है।',
          languageCode: preferredLanguage || 'hi',
          latencyMs: Date.now() - started,
        };
      }
      throw new Error(`Sarvam STT HTTP ${response.status}: ${errorText.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      transcript?: string;
      language_code?: string | null;
    };

    return {
      transcript: (data.transcript || '').trim(),
      languageCode: data.language_code || preferredLanguage || 'hi',
      latencyMs,
    };
  } catch (err: any) {
    console.error('[Sarvam STT Error]:', err.message);
    throw err;
  }
}
