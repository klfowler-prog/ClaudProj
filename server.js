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
    req.userName = decoded.name || decoded.email;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// === Org Resolution Middleware ===
// Uses users/{userId} doc to store orgId for fast lookup (no collectionGroup index needed)
async function resolveOrg(req, res, next) {
  try {
    // Check if user already has an orgId stored
    const userDoc = await db.collection('users').doc(req.userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    if (userData.orgId) {
      // Known user — look up their member record
      const memberDoc = await db.collection('orgs').doc(userData.orgId)
        .collection('members').doc(req.userId).get();

      if (memberDoc.exists && memberDoc.data().status === 'active') {
        const m = memberDoc.data();
        req.orgId = userData.orgId;
        req.memberRole = m.role;
        req.memberDept = m.department;
        req.memberName = m.displayName;
        return next();
      }
    }

    // Check if this user was invited (member doc exists in some org but user doc doesn't have orgId yet)
    // Search all orgs for a member with this userId
    const orgsSnap = await db.collection('orgs').get();
    for (const orgDoc of orgsSnap.docs) {
      const memberDoc = await orgDoc.ref.collection('members').doc(req.userId).get();
      if (memberDoc.exists && memberDoc.data().status === 'active') {
        const m = memberDoc.data();
        // Store orgId on user doc for fast future lookups
        await db.collection('users').doc(req.userId).set({ orgId: orgDoc.id }, { merge: true });
        req.orgId = orgDoc.id;
        req.memberRole = m.role;
        req.memberDept = m.department;
        req.memberName = m.displayName;
        return next();
      }
    }

    // No org found — create one (first-time CMO setup)
    const legacyTasks = await db.collection('users').doc(req.userId).collection('tasks').limit(1).get();
    const hasLegacyData = !legacyTasks.empty;

    const orgRef = db.collection('orgs').doc();
    await orgRef.set({ name: 'Follett Marketing', createdAt: new Date().toISOString(), createdBy: req.userId });

    await orgRef.collection('members').doc(req.userId).set({
      userId: req.userId, email: req.userEmail, displayName: req.userName,
      role: 'cmo', department: 'all', status: 'active', joinedAt: new Date().toISOString()
    });

    // Store orgId on user doc
    await db.collection('users').doc(req.userId).set({ orgId: orgRef.id }, { merge: true });

    req.orgId = orgRef.id;
    req.memberRole = 'cmo';
    req.memberDept = 'all';
    req.memberName = req.userName;

    if (hasLegacyData) await migrateLegacyData(req.userId, orgRef.id);

    // Seed default folders
    const defaults = ['B2B Marketing', 'Internal Comms', 'Rev Ops', 'B2C Marketing', 'Personal'];
    const batch = db.batch();
    defaults.forEach((name, i) => {
      const ref = orgRef.collection('folders').doc();
      batch.set(ref, { name, order: i, createdAt: new Date().toISOString() });
    });
    await batch.commit();

    next();
  } catch (err) {
    console.error('Org resolution failed:', err);
    res.status(500).json({ error: 'Failed to resolve organization' });
  }
}

async function migrateLegacyData(userId, orgId) {
  const orgRef = db.collection('orgs').doc(orgId);
  const userRef = db.collection('users').doc(userId);

  // Migrate tasks
  const tasksSnap = await userRef.collection('tasks').get();
  for (const doc of tasksSnap.docs) {
    await orgRef.collection('tasks').doc(doc.id).set({
      ...doc.data(),
      createdBy: userId,
      assignedTo: userId,
      sharedWith: []
    });
  }

  // Migrate notes
  const notesSnap = await userRef.collection('notes').get();
  for (const doc of notesSnap.docs) {
    await orgRef.collection('notes').doc(doc.id).set({
      ...doc.data(),
      createdBy: userId
    });
  }

  // Migrate folders
  const foldersSnap = await userRef.collection('folders').get();
  for (const doc of foldersSnap.docs) {
    await orgRef.collection('folders').doc(doc.id).set(doc.data());
  }
}

// Helper: org-scoped collection reference
function orgCol(req, collection) {
  return db.collection('orgs').doc(req.orgId).collection(collection);
}

// Shorthand middleware chain
const auth = [authenticate, resolveOrg];

// === Task Endpoints ===

// GET /api/tasks — List tasks (filtered by role/department)
app.get('/api/tasks', auth, async (req, res) => {
  try {
    const snapshot = await orgCol(req, 'tasks').orderBy('createdAt', 'desc').get();
    let tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Filter by role: CMO sees all, others see their dept + assigned/shared
    if (req.memberRole !== 'cmo') {
      tasks = tasks.filter(t =>
        t.department === req.memberDept ||
        t.assignedTo === req.userId ||
        (t.sharedWith && t.sharedWith.includes(req.userId)) ||
        t.createdBy === req.userId
      );
    }

    // Optional: filter to "my tasks" only
    if (req.query.mine === 'true') {
      tasks = tasks.filter(t => t.assignedTo === req.userId || t.createdBy === req.userId);
    }

    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// POST /api/tasks — Create a new task
app.post('/api/tasks', auth, async (req, res) => {
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
      recurring: req.body.recurring || 'none',
      createdBy: req.userId,
      assignedTo: req.body.assignedTo || req.userId,
      sharedWith: req.body.sharedWith || []
    };

    const docRef = await orgCol(req, 'tasks').add(task);
    const created = { id: docRef.id, ...task };

    // Send notification if assigned to someone else
    if (task.assignedTo && task.assignedTo !== req.userId) {
      await createNotification(req.orgId, task.assignedTo, {
        type: 'task_assigned',
        title: `${req.memberName} assigned you: ${task.title}`,
        taskId: docRef.id,
        fromUserId: req.userId,
        fromName: req.memberName
      });
    }

    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: 'Failed to create task' });
  }
});

// POST /api/tasks/batch — Bulk import tasks
app.post('/api/tasks/batch', auth, async (req, res) => {
  try {
    const tasks = req.body.tasks;
    if (!Array.isArray(tasks)) return res.status(400).json({ error: 'tasks must be an array' });

    const batch = db.batch();
    const tasksRef = orgCol(req, 'tasks');
    const results = [];

    for (const task of tasks) {
      const docRef = tasksRef.doc();
      const taskData = {
        title: task.title, department: task.department,
        priority: task.priority || 'Medium', notes: task.notes || '',
        status: task.status || 'Not Started', completed: task.status === 'Completed',
        completedAt: task.completedAt || '', createdAt: task.createdAt || new Date().toISOString(),
        source: task.source || 'manual', attachments: task.attachments || [],
        dueDate: task.dueDate || '', emailMessageId: task.emailMessageId || '',
        recurring: task.recurring || 'none',
        createdBy: req.userId, assignedTo: task.assignedTo || req.userId, sharedWith: []
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
app.put('/api/tasks/:id', auth, async (req, res) => {
  try {
    const taskRef = orgCol(req, 'tasks').doc(req.params.id);
    const doc = await taskRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Task not found' });

    const oldTask = doc.data();
    const updates = {};
    const allowedFields = ['title', 'department', 'priority', 'notes', 'status',
      'completed', 'completedAt', 'dueDate', 'attachments', 'emailMessageId', 'recurring',
      'assignedTo', 'sharedWith'];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (updates.status) updates.completed = updates.status === 'Completed';

    await taskRef.update(updates);

    // Notify if assignedTo changed to someone new
    if (updates.assignedTo && updates.assignedTo !== oldTask.assignedTo && updates.assignedTo !== req.userId) {
      await createNotification(req.orgId, updates.assignedTo, {
        type: 'task_assigned',
        title: `${req.memberName} assigned you: ${oldTask.title}`,
        taskId: req.params.id,
        fromUserId: req.userId,
        fromName: req.memberName
      });
    }

    res.json({ id: req.params.id, ...oldTask, ...updates });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE /api/tasks/:id — Delete a task
app.delete('/api/tasks/:id', auth, async (req, res) => {
  try {
    const taskRef = orgCol(req, 'tasks').doc(req.params.id);
    const doc = await taskRef.get();
    if (!doc.exists) return res.status(404).json({ error: 'Task not found' });
    await taskRef.delete();
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

// === Folder Endpoints ===

app.get('/api/folders', auth, async (req, res) => {
  try {
    const snapshot = await orgCol(req, 'folders').orderBy('order').get();
    res.json(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
  } catch (err) { res.status(500).json({ error: 'Failed to fetch folders' }); }
});

app.post('/api/folders', auth, async (req, res) => {
  try {
    const folder = { name: req.body.name, order: req.body.order || 99, createdAt: new Date().toISOString() };
    const ref = await orgCol(req, 'folders').add(folder);
    res.status(201).json({ id: ref.id, ...folder });
  } catch (err) { res.status(500).json({ error: 'Failed to create folder' }); }
});

app.put('/api/folders/:id', auth, async (req, res) => {
  try {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.order !== undefined) updates.order = req.body.order;
    await orgCol(req, 'folders').doc(req.params.id).update(updates);
    res.json({ id: req.params.id, ...updates });
  } catch (err) { res.status(500).json({ error: 'Failed to update folder' }); }
});

app.delete('/api/folders/:id', auth, async (req, res) => {
  try {
    const notesInFolder = await orgCol(req, 'notes').where('folderId', '==', req.params.id).limit(1).get();
    if (!notesInFolder.empty) return res.status(400).json({ error: 'Folder not empty' });
    await orgCol(req, 'folders').doc(req.params.id).delete();
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: 'Failed to delete folder' }); }
});

// === Notes Endpoints ===

app.get('/api/notes', auth, async (req, res) => {
  try {
    let query;
    if (req.query.folderId) {
      query = orgCol(req, 'notes').where('folderId', '==', req.query.folderId);
    } else {
      query = orgCol(req, 'notes').orderBy('updatedAt', 'desc');
    }
    const snapshot = await query.get();

    // Build author name lookup from members
    const membersSnap = await orgCol(req, 'members').get();
    const memberNames = {};
    membersSnap.docs.forEach(d => { memberNames[d.id] = d.data().displayName || d.data().email; });

    let notes = snapshot.docs.map(doc => {
      const d = doc.data();
      return {
        id: doc.id, title: d.title, folderId: d.folderId, source: d.source,
        updatedAt: d.updatedAt, createdAt: d.createdAt, createdBy: d.createdBy,
        sharedWith: d.sharedWith || [],
        authorName: memberNames[d.createdBy] || 'Unknown'
      };
    });

    // Notes are private: only show your own notes + notes shared with you
    // CMO sees all. Optional: ?mine=true to filter to own notes only
    if (req.memberRole !== 'cmo') {
      notes = notes.filter(n =>
        n.createdBy === req.userId ||
        (n.sharedWith && n.sharedWith.includes(req.userId))
      );
    }
    if (req.query.mine === 'true') {
      notes = notes.filter(n => n.createdBy === req.userId);
    }

    notes.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    res.json(notes);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch notes' }); }
});

app.get('/api/notes/:id', auth, async (req, res) => {
  try {
    const doc = await orgCol(req, 'notes').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Note not found' });
    const note = doc.data();
    // Non-CMO can only read their own notes or notes shared with them
    if (req.memberRole !== 'cmo' && note.createdBy !== req.userId && !(note.sharedWith || []).includes(req.userId)) {
      return res.status(403).json({ error: 'Access denied' });
    }
    res.json({ id: doc.id, ...note });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch note' }); }
});

app.post('/api/notes', auth, async (req, res) => {
  try {
    const now = new Date().toISOString();
    const note = {
      title: req.body.title || 'Untitled', content: req.body.content || '',
      folderId: req.body.folderId || '', source: req.body.source || 'manual',
      createdAt: now, updatedAt: now, aiSummary: '', createdBy: req.userId
    };
    const ref = await orgCol(req, 'notes').add(note);
    res.status(201).json({ id: ref.id, ...note });
  } catch (err) { res.status(500).json({ error: 'Failed to create note' }); }
});

app.put('/api/notes/:id', auth, async (req, res) => {
  try {
    const ref = orgCol(req, 'notes').doc(req.params.id);
    const updates = { updatedAt: new Date().toISOString() };
    const allowed = ['title', 'content', 'folderId', 'aiSummary'];
    for (const f of allowed) { if (req.body[f] !== undefined) updates[f] = req.body[f]; }
    await ref.update(updates);
    res.json({ id: req.params.id, ...updates });
  } catch (err) { res.status(500).json({ error: 'Failed to update note' }); }
});

app.delete('/api/notes/:id', auth, async (req, res) => {
  try {
    await orgCol(req, 'notes').doc(req.params.id).delete();
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: 'Failed to delete note' }); }
});

// === AI Endpoints (Gemini) ===
const { GoogleGenerativeAI } = require('@google/generative-ai');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function getGeminiModel() {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key not configured');
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
  return genAI.getGenerativeModel({ model: modelName });
}

function stripHtml(html) {
  return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

// POST /api/notes/:id/summarize
app.post('/api/notes/:id/summarize', auth, async (req, res) => {
  try {
    const doc = await orgCol(req, 'notes').doc(req.params.id).get();
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
    await orgCol(req, 'notes').doc(req.params.id).update({ aiSummary: summary });

    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: 'Summarize failed: ' + err.message });
  }
});

// POST /api/notes/:id/ask
app.post('/api/notes/:id/ask', auth, async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Question is required' });

    const doc = await orgCol(req, 'notes').doc(req.params.id).get();
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
app.post('/api/notes/:id/generate-tasks', auth, async (req, res) => {
  try {
    const doc = await orgCol(req, 'notes').doc(req.params.id).get();
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
app.post('/api/ai/chat', auth, async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    // Gather all tasks (CMO sees all, others see their dept)
    const tasksSnap = await orgCol(req, 'tasks').orderBy('createdAt', 'desc').get();
    const allTasks = tasksSnap.docs.map(d => {
      const t = d.data();
      return `[${t.status}] ${t.title} | Dept: ${t.department} | Priority: ${t.priority}${t.dueDate ? ' | Due: ' + t.dueDate : ''}${t.notes ? ' | Notes: ' + t.notes.substring(0, 200) : ''}`;
    });

    // Gather all notes (titles + truncated content)
    const notesSnap = await orgCol(req, 'notes').get();
    const foldersSnap = await orgCol(req, 'folders').get();
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

// === Notification System ===
async function createNotification(orgId, toUserId, data) {
  await db.collection('orgs').doc(orgId).collection('notifications').add({
    toUserId,
    ...data,
    read: false,
    createdAt: new Date().toISOString()
  });

  // Send email notification
  try {
    const memberDoc = await db.collection('orgs').doc(orgId).collection('members').doc(toUserId).get();
    if (memberDoc.exists) {
      const email = memberDoc.data().email;
      // Use Firebase Auth to send email (via custom email or just log for now)
      console.log(`NOTIFICATION: Email to ${email}: ${data.title}`);
    }
  } catch (err) { console.error('Failed to send email notification:', err); }
}

// GET /api/notifications — Get unread notifications for current user
app.get('/api/notifications', auth, async (req, res) => {
  try {
    const snap = await orgCol(req, 'notifications')
      .where('toUserId', '==', req.userId).where('read', '==', false).get();
    const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    notifs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json(notifs);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch notifications' }); }
});

// POST /api/notifications/:id/read — Mark notification as read
app.post('/api/notifications/:id/read', auth, async (req, res) => {
  try {
    await orgCol(req, 'notifications').doc(req.params.id).update({ read: true });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to mark notification' }); }
});

// === Team Management Endpoints ===

// GET /api/me — Get current user's profile and role
app.get('/api/me', auth, async (req, res) => {
  res.json({
    userId: req.userId,
    email: req.userEmail,
    name: req.memberName,
    role: req.memberRole,
    department: req.memberDept,
    orgId: req.orgId
  });
});

// GET /api/team — List all team members (CMO only)
app.get('/api/team', auth, async (req, res) => {
  if (req.memberRole !== 'cmo') return res.status(403).json({ error: 'CMO only' });
  try {
    const snap = await orgCol(req, 'members').get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (err) { res.status(500).json({ error: 'Failed to fetch team' }); }
});

// POST /api/team/invite — Invite a team member (CMO only)
app.post('/api/team/invite', auth, async (req, res) => {
  if (req.memberRole !== 'cmo') return res.status(403).json({ error: 'CMO only' });
  try {
    const { email, displayName, role, department } = req.body;
    if (!email || !department) return res.status(400).json({ error: 'Email and department required' });

    // Create Firebase Auth account with email/password
    const tempPassword = Math.random().toString(36).slice(-12) + 'A1!';
    const userRecord = await admin.auth().createUser({
      email,
      password: tempPassword,
      displayName: displayName || email.split('@')[0]
    });

    // Add as org member
    await orgCol(req, 'members').doc(userRecord.uid).set({
      userId: userRecord.uid,
      email,
      displayName: displayName || email.split('@')[0],
      role: role || 'member',
      department,
      status: 'active',
      joinedAt: new Date().toISOString()
    });

    // Store orgId on the invited user's doc for fast lookup on login
    await db.collection('users').doc(userRecord.uid).set({ orgId: req.orgId }, { merge: true });

    // Send password reset email so they can set their own password
    const resetLink = await admin.auth().generatePasswordResetLink(email);

    res.status(201).json({
      userId: userRecord.uid,
      email,
      resetLink,
      message: `Account created. Send this link to ${email} so they can set their password: ${resetLink}`
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to invite: ' + err.message });
  }
});

// PUT /api/team/:id — Update a team member (CMO only)
app.put('/api/team/:id', auth, async (req, res) => {
  if (req.memberRole !== 'cmo') return res.status(403).json({ error: 'CMO only' });
  try {
    const updates = {};
    if (req.body.role) updates.role = req.body.role;
    if (req.body.department) updates.department = req.body.department;
    if (req.body.displayName) updates.displayName = req.body.displayName;
    await orgCol(req, 'members').doc(req.params.id).update(updates);
    res.json({ id: req.params.id, ...updates });
  } catch (err) { res.status(500).json({ error: 'Failed to update member' }); }
});

// POST /api/team/:id/disable — Disable a team member (CMO only)
app.post('/api/team/:id/disable', auth, async (req, res) => {
  if (req.memberRole !== 'cmo') return res.status(403).json({ error: 'CMO only' });
  try {
    await admin.auth().updateUser(req.params.id, { disabled: true });
    await orgCol(req, 'members').doc(req.params.id).update({ status: 'disabled' });
    res.json({ disabled: true });
  } catch (err) { res.status(500).json({ error: 'Failed to disable member' }); }
});

// DELETE /api/team/:id — Fully delete a team member (CMO only)
app.delete('/api/team/:id', auth, async (req, res) => {
  if (req.memberRole !== 'cmo') return res.status(403).json({ error: 'CMO only' });
  if (req.params.id === req.userId) return res.status(400).json({ error: 'Cannot delete yourself' });
  try {
    // Delete Firebase Auth account
    await admin.auth().deleteUser(req.params.id).catch(() => {});
    // Remove member doc
    await orgCol(req, 'members').doc(req.params.id).delete();
    // Remove their user doc (orgId mapping)
    await db.collection('users').doc(req.params.id).delete().catch(() => {});
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: 'Failed to delete member: ' + err.message }); }
});
app.post('/api/team/:id/enable', auth, async (req, res) => {
  if (req.memberRole !== 'cmo') return res.status(403).json({ error: 'CMO only' });
  try {
    await admin.auth().updateUser(req.params.id, { disabled: false });
    await orgCol(req, 'members').doc(req.params.id).update({ status: 'active' });
    res.json({ enabled: true });
  } catch (err) { res.status(500).json({ error: 'Failed to enable member' }); }
});

// === Gmail OAuth Endpoints ===

function createOAuth2Client() {
  return new google.auth.OAuth2(GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REDIRECT_URI);
}

// GET /api/gmail/status — Check if Gmail inbox is connected
app.get('/api/gmail/status', auth, async (req, res) => {
  try {
    const doc = await db.collection('users').doc(req.userId).get();
    const data = doc.exists ? doc.data() : {};
    res.json({ connected: !!data.gmailRefreshToken, email: data.gmailEmail || '' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check Gmail status' });
  }
});

// GET /api/gmail/auth — Start OAuth flow for CMOtaskinbox Gmail
app.get('/api/gmail/auth', auth, async (req, res) => {
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
app.post('/api/gmail/disconnect', auth, async (req, res) => {
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
app.post('/api/sync', auth, async (req, res) => {
  try {
    const userDoc = await db.collection('users').doc(req.userId).get();
    const userData = userDoc.exists ? userDoc.data() : {};

    if (!userData.gmailRefreshToken) {
      return res.status(400).json({ error: 'Gmail not connected. Click "Connect Gmail" first.' });
    }

    const oauth2Client = createOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: userData.gmailRefreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const existingSnapshot = await orgCol(req, 'tasks').where('source', '==', 'email').get();

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
    const tasksRef = orgCol(req, 'tasks');

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
        emailMessageId: msg.id,
        createdBy: req.userId,
        assignedTo: req.userId,
        sharedWith: []
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
