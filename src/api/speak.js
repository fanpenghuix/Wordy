import express from 'express';
import textToSpeech from '@google-cloud/text-to-speech';

const router = express.Router();
const client = new textToSpeech.TextToSpeechClient();

// Chirp 3 HD voices for British English
const VOICES = {
  female: [
    { name: 'en-GB-Chirp3-HD-Achernar', gender: 'female' },
    { name: 'en-GB-Chirp3-HD-Aoede', gender: 'female' },
    { name: 'en-GB-Chirp3-HD-Autonoe', gender: 'female' },
    { name: 'en-GB-Chirp3-HD-Callirrhoe', gender: 'female' },
    { name: 'en-GB-Chirp3-HD-Despina', gender: 'female' },
    { name: 'en-GB-Chirp3-HD-Erinome', gender: 'female' },
    { name: 'en-GB-Chirp3-HD-Gacrux', gender: 'female' },
    { name: 'en-GB-Chirp3-HD-Kore', gender: 'female' },
    { name: 'en-GB-Chirp3-HD-Laomedeia', gender: 'female' },
    { name: 'en-GB-Chirp3-HD-Leda', gender: 'female' },
    { name: 'en-GB-Chirp3-HD-Pulcherrima', gender: 'female' },
    { name: 'en-GB-Chirp3-HD-Sulafat', gender: 'female' },
    { name: 'en-GB-Chirp3-HD-Vindemiatrix', gender: 'female' },
    { name: 'en-GB-Chirp3-HD-Zephyr', gender: 'female' },
  ],
  male: [
    { name: 'en-GB-Chirp3-HD-Achird', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Algenib', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Algieba', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Alnilam', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Charon', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Enceladus', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Fenrir', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Iapetus', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Orus', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Puck', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Rasalgethi', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Sadachbia', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Sadaltager', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Schedar', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Umbriel', gender: 'male' },
    { name: 'en-GB-Chirp3-HD-Zubenelgenubi', gender: 'male' },
  ],
};

// List available voices
router.get('/voices', (req, res) => {
  const gender = req.query.gender || 'female';
  const voices = VOICES[gender] || VOICES.female;
  res.json(voices.map(v => ({ name: v.name, gender: v.gender })));
});

// Generate speech audio
router.post('/speak', async (req, res) => {
  const { text, voice, speed } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }

  try {
    const request = {
      input: { text },
      voice: {
        languageCode: 'en-GB',
        name: voice || 'en-GB-Chirp3-HD-Achird',
      },
      audioConfig: {
        audioEncoding: 'MP3',
        speakingRate: speed || 0.85,
      },
    };

    const [response] = await client.synthesizeSpeech(request);
    res.set('Content-Type', 'audio/mpeg');
    res.send(response.audioContent);
  } catch (err) {
    console.error('Google TTS error:', err.message);
    res.status(500).json({ error: 'Failed to generate speech' });
  }
});

export default router;
