const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const path = require('path');
const { google } = require('googleapis');

// Initialize Firebase Admin with default credentials (auto-detected on Cloud Run)
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 8080;

// Gmail OAuth config — set these as Cloud Run environment variables
const GMAIL_CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const GMAIL_CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const GMAIL_REDIRECT_URI = process.env.GMAIL_REDIRECT_URI || 'https://cmo-task-manager-951932541878.us-central1.run.app/api/gmail/callback';

app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// === Auth Middleware ===
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.userId = decoded.uid;
    req.userEmail = decoded.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// === Task Endpoints ===

// GET /api/tasks — List all tasks for the authenticated user
app.get('/api/tasks', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('users').doc(req.userId)
      .collection('tasks').orderBy('createdAt', 'desc').get();

    const tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// POST /api/tasks — Create a new task
app.post('/api/tasks', authenticate, async (req, res) => {
  try {
    const task = {
      title: req.body.title,
      department: req.body.department,
      priority: req.body.priority || 'Medium',
      notes: req.body.notes || '',
      status: req.body.status || 'Not Started',
      completed: req.body.status === 'Completed',
      completedAt: req.body.completedAt || '',
      createdAt: req.body.createdAt || new Date().toISOString(),
      source: req.body.source || 'manual',
      attachments: req.body.attachments || [],
      dueDate: req.body.dueDate || '',
      emailMessageId: req.body.emailMessageId || '',
      recurring: req.body.recurring || 'none'
    };

    const docRef = await db.collection('users').doc(req.userId)
      .collection('tasks').add(task);

    res.status(201).json({ id: docRef.id, ...task });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// POST /api/tasks/batch — Bulk import tasks (for localStorage migration)
app.post('/api/tasks/batch', authenticate, async (req, res) => {
  try {
    const tasks = req.body.tasks;
    if (!Array.isArray(tasks)) {
      return res.status(400).json({ error: 'tasks must be an array' });
    }

    const batch = db.batch();
    const tasksRef = db.collection('users').doc(req.userId).collection('tasks');
    const results = [];

    for (const task of tasks) {
      const docRef = tasksRef.doc();
      const taskData = {
        title: task.title,
        department: task.department,
        priority: task.priority || 'Medium',
        notes: task.notes || '',
        status: task.status || 'Not Started',
        completed: task.status === 'Completed',
        completedAt: task.completedAt || '',
        createdAt: task.createdAt || new Date().toISOString(),
        source: task.source || 'manual',
        attachments: task.attachments || [],
        dueDate: task.dueDate || '',
        emailMessageId: task.emailMessageId || '',
        recurring: task.recurring || 'none'
      };
      batch.set(docRef, taskData);
      results.push({ id: docRef.id, ...taskData });
    }

    await batch.commit();
    res.status(201).json({ imported: results.length, tasks: results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to import tasks' });
  }
});

// PUT /api/tasks/:id — Update a task
app.put('/api/tasks/:id', authenticate, async (req, res) => {
  try {
    const taskRef = db.collection('users').doc(req.userId)
      .collection('tasks').doc(req.params.id);

    const doc = await taskRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const updates = {};
    const allowedFields = ['title', 'department', 'priority', 'notes', 'status',
      'completed', 'completedAt', 'dueDate', 'attachments', 'emailMessageId', 'recurring'];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    // Keep completed in sync with status
    if (updates.status) {
      updates.completed = updates.status === 'Completed';
    }

    await taskRef.update(updates);
    res.json({ id: req.params.id, ...doc.data(), ...updates });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE /api/tasks/:id — Delete a task
app.delete('/api/tasks/:id', authenticate, async (req, res) => {
  try {
    const taskRef = db.collection('users').doc(req.userId)
      .collection('tasks').doc(req.params.id);

    const doc = await taskRef.get();
    if (!doc.exists) {
      return res.status(404).json({ error: 'Task not found' });
    }

    await taskRef.delete();
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// === Folder Endpoints ===

// GET /api/folders — List all folders
app.get('/api/folders', authenticate, async (req, res) => {
  try {
    const snapshot = await db.collection('users').doc(req.userId)
      .collection('folders').orderBy('order').get();
    const folders = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Seed default folders if none exist
    if (folders.length === 0) {
      const defaults = ['B2B Marketing', 'Internal Comms', 'Rev Ops', 'B2C Marketing', 'Personal'];
      const batch = db.batch();
      const seeded = [];
      defaults.forEach((name, i) => {
        const ref = db.collection('users').doc(req.userId).collection('folders').doc();
        const folder = { name, order: i, createdAt: new Date().toISOString() };
        batch.set(ref, folder);
        seeded.push({ id: ref.id, ...folder });
      });
      await batch.commit();
      return res.json(seeded);
    }

    res.json(folders);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch folders' });
  }
});

// POST /api/folders — Create a folder
app.post('/api/folders', authenticate, async (req, res) => {
  try {
    const folder = {
      name: req.body.name,
      order: req.body.order || 99,
      createdAt: new Date().toISOString()
    };
    const ref = await db.collection('users').doc(req.userId)
      .collection('folders').add(folder);
    res.status(201).json({ id: ref.id, ...folder });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create folder' });
  }
});

// PUT /api/folders/:id — Update a folder
app.put('/api/folders/:id', authenticate, async (req, res) => {
  try {
    const ref = db.collection('users').doc(req.userId)
      .collection('folders').doc(req.params.id);
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.order !== undefined) updates.order = req.body.order;
    await ref.update(updates);
    res.json({ id: req.params.id, ...updates });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update folder' });
  }
});

// DELETE /api/folders/:id — Delete a folder (only if empty)
app.delete('/api/folders/:id', authenticate, async (req, res) => {
  try {
    const notesInFolder = await db.collection('users').doc(req.userId)
      .collection('notes').where('folderId', '==', req.params.id).limit(1).get();
    if (!notesInFolder.empty) {
      return res.status(400).json({ error: 'Folder is not empty. Delete or move notes first.' });
    }
    await db.collection('users').doc(req.userId)
      .collection('folders').doc(req.params.id).delete();
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete folder' });
  }
});

// === Notes Endpoints ===

// GET /api/notes — List notes (optionally filtered by folderId)
app.get('/api/notes', authenticate, async (req, res) => {
  try {
    let query;
    if (req.query.folderId) {
      // Filter by folder — sort client-side to avoid needing a composite index
      query = db.collection('users').doc(req.userId)
        .collection('notes').where('folderId', '==', req.query.folderId);
    } else {
      query = db.collection('users').doc(req.userId)
        .collection('notes').orderBy('updatedAt', 'desc');
    }
    const snapshot = await query.get();
    const notes = snapshot.docs.map(doc => {
      const d = doc.data();
      return { id: doc.id, title: d.title, folderId: d.folderId, source: d.source, updatedAt: d.updatedAt, createdAt: d.createdAt };
    });
    // Sort by updatedAt descending (needed when filtering by folder since we can't use orderBy with where)
    notes.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    res.json(notes);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// GET /api/notes/:id — Get a single note with full content
app.get('/api/notes/:id', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.userId)
      .collection('notes').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Note not found' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch note' });
  }
});

// POST /api/notes — Create a note
app.post('/api/notes', authenticate, async (req, res) => {
  try {
    const now = new Date().toISOString();
    const note = {
      title: req.body.title || 'Untitled',
      content: req.body.content || '',
      folderId: req.body.folderId || '',
      source: req.body.source || 'manual',
      createdAt: now,
      updatedAt: now,
      aiSummary: ''
    };
    const ref = await db.collection('users').doc(req.userId)
      .collection('notes').add(note);
    res.status(201).json({ id: ref.id, ...note });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create note' });
  }
});

// PUT /api/notes/:id — Update a note
app.put('/api/notes/:id', authenticate, async (req, res) => {
  try {
    const ref = db.collection('users').doc(req.userId)
      .collection('notes').doc(req.params.id);
    const updates = { updatedAt: new Date().toISOString() };
    const allowed = ['title', 'content', 'folderId', 'aiSummary'];
    for (const f of allowed) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    await ref.update(updates);
    res.json({ id: req.params.id, ...updates });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update note' });
  }
});

// DELETE /api/notes/:id — Delete a note
app.delete('/api/notes/:id', authenticate, async (req, res) => {
  try {
    await db.collection('users').doc(req.userId)
      .collection('notes').doc(req.params.id).delete();
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete note' });
  }
});

// === AI Endpoints (Gemini) ===
const { GoogleGenerativeAI } = require('@google/generative-ai');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function getGeminiModel() {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key not configured');
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-lite';
  return genAI.getGenerativeModel({ model: modelName });
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// POST /api/notes/:id/summarize
app.post('/api/notes/:id/summarize', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.userId)
      .collection('notes').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Note not found' });

    const note = doc.data();
    const text = stripHtml(note.content || '');
    if (!text || text.length < 10) return res.status(400).json({ error: 'Note is too short to summarize' });

    const model = getGeminiModel();
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `You are a marketing strategy assistant for a CMO at Follett Higher Education. Summarize the following note concisely. Highlight key decisions, action items, and strategic implications.\n\nNote title: ${note.title}\n\nContent:\n${text}` }] }]
    });

    const summary = result.response.text();

    // Cache the summary
    await db.collection('users').doc(req.userId)
      .collection('notes').doc(req.params.id).update({ aiSummary: summary });

    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: 'Summarize failed: ' + err.message });
  }
});

// POST /api/notes/:id/ask
app.post('/api/notes/:id/ask', authenticate, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });

    const doc = await db.collection('users').doc(req.userId)
      .collection('notes').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Note not found' });

    const note = doc.data();
    const text = stripHtml(note.content || '');

    const model = getGeminiModel();
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `You are a marketing strategy assistant for a CMO. Answer the following question based on this document. Be concise and specific.\n\nDocument title: ${note.title}\n\nDocument content:\n${text}\n\nQuestion: ${question}` }] }]
    });

    res.json({ answer: result.response.text() });
  } catch (err) {
    res.status(500).json({ error: 'Ask failed: ' + err.message });
  }
});

// POST /api/notes/:id/generate-tasks
app.post('/api/notes/:id/generate-tasks', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.userId)
      .collection('notes').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Note not found' });

    const note = doc.data();
    const text = stripHtml(note.content || '');

    const model = getGeminiModel();
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `You are a marketing strategy assistant for a CMO at Follett Higher Education. Extract actionable tasks from the following document. Return ONLY a JSON array (no markdown, no code fences) where each item has:\n- "title": string (concise task description)\n- "department": one of "B2B Marketing", "Internal Comms", "Rev Ops", "B2C Marketing", "Personal"\n- "priority": one of "High", "Medium", "Low"\n- "notes": string (brief context from the document)\n\nOnly include genuinely actionable items. If there are no actionable items, return an empty array [].\n\nDocument title: ${note.title}\n\nContent:\n${text}` }] }]
    });

    let tasksJson;
    const responseText = result.response.text().trim();
    // Strip markdown code fences if present
    const cleaned = responseText.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
    try {
      tasksJson = JSON.parse(cleaned);
    } catch {
      return res.status(400).json({ error: 'AI returned invalid format. Try again.' });
    }

    res.json({ tasks: tasksJson });
  } catch (err) {
    res.status(500).json({ error: 'Generate tasks failed: ' + err.message });
  }
});

// === Global AI Chat ===
app.post('/api/ai/chat', authenticate, async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    // Gather all tasks
    const tasksSnap = await db.collection('users').doc(req.userId)
      .collection('tasks').orderBy('createdAt', 'desc').get();
    const allTasks = tasksSnap.docs.map(d => {
      const t = d.data();
      return `[${t.status}] ${t.title} | Dept: ${t.department} | Priority: ${t.priority}${t.dueDate ? ' | Due: ' + t.dueDate : ''}${t.notes ? ' | Notes: ' + t.notes.substring(0, 200) : ''}`;
    });

    // Gather all notes (titles + truncated content)
    const notesSnap = await db.collection('users').doc(req.userId)
      .collection('notes').get();
    const foldersSnap = await db.collection('users').doc(req.userId)
      .collection('folders').get();
    const folderMap = {};
    foldersSnap.docs.forEach(d => { folderMap[d.id] = d.data().name; });

    const allNotes = notesSnap.docs.map(d => {
      const n = d.data();
      const folder = folderMap[n.folderId] || 'Unfiled';
      const content = stripHtml(n.content || '').substring(0, 500);
      return `[${folder}] ${n.title}\n${content}`;
    });

    const today = new Date().toISOString().split('T')[0];

    const systemPrompt = `You are an AI assistant for Leann, a CMO at Follett Higher Education. You have access to her complete task list and strategy notes. Be concise, actionable, and strategic. Today's date is ${today}.

TASKS (${allTasks.length} total):
${allTasks.join('\n')}

NOTES (${allNotes.length} total):
${allNotes.join('\n---\n')}`;

    const model = getGeminiModel();

    // Build conversation with history
    const contents = [];
    if (history && Array.isArray(history)) {
      for (const h of history) {
        contents.push({ role: h.role === 'user' ? 'user' : 'model', parts: [{ text: h.text }] });
      }
    }
    contents.push({ role: 'user', parts: [{ text: message }] });

    const result = await model.generateContent({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents
    });

    res.json({ reply: result.response.text() });
  } catch (err) {
    res.status(500).json({ error: 'AI chat failed: ' + err.message });
  }
});

// === Gmail OAuth Endpoints ===

function createOAuth2Client() {
  return new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI);
}

// GET /api/gmail/status — Check if Gmail inbox is connected
app.get('/api/gmail/status', authenticate, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.userId).get();
    const data = doc.exists ? doc.data() : {};
    res.json({ connected: !!data.gmailRefreshToken, email: data.gmailEmail || '' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check Gmail status' });
  }
});

// GET /api/gmail/auth — Start OAuth flow for CMOtaskinbox Gmail
app.get('/api/gmail/auth', authenticate, async (req, res) => {
  const oauth2Client = createOAuth2Client();
  const state = Buffer.from(JSON.stringify({ userId: req.userId })).toString('base64');
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.modify'],
    state
  });
  res.json({ url });
});

// GET /api/gmail/callback — OAuth callback (redirected from Google)
app.get('/api/gmail/callback', async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return res.status(400).send('Missing code or state');
    }

    const { userId } = JSON.parse(Buffer.from(state, 'base64').toString());
    const oauth2Client = createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });

    await db.collection('users').doc(userId).set({
      gmailRefreshToken: tokens.refresh_token,
      gmailEmail: profile.data.emailAddress
    }, { merge: true });

    res.send('<html><body><h2>Gmail connected successfully!</h2><p>You can close this tab and go back to the app.</p><script>window.close();</script></body></html>');
  } catch (err) {
    res.status(500).send('Gmail authorization failed: ' + err.message);
  }
});

// POST /api/gmail/disconnect — Remove Gmail connection
app.post('/api/gmail/disconnect', authenticate, async (req, res) => {
  try {
    await db.collection('users').doc(req.userId).set({
      gmailRefreshToken: admin.firestore.FieldValue.delete(),
      gmailEmail: admin.firestore.FieldValue.delete()
    }, { merge: true });
    res.json({ disconnected: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

// Department detection helper
const DEPT_KEYWORDS = {
  'B2B Marketing': ['b2b', 'enterprise', 'account-based', 'abm', 'lead gen', 'demand gen', 'webinar', 'linkedin'],
  'Internal Comms': ['internal', 'comms', 'newsletter', 'all-hands', 'town hall', 'employee'],
  'Rev Ops': ['rev ops', 'revenue', 'operations', 'hubspot', 'salesforce', 'crm', 'pipeline', 'analytics'],
  'B2C Marketing': ['b2c', 'consumer', 'social media', 'instagram', 'tiktok', 'influencer', 'brand', 'campaign', 'seo']
};

function detectDept(text) {
  const lower = text.toLowerCase();
  let best = '', score = 0;
  for (const [dept, kws] of Object.entries(DEPT_KEYWORDS)) {
    let s = 0;
    for (const kw of kws) { if (lower.includes(kw)) s++; }
    if (s > score) { score = s; best = dept; }
  }
  return best || 'B2B Marketing';
}

// POST /api/sync — Sync emails from connected Gmail inbox
app.post('/api/sync', authenticate, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    if (!userData.gmailRefreshToken) {
      return res.status(400).json({ error: 'Gmail not connected. Click "Connect Gmail" first.' });
    }

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: userData.gmailRefreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const existingSnapshot = await db.collection('users').doc(req.userId)
      .collection('tasks').where('source', '==', 'email').get();

    const existingIds = new Set();
    existingSnapshot.forEach(doc => {
      const t = doc.data();
      if (t.emailMessageId) existingIds.add(t.emailMessageId);
    });

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: 'newer_than:7d',
      maxResults: 50
    });

    const messages = listRes.data.messages || [];
    let newCount = 0;
    const batch = db.batch();
    const tasksRef = db.collection('users').doc(req.userId).collection('tasks');

    for (const msg of messages) {
      if (existingIds.has(msg.id)) continue;

      const fullMsg = await gmail.users.messages.get({
        userId: 'me',
        id: msg.id,
        format: 'full'
      });

      const headers = fullMsg.data.payload.headers;
      const getHeader = (name) => (headers.find(h => h.name.toLowerCase() === name.toLowerCase()) || {}).value || '';

      let subject = getHeader('Subject').replace(/^(Fw|Fwd|FW|RE|Re):\s*/i, '');
      const from = getHeader('From');
      const date = getHeader('Date');

      let body = '';
      const payload = fullMsg.data.payload;
      if (payload.parts) {
        const textPart = payload.parts.find(p => p.mimeType === 'text/plain');
        if (textPart && textPart.body.data) {
          body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        }
      } else if (payload.body && payload.body.data) {
        body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
      }

      if (body.length > 5000) body = body.substring(0, 5000) + '\n\n[Truncated]';

      const notes = (from ? `From: ${from}\n` : '') + (date ? `Date: ${date}\n\n` : '\n') + body;

      const docRef = tasksRef.doc();
      batch.set(docRef, {
        title: subject || 'Forwarded email',
        department: detectDept(subject + ' ' + body),
        priority: 'Medium',
        notes,
        status: 'Not Started',
        completed: false,
        completedAt: '',
        createdAt: new Date().toISOString(),
        source: 'email',
        attachments: [],
        dueDate: '',
        emailMessageId: msg.id
      });
      newCount++;
    }

    if (newCount > 0) await batch.commit();
    res.json({ synced: newCount });
  } catch (err) {
    res.status(500).json({ error: 'Sync failed: ' + err.message });
  }
});

// Fallback: serve index.html for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`CMO Task Manager running on port ${PORT}`);
});
