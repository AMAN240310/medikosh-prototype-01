import { ENV } from '../config/env.js';

export interface SynthesizeResult {
  audioBase64: string;
  mimeType: string;
  latencyMs: number;
}

const LANGUAGE_CODE_MAP: Record<string, string> = {
  hi: 'hi-IN',
  en: 'en-IN',
  bn: 'bn-IN',
  ta: 'ta-IN',
  te: 'te-IN',
  kn: 'kn-IN',
  ml: 'ml-IN',
  mr: 'mr-IN',
  gu: 'gu-IN',
  pa: 'pa-IN',
  od: 'od-IN',
};

export async function synthesizeSpeech(
  text: string,
  languageCode: string = 'hi'
): Promise<SynthesizeResult | null> {
  const started = Date.now();
  const apiKey = ENV.SARVAM_API_KEY;

  if (!apiKey) {
    console.warn('[Sarvam TTS] SARVAM_API_KEY not configured. Audio synthesis skipped.');
    return null;
  }

  const sarvamLang = LANGUAGE_CODE_MAP[languageCode] || 'hi-IN';

  try {
    const response = await fetch('https://api.sarvam.ai/text-to-speech', {
      method: 'POST',
      headers: {
        'api-subscription-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: text.slice(0, 2500),
        language_code: sarvamLang,
        model: ENV.SARVAM_TTS_MODEL || 'bulbul:v3',
        speaker: ENV.SARVAM_TTS_SPEAKER || 'shubh',
        pace: 1.0,
        speech_sample_rate: 22050,
      }),
      signal: AbortSignal.timeout(12000),
    });

    const latencyMs = Date.now() - started;

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.warn(`[Sarvam TTS HTTP ${response.status}]: ${errorText.slice(0, 200)}`);
      return null;
    }

    const data = (await response.json()) as { audios?: string[] };
    const audioBase64 = data.audios?.[0];

    if (!audioBase64) {
      console.warn('[Sarvam TTS] Returned empty audio array');
      return null;
    }

    return {
      audioBase64,
      mimeType: 'audio/wav',
      latencyMs,
    };
  } catch (err: any) {
    console.warn('[Sarvam TTS Error]:', err.message);
    return null;
  }
}
