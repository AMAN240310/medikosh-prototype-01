import multer from 'multer';

const storage = multer.memoryStorage();

export const audioUpload = multer({
  storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // 15MB limit
  },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype.startsWith('audio/') ||
      file.mimetype.startsWith('video/') ||
      file.mimetype === 'application/octet-stream' ||
      file.mimetype.includes('webm') ||
      file.mimetype.includes('ogg') ||
      file.mimetype.includes('wav')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Invalid audio format. Please provide audio/webm, audio/wav, audio/ogg, or mp3.'));
    }
  },
});
