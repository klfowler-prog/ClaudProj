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
      emailMessageId: req.body.emailMessageId || ''
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
        emailMessageId: task.emailMessageId || ''
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
      'completed', 'completedAt', 'dueDate', 'attachments', 'emailMessageId'];

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
  // Store the user's Firebase UID in state so we can link it after callback
  const state = Buffer.from(JSON.stringify({ userId: req.userId })).toString('base64');
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
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

    // Get the Gmail email address
    oauth2Client.setCredentials(tokens);
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const profile = await gmail.users.getProfile({ userId: 'me' });

    // Store refresh token in Firestore under the user's doc
    await db.collection('users').doc(userId).set({
      gmailRefreshToken: tokens.refresh_token,
      gmailEmail: profile.data.emailAddress
    }, { merge: true });

    // Redirect back to the app with success message
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
    // Get stored refresh token
    const userDoc = await db.collection('users').doc(req.userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    if (!userData.gmailRefreshToken) {
      return res.status(400).json({ error: 'Gmail not connected. Click "Connect Gmail" first.' });
    }

    // Set up Gmail API client
    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: userData.gmailRefreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get existing email message IDs to prevent duplicates
    const existingSnapshot = await db.collection('users').doc(req.userId)
      .collection('tasks').where('source', '==', 'email').get();

    const existingIds = new Set();
    existingSnapshot.forEach(doc => {
      const t = doc.data();
      if (t.emailMessageId) existingIds.add(t.emailMessageId);
    });

    // Fetch recent unread messages
    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread',
      maxResults: 50
    });

    const messages = listRes.data.messages || [];
    let newCount = 0;
    const batch = db.batch();
    const tasksRef = db.collection('users').doc(req.userId).collection('tasks');

    for (const msg of messages) {
      if (existingIds.has(msg.id)) continue;

      // Fetch full message
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

      // Extract body text
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

      // Mark as read
      await gmail.users.messages.modify({
        userId: 'me',
        id: msg.id,
        requestBody: { removeLabelIds: ['UNREAD'] }
      });
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
