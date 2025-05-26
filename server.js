require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'qsdfghjklmazertyuiopwxcvbn1234567890';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Configuration MongoDB
mongoose
  .connect(process.env.MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    serverSelectionTimeoutMS: 5000,
  })
  .then(() => {
    console.log("✅ Connecté à MongoDB Atlas");
    console.log(`📊 Base de données: ${mongoose.connection.db.databaseName}`);
    console.log(`🌐 Hôte: ${mongoose.connection.host}`);
  })
  .catch((err) => {
    console.error("❌ Erreur de connexion à MongoDB:", err);
  });

// Schémas MongoDB
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const voiceNoteSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  audioPath: { type: String, required: true },
  duration: { type: Number, required: true },
  status: { type: String, enum: ['sent', 'read', 'deleted'], default: 'sent' },
  createdAt: { type: Date, default: Date.now },
  readAt: { type: Date }
});

voiceNoteSchema.index({ from: 1, to: 1, status: 1 }, { 
  unique: true, 
  partialFilterExpression: { status: 'sent' } 
});

const User = mongoose.model('User', userSchema);
const VoiceNote = mongoose.model('VoiceNote', voiceNoteSchema);

// Configuration Multer
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    await createUploadsDir();
    cb(null, path.resolve('uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueName = `voice_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.webm`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers audio sont autorisés'));
    }
  }
});

// Middleware d'authentification
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token d\'accès requis' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token invalide' });
    }
    req.user = user;
    next();
  });
};

// Créer le dossier uploads
const createUploadsDir = async () => {
  try {
    await fs.access('uploads');
  } catch {
    await fs.mkdir('uploads');
  }
};

// Démarrer le serveur
const server = app.listen(PORT, () => {
  console.log(`Serveur démarré sur le port ${PORT}`);
  console.log(`Interface disponible sur http://localhost:${PORT}`);
});

// WebSocket Server
const wss = new WebSocket.Server({ server });

// Stockage des clients connectés
const clients = new Map();

wss.on('connection', (ws) => {
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'auth') {
        try {
          const user = jwt.verify(data.token, JWT_SECRET);
          clients.set(user.username, ws);
          ws.username = user.username;
        } catch (err) {
          ws.close();
        }
      }
    } catch (err) {
      console.error('Erreur traitement message WS:', err);
    }
  });

  ws.on('close', () => {
    if (ws.username) {
      clients.delete(ws.username);
    }
  });
});

// Fonction pour diffuser une note vocale
function broadcastVoiceNote(note, recipientUsername) {
  const client = clients.get(recipientUsername);
  if (client && client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify({
      type: 'newVoiceNote',
      note
    }));
  }
}

// Routes
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Tous les champs sont requis' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Le mot de passe doit contenir au moins 6 caractères' });
    }

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ error: 'Utilisateur ou email déjà existant' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({ username, email, password: hashedPassword });
    await user.save();

    res.status(201).json({ message: 'Inscription réussie! Veuillez vous connecter' });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur lors de l\'inscription' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    const user = await User.findOne({ username });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Identifiants incorrects' });
    }

    const token = jwt.sign({ userId: user._id, username: user.username }, JWT_SECRET);
    res.json({ message: 'Connexion réussie', token, username });
  } catch (error) {
    res.status(500).json({ error: 'Erreur serveur lors de la connexion' });
  }
});

app.post('/api/voice-notes', authenticateToken, upload.single('audio'), async (req, res) => {
  try {
    const { to, duration } = req.body;
    const from = req.user.username;

    if (!to || !req.file || !duration) {
      return res.status(400).json({ error: 'Destinataire, fichier audio et durée requis' });
    }

    if (parseFloat(duration) > 60) {
      await fs.unlink(req.file.path);
      return res.status(400).json({ error: 'La note vocale ne peut pas dépasser 60 secondes' });
    }

    const recipient = await User.findOne({ username: to });
    if (!recipient) {
      await fs.unlink(req.file.path);
      return res.status(404).json({ error: 'Destinataire introuvable' });
    }

    if (from === to) {
      await fs.unlink(req.file.path);
      return res.status(400).json({ error: 'Vous ne pouvez pas vous envoyer une note à vous-même' });
    }

    const existingNote = await VoiceNote.findOne({ 
      from, 
      to, 
      status: { $in: ['sent', 'read'] } 
    });
    if (existingNote) {
      await fs.unlink(req.file.path);
      return res.status(400).json({ error: 'Une note non lue existe déjà pour ce destinataire' });
    }

    const voiceNote = new VoiceNote({
      from,
      to,
      audioPath: req.file.path,
      duration: parseFloat(duration)
    });

    await voiceNote.save();
    
    broadcastVoiceNote({
      from: voiceNote.from,
      createdAt: voiceNote.createdAt,
      duration: voiceNote.duration,
      _id: voiceNote._id
    }, voiceNote.to);

    res.status(201).json({ message: 'Note vocale envoyée avec succès' });
  } catch (error) {
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: 'Erreur lors de l\'envoi de la note vocale' });
  }
});

app.get('/api/voice-notes/received', authenticateToken, async (req, res) => {
  try {
    const notes = await VoiceNote.find({ 
      to: req.user.username, 
      status: 'sent' 
    }).select('from createdAt duration _id');
    
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des notes' });
  }
});

app.get('/api/voice-notes/sent', authenticateToken, async (req, res) => {
  try {
    const notes = await VoiceNote.find({ 
      from: req.user.username 
    }).select('to status createdAt duration');
    
    res.json(notes);
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la récupération des notes envoyées' });
  }
});

app.get("/api/voice-notes/:id/audio", async (req, res) => {
  try {
    const token = req.query.token || req.headers['authorization']?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ error: "Token d'accès requis" });
    }

    const user = jwt.verify(token, JWT_SECRET);
    
    const note = await VoiceNote.findById(req.params.id);
    if (!note) {
      return res.status(404).json({ error: "Note introuvable" });
    }

    if (note.to !== user.username) {
      return res.status(403).json({ error: "Accès non autorisé" });
    }

    if (note.status !== "sent") {
      return res.status(400).json({ error: "Cette note a déjà été lue ou supprimée" });
    }

    note.status = "read";
    note.readAt = new Date();
    await note.save();

    res.sendFile(path.resolve(note.audioPath), async (err) => {
      if (err) {
        console.error("Erreur envoi fichier:", err);
        try {
          await fs.unlink(note.audioPath);
          await VoiceNote.findByIdAndUpdate(note._id, { status: "deleted" });
        } catch (deleteError) {
          console.error("Erreur suppression:", deleteError);
        }
      }

      req.on("close", async () => {
        try {
          await fs.unlink(note.audioPath);
          await VoiceNote.findByIdAndUpdate(note._id, { status: "deleted" });
        } catch (deleteError) {
          console.error("Erreur suppression:", deleteError);
        }
      });
    });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la lecture de la note" });
  }
});

app.get('/api/users/search/:username', authenticateToken, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username }).select('username');
    if (user) {
      res.json({ exists: true, username: user.username });
    } else {
      res.json({ exists: false });
    }
  } catch (error) {
    res.status(500).json({ error: 'Erreur lors de la recherche' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Nettoyage des anciennes notes
const cleanupOldNotes = async () => {
  try {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const oldNotes = await VoiceNote.find({ 
      createdAt: { $lt: oneDayAgo },
      status: { $ne: 'deleted' }
    });

    for (const note of oldNotes) {
      try {
        await fs.unlink(note.audioPath);
      } catch (unlinkError) {
        console.log('Fichier déjà supprimé:', note.audioPath);
      }
      await VoiceNote.findByIdAndUpdate(note._id, { status: 'deleted' });
    }

    console.log(`Nettoyage: ${oldNotes.length} notes supprimées`);
  } catch (error) {
    console.error('Erreur nettoyage:', error);
  }
};

setInterval(cleanupOldNotes, 60 * 60 * 1000);
createUploadsDir().catch(err => {
  console.error('Erreur création dossier uploads:', err);
});
