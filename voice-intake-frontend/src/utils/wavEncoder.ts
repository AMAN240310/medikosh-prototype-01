/**
 * Encodes Float32 audio samples into a standard 16-bit Linear PCM WAV Blob at target sample rate (16kHz).
 * Standard 16kHz mono PCM WAV is the gold-standard input for Sarvam STT and speech models.
 */
export function encodeWAV(
  samples: Float32Array,
  inputSampleRate: number,
  targetSampleRate: number = 16000
): Blob {
  // Resample to targetSampleRate (e.g. 16000 Hz) if needed
  const resampled = resampleAudio(samples, inputSampleRate, targetSampleRate);

  const buffer = new ArrayBuffer(44 + resampled.length * 2);
  const view = new DataView(buffer);

  // 1. RIFF chunk descriptor
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + resampled.length * 2, true);
  writeString(view, 8, 'WAVE');

  // 2. fmt sub-chunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size for PCM
  view.setUint16(20, 1, true); // AudioFormat: 1 = PCM (Linear quantization)
  view.setUint16(22, 1, true); // NumChannels: 1 = Mono
  view.setUint32(24, targetSampleRate, true); // SampleRate (16000)
  view.setUint32(28, targetSampleRate * 2, true); // ByteRate (SampleRate * NumChannels * BitsPerSample/8)
  view.setUint16(32, 2, true); // BlockAlign (NumChannels * BitsPerSample/8)
  view.setUint16(34, 16, true); // BitsPerSample: 16-bit
  
  // 3. data sub-chunk
  writeString(view, 36, 'data');
  view.setUint32(40, resampled.length * 2, true);

  // 4. PCM Samples (Convert Float32 -1.0..1.0 to Signed 16-bit Int)
  let offset = 44;
  for (let i = 0; i < resampled.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, resampled[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function resampleAudio(
  input: Float32Array,
  fromSampleRate: number,
  toSampleRate: number
): Float32Array {
  if (fromSampleRate === toSampleRate) {
    return input;
  }

  const ratio = fromSampleRate / toSampleRate;
  const newLength = Math.round(input.length / ratio);
  const result = new Float32Array(newLength);

  for (let i = 0; i < newLength; i++) {
    const originIndex = i * ratio;
    const indexFloor = Math.floor(originIndex);
    const indexCeil = Math.min(input.length - 1, indexFloor + 1);
    const weight = originIndex - indexFloor;
    result[i] = input[indexFloor] * (1 - weight) + input[indexCeil] * weight;
  }

  return result;
}
