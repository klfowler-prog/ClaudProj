const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const path = require('path');

// Initialize Firebase Admin with default credentials (auto-detected on Cloud Run)
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

const db = admin.firestore();
const app = express();
const PORT = process.env.PORT || 8080;

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

// POST /api/sync — Server-side email sync from Google Sheet
app.post('/api/sync', authenticate, async (req, res) => {
  try {
    const sheetUrl = req.body.sheetUrl;
    if (!sheetUrl) {
      return res.status(400).json({ error: 'sheetUrl is required' });
    }

    const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) {
      return res.status(400).json({ error: 'Invalid Google Sheet URL' });
    }

    const sheetId = match[1];
    const gvizUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json`;

    const fetch = (await import('node-fetch')).default;
    const response = await fetch(gvizUrl);
    const text = await response.text();
    const jsonStr = text.match(/google\.visualization\.Query\.setResponse\((.+)\)/);
    if (!jsonStr) {
      return res.status(400).json({ error: 'Could not parse sheet data' });
    }

    const data = JSON.parse(jsonStr[1]);
    const rows = data.table.rows;

    // Get existing email message IDs and subjects to prevent duplicates
    const existingSnapshot = await db.collection('users').doc(req.userId)
      .collection('tasks').where('source', '==', 'email').get();

    const existingKeys = new Set();
    existingSnapshot.forEach(doc => {
      const t = doc.data();
      if (t.emailMessageId) existingKeys.add(t.emailMessageId);
      existingKeys.add((t.title || '').toLowerCase().trim());
    });

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

    let newCount = 0;
    const batch = db.batch();
    const tasksRef = db.collection('users').doc(req.userId).collection('tasks');

    for (let i = 0; i < rows.length; i++) {
      const cells = rows[i].c;
      if (!cells || !cells[0]) continue;

      const subject = (cells[0] && cells[0].v) || 'Forwarded email';
      const from = (cells[1] && cells[1].v) || '';
      const body = (cells[2] && cells[2].v) || '';
      const timestamp = (cells[3] && cells[3].v) || '';
      const messageId = (cells[4] && cells[4].v) || '';

      if (messageId && existingKeys.has(messageId)) continue;
      if (existingKeys.has(subject.toLowerCase().trim())) continue;

      const notes = (from ? `From: ${from}\n` : '') + (timestamp ? `Date: ${timestamp}\n\n` : '\n') + body;

      const docRef = tasksRef.doc();
      batch.set(docRef, {
        title: subject,
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
        emailMessageId: messageId
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
