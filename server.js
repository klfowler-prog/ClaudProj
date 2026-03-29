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

// Helper: get departments array from member data (handles migration from old string format)
function getMemberDepts(m) {
  if (m.departments && Array.isArray(m.departments)) return m.departments;
  if (m.department === 'all') return ['all'];
  if (m.department) return [m.department];
  return [];
}

function getMemberSubDepts(m) {
  if (m.subDepartments && Array.isArray(m.subDepartments)) return m.subDepartments;
  if (m.subDepartment) return [m.subDepartment];
  return [];
}

// === Org Resolution Middleware ===
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
        req.memberDepts = getMemberDepts(m);
        req.memberName = m.displayName;
        req.memberReportsTo = m.reportsTo || '';
        req.memberSubDepts = getMemberSubDepts(m);
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
        req.memberDepts = getMemberDepts(m);
        req.memberName = m.displayName;
        req.memberReportsTo = m.reportsTo || '';
        req.memberSubDepts = getMemberSubDepts(m);
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
      role: 'cmo', departments: ['all'], status: 'active', joinedAt: new Date().toISOString()
    });

    await db.collection('users').doc(req.userId).set({ orgId: orgRef.id }, { merge: true });

    req.orgId = orgRef.id;
    req.memberRole = 'cmo';
    req.memberDepts = ['all'];
    req.memberName = req.userName;

    if (hasLegacyData) await migrateLegacyData(req.userId, orgRef.id);

    // Seed default folders
    const defaults = [
      { name: 'All Team', order: 0, shared: true },
      { name: 'B2B Marketing', order: 1 },
      { name: 'Internal Comms', order: 2 },
      { name: 'Rev Ops', order: 3 },
      { name: 'B2C Marketing', order: 4 },
      { name: 'Personal', order: 5 }
    ];
    const batch = db.batch();
    defaults.forEach(f => {
      const ref = orgRef.collection('folders').doc();
      batch.set(ref, { name: f.name, order: f.order, shared: f.shared || false, createdAt: new Date().toISOString() });
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
const auth = [authenticate, resolveOrg, applyViewAs];

// View As: CMO can impersonate another user for data filtering
function applyViewAs(req, res, next) {
  const viewAsUserId = req.headers['x-view-as'];
  if (!viewAsUserId || req.memberRole !== 'cmo') return next();

  // Look up the target member
  orgCol(req, 'members').doc(viewAsUserId).get().then(doc => {
    if (!doc.exists) return next();
    const m = doc.data();
    req.realUserId = req.userId; // Preserve real identity
    req.userId = m.userId;
    req.memberRole = m.role;
    req.memberDepts = getMemberDepts(m);
    req.memberName = m.displayName;
    req.memberReportsTo = m.reportsTo || '';
    next();
  }).catch(() => next());
}

// Middleware: block viewers from write operations
function requireEditor(req, res, next) {
  if (req.memberRole === 'viewer') {
    return res.status(403).json({ error: 'Viewers have read-only access' });
  }
  next();
}
const authWrite = [authenticate, resolveOrg, applyViewAs, requireEditor];

// === Task Endpoints ===

// GET /api/tasks — List tasks (filtered by role/department)
app.get('/api/tasks', auth, async (req, res) => {
  try {
    const snapshot = await orgCol(req, 'tasks').orderBy('createdAt', 'desc').get();
    let tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Filter by role: CMO sees all, others see their dept + assigned/shared
    if (req.memberRole !== 'cmo') {
      tasks = tasks.filter(t =>
        req.memberDepts.includes(t.department) ||
        t.assignedTo === req.userId ||
        (t.sharedWith && t.sharedWith.includes(req.userId)) ||
        t.createdBy === req.userId
      );
    }

    // Optional: filter to "my tasks" only
    if (req.query.mine === 'true') {
      tasks = tasks.filter(t => t.assignedTo === req.userId || t.createdBy === req.userId);
    }

    // Optional: filter to "my team" (me + my direct reports)
    if (req.query.team === 'true') {
      const myReportIds = new Set();
      const membersSnap = await orgCol(req, 'members').get();
      membersSnap.docs.forEach(d => {
        if (d.data().reportsTo === req.userId) myReportIds.add(d.data().userId);
      });
      myReportIds.add(req.userId);
      tasks = tasks.filter(t => myReportIds.has(t.assignedTo) || myReportIds.has(t.createdBy));
    }

    // Optional: filter by sub-department
    if (req.query.subDept) {
      tasks = tasks.filter(t => t.subDepartment === req.query.subDept);
    }

    // Separate sub-tasks from parent tasks
    const subTasks = tasks.filter(t => t.parentTaskId);
    const parentTasks = tasks.filter(t => !t.parentTaskId);

    // Compute sub-task counts for parent tasks
    parentTasks.forEach(p => {
      const subs = subTasks.filter(s => s.parentTaskId === p.id);
      p.subtaskCount = subs.length;
      p.subtasksCompleted = subs.filter(s => s.status === 'Completed').length;
    });

    // Include sub-tasks assigned to this user BY SOMEONE ELSE (delegated to them)
    // Sub-tasks you created yourself are visible in the parent task detail, not the main list
    const mySubtasks = subTasks.filter(s => s.assignedTo === req.userId && s.createdBy !== req.userId);
    mySubtasks.forEach(s => {
      const parent = tasks.find(t => t.id === s.parentTaskId);
      s.parentTaskTitle = parent ? parent.title : '';
      s.parentTaskNotes = parent ? (parent.notes || '') : '';
    });

    // For assignees: "Delegated" tasks show as "Not Started" from their perspective
    const allResults = [...parentTasks, ...mySubtasks];
    allResults.forEach(t => {
      if (t.status === 'Delegated' && t.assignedTo === req.userId && t.createdBy !== req.userId) {
        t.status = 'Not Started';
        t.displayStatus = 'Not Started'; // The assignee's view
        t.delegatedByOther = true; // Flag so we know it was delegated
      }
    });

    res.json(allResults);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tasks' });
  }
});

// POST /api/tasks — Create a new task
app.post('/api/tasks', authWrite, async (req, res) => {
  try {
    const task = {
      title: req.body.title,
      department: req.body.department,
      subDepartment: req.body.subDepartment || '',
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
      sharedWith: req.body.sharedWith || [],
      parentTaskId: req.body.parentTaskId || ''
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
app.post('/api/tasks/batch', authWrite, async (req, res) => {
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
        createdBy: req.userId, assignedTo: task.assignedTo || req.userId, sharedWith: [],
        subDepartment: task.subDepartment || '', parentTaskId: task.parentTaskId || ''
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

    // Viewers can only update status on tasks assigned to them
    if (req.memberRole === 'viewer') {
      if (oldTask.assignedTo !== req.userId) {
        return res.status(403).json({ error: 'Viewers can only update tasks assigned to them' });
      }
      const updates = {};
      if (req.body.status) {
        updates.status = req.body.status;
        updates.completed = req.body.status === 'Completed';
        updates.completedAt = req.body.status === 'Completed' ? new Date().toISOString() : '';
      }
      if (Object.keys(updates).length === 0) return res.status(403).json({ error: 'Viewers can only change task status' });
      await taskRef.update(updates);
      return res.json({ id: req.params.id, ...oldTask, ...updates });
    }

    const updates = {};
    const allowedFields = ['title', 'department', 'priority', 'notes', 'status',
      'completed', 'completedAt', 'dueDate', 'attachments', 'emailMessageId', 'recurring',
      'assignedTo', 'sharedWith', 'parentTaskId', 'subDepartment', 'blockedReason'];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    }

    if (updates.status) updates.completed = updates.status === 'Completed';

    // Clear blockedReason when moving away from Blocked
    if (updates.status && updates.status !== 'Blocked' && !updates.blockedReason) {
      updates.blockedReason = '';
    }

    // Track who approved the task
    if (updates.status === 'Approved') {
      updates.approvedBy = req.userId;
    }

    // When a task is reassigned, reset Delegated status back to Not Started
    if (updates.assignedTo && updates.assignedTo !== oldTask.assignedTo && oldTask.status === 'Delegated') {
      if (!updates.status) {
        updates.status = 'Not Started';
        updates.completed = false;
      }
    }

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

    // Notify the creator/delegator when a task is blocked
    if (updates.status === 'Blocked' && oldTask.createdBy && oldTask.createdBy !== req.userId) {
      const reason = updates.blockedReason ? ` — ${updates.blockedReason}` : '';
      await createNotification(req.orgId, oldTask.createdBy, {
        type: 'task_blocked',
        title: `${req.memberName} is blocked on: ${oldTask.title}${reason}`,
        taskId: req.params.id,
        fromUserId: req.userId,
        fromName: req.memberName
      });
    }

    // Notify the delegator when a task is approved
    if (updates.status === 'Approved' && oldTask.createdBy && oldTask.createdBy !== req.userId) {
      await createNotification(req.orgId, oldTask.createdBy, {
        type: 'task_approved',
        title: `${req.memberName} approved: ${oldTask.title}`,
        taskId: req.params.id,
        fromUserId: req.userId,
        fromName: req.memberName
      });
    }

    // Notify the approver when an approved task is completed
    if (updates.status === 'Completed' && oldTask.approvedBy && oldTask.approvedBy !== req.userId) {
      await createNotification(req.orgId, oldTask.approvedBy, {
        type: 'task_completed_after_approval',
        title: `${req.memberName} completed: ${oldTask.title}`,
        taskId: req.params.id,
        fromUserId: req.userId,
        fromName: req.memberName
      });
    }

    // Notify the creator when their delegated task is completed (if not the approver)
    if (updates.status === 'Completed' && oldTask.createdBy && oldTask.createdBy !== req.userId && oldTask.createdBy !== oldTask.approvedBy) {
      await createNotification(req.orgId, oldTask.createdBy, {
        type: 'task_completed',
        title: `${req.memberName} completed: ${oldTask.title}`,
        taskId: req.params.id,
        fromUserId: req.userId,
        fromName: req.memberName
      });
    }

    // Notify parent task owner when a sub-task is completed
    if (updates.status === 'Completed' && oldTask.parentTaskId) {
      const parentDoc = await orgCol(req, 'tasks').doc(oldTask.parentTaskId).get();
      if (parentDoc.exists) {
        const parent = parentDoc.data();
        // Count sub-tasks
        const allSubs = await orgCol(req, 'tasks').where('parentTaskId', '==', oldTask.parentTaskId).get();
        const totalSubs = allSubs.size;
        const completedSubs = allSubs.docs.filter(d => d.data().status === 'Completed' || d.id === req.params.id).length;
        const allDone = completedSubs >= totalSubs;

        if (parent.createdBy && parent.createdBy !== req.userId) {
          const notifTitle = allDone
            ? `All sub-tasks completed for "${parent.title}" — ready to mark as complete?`
            : `${req.memberName} completed "${oldTask.title}" (${completedSubs}/${totalSubs} done) — part of "${parent.title}"`;
          await createNotification(req.orgId, parent.createdBy, {
            type: allDone ? 'subtasks_all_done' : 'subtask_completed',
            title: notifTitle,
            taskId: oldTask.parentTaskId,
            fromUserId: req.userId,
            fromName: req.memberName
          });
        }
      }
    }

    res.json({ id: req.params.id, ...oldTask, ...updates });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

// DELETE /api/tasks/:id — Delete a task
app.delete('/api/tasks/:id', authWrite, async (req, res) => {
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

// GET /api/tasks/:id/subtasks — List sub-tasks for a parent task
app.get('/api/tasks/:id/subtasks', auth, async (req, res) => {
  try {
    const snapshot = await orgCol(req, 'tasks').where('parentTaskId', '==', req.params.id).get();
    const subtasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    subtasks.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    res.json(subtasks);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sub-tasks' });
  }
});

// === Task Comments ===

// GET /api/tasks/:id/comments — List comments on a task (includes sub-task comments for parent)
app.get('/api/tasks/:id/comments', auth, async (req, res) => {
  try {
    // Get comments on this task
    const snap = await orgCol(req, 'comments').where('taskId', '==', req.params.id).get();
    let comments = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // If this is a parent task, also get comments from all sub-tasks
    const subsSnap = await orgCol(req, 'tasks').where('parentTaskId', '==', req.params.id).get();
    for (const subDoc of subsSnap.docs) {
      const subComments = await orgCol(req, 'comments').where('taskId', '==', subDoc.id).get();
      subComments.docs.forEach(d => {
        const c = { id: d.id, ...d.data(), subtaskTitle: subDoc.data().title };
        comments.push(c);
      });
    }

    comments.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json(comments);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

// POST /api/tasks/:id/comments — Add a comment to a task
app.post('/api/tasks/:id/comments', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Comment text required' });

    const comment = {
      taskId: req.params.id,
      text: text.trim(),
      authorId: req.userId,
      authorName: req.memberName,
      createdAt: new Date().toISOString()
    };

    const ref = await orgCol(req, 'comments').add(comment);

    // Notify task owner if commenter is not the owner
    const taskDoc = await orgCol(req, 'tasks').doc(req.params.id).get();
    if (taskDoc.exists) {
      const task = taskDoc.data();
      // Notify task creator
      if (task.createdBy && task.createdBy !== req.userId) {
        await createNotification(req.orgId, task.createdBy, {
          type: 'comment',
          title: `${req.memberName} commented on "${task.title}"`,
          taskId: req.params.id,
          fromUserId: req.userId,
          fromName: req.memberName
        });
      }
      // If this is a sub-task, also notify the parent task creator
      if (task.parentTaskId) {
        const parentDoc = await orgCol(req, 'tasks').doc(task.parentTaskId).get();
        if (parentDoc.exists && parentDoc.data().createdBy && parentDoc.data().createdBy !== req.userId && parentDoc.data().createdBy !== task.createdBy) {
          await createNotification(req.orgId, parentDoc.data().createdBy, {
            type: 'comment',
            title: `${req.memberName} commented on "${task.title}" (part of "${parentDoc.data().title}")`,
            taskId: task.parentTaskId,
            fromUserId: req.userId,
            fromName: req.memberName
          });
        }
      }
    }

    res.status(201).json({ id: ref.id, ...comment });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add comment' });
  }
});

// === File Upload ===
const { Storage } = require('@google-cloud/storage');
const multer = require('multer');
const storage = new Storage();
const BUCKET_NAME = process.env.GCS_BUCKET || 'cmo-task-app-files';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB max

app.post('/api/upload', auth, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const bucket = storage.bucket(BUCKET_NAME);
    const fileName = `${req.orgId}/${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const blob = bucket.file(fileName);

    await blob.save(req.file.buffer, {
      contentType: req.file.mimetype,
      metadata: { uploadedBy: req.userId, orgId: req.orgId }
    });

    // Store the GCS path (not a public URL) — download via signed URL endpoint
    res.json({
      gcsPath: fileName,
      name: req.file.originalname,
      size: req.file.size,
      type: req.file.mimetype
    });
  } catch (err) {
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// GET /api/file-url?path=... — Generate a signed download URL (1 hour expiry)
app.get('/api/file-url', auth, async (req, res) => {
  try {
    const filePath = req.query.path;
    if (!filePath) return res.status(400).json({ error: 'path is required' });

    // Security: only allow files from the user's org
    if (!filePath.startsWith(req.orgId + '/')) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const bucket = storage.bucket(BUCKET_NAME);
    const [url] = await bucket.file(filePath).getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000 // 1 hour
    });
    res.json({ url });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate download URL: ' + err.message });
  }
});

// POST /api/migrate-files — One-time migration of base64 files to Cloud Storage (CMO only)
app.post('/api/migrate-files', auth, async (req, res) => {
  if (req.memberRole !== 'cmo') return res.status(403).json({ error: 'CMO only' });
  try {
    const bucket = storage.bucket(BUCKET_NAME);
    let migratedCount = 0;

    // Migrate task attachments
    const tasksSnap = await orgCol(req, 'tasks').get();
    for (const taskDoc of tasksSnap.docs) {
      const task = taskDoc.data();
      if (!task.attachments || task.attachments.length === 0) continue;

      let changed = false;
      const newAttachments = [];
      for (const att of task.attachments) {
        if (att.type === 'file' && att.data && att.data.startsWith('data:')) {
          // Extract base64 data
          const matches = att.data.match(/^data:([^;]+);base64,(.+)$/);
          if (!matches) { newAttachments.push(att); continue; }
          const mimeType = matches[1];
          const buffer = Buffer.from(matches[2], 'base64');
          const fileName = `${req.orgId}/migrated-${Date.now()}-${(att.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const blob = bucket.file(fileName);
          await blob.save(buffer, { contentType: mimeType });
          newAttachments.push({ type: 'file', name: att.name, gcsPath: fileName, size: buffer.length });
          changed = true;
          migratedCount++;
        } else {
          newAttachments.push(att);
        }
      }
      if (changed) {
        await orgCol(req, 'tasks').doc(taskDoc.id).update({ attachments: newAttachments });
      }
    }

    // Migrate note links that have base64 data
    const notesSnap = await orgCol(req, 'notes').get();
    for (const noteDoc of notesSnap.docs) {
      const note = noteDoc.data();
      if (!note.links || note.links.length === 0) continue;

      let changed = false;
      const newLinks = [];
      for (const link of note.links) {
        if (link.type === 'file' && link.data && link.data.startsWith('data:')) {
          const matches = link.data.match(/^data:([^;]+);base64,(.+)$/);
          if (!matches) { newLinks.push(link); continue; }
          const mimeType = matches[1];
          const buffer = Buffer.from(matches[2], 'base64');
          const fileName = `${req.orgId}/migrated-${Date.now()}-${(link.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const blob = bucket.file(fileName);
          await blob.save(buffer, { contentType: mimeType });
          newLinks.push({ type: 'file', name: link.name, gcsPath: fileName, size: buffer.length });
          changed = true;
          migratedCount++;
        } else {
          newLinks.push(link);
        }
      }
      if (changed) {
        await orgCol(req, 'notes').doc(noteDoc.id).update({ links: newLinks });
      }
    }

    res.json({ migrated: migratedCount, message: `Migrated ${migratedCount} files to Cloud Storage` });
  } catch (err) {
    res.status(500).json({ error: 'Migration failed: ' + err.message });
  }
});

// POST /api/folders/seed-subdepts — Create missing sub-department folders (CMO only)
app.post('/api/folders/seed-subdepts', auth, async (req, res) => {
  if (req.memberRole !== 'cmo') return res.status(403).json({ error: 'CMO only' });
  try {
    const existing = await orgCol(req, 'folders').get();
    const existingNames = new Set(existing.docs.map(d => d.data().name));
    const allSubDepts = ['Biz Dev', 'Growth & Brand', 'Rev Ops', 'Internal Comms', 'Marketing Leaders'];
    let created = 0;
    const batch = db.batch();
    allSubDepts.forEach((name, i) => {
      if (!existingNames.has(name)) {
        const ref = orgCol(req, 'folders').doc();
        batch.set(ref, { name, order: 10 + i, createdAt: new Date().toISOString() });
        created++;
      }
    });
    if (created > 0) await batch.commit();
    res.json({ created, message: `Created ${created} new folders` });
  } catch (err) { res.status(500).json({ error: 'Failed: ' + err.message }); }
});

// === Folder Endpoints ===

app.get('/api/folders', auth, async (req, res) => {
  try {
    const snapshot = await orgCol(req, 'folders').orderBy('order').get();
    const all = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Deduplicate folders by name (delete extras, keep first)
    const seen = new Set();
    const unique = [];
    for (const f of all) {
      if (seen.has(f.name)) {
        // Delete the duplicate
        await orgCol(req, 'folders').doc(f.id).delete();
      } else {
        seen.add(f.name);
        unique.push(f);
      }
    }

    res.json(unique);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch folders' }); }
});

app.post('/api/folders', authWrite, async (req, res) => {
  if (req.memberRole !== 'cmo') return res.status(403).json({ error: 'Only CMO can create folders' });
  try {
    const folder = { name: req.body.name, order: req.body.order || 99, createdAt: new Date().toISOString() };
    const ref = await orgCol(req, 'folders').add(folder);
    res.status(201).json({ id: ref.id, ...folder });
  } catch (err) { res.status(500).json({ error: 'Failed to create folder' }); }
});

app.put('/api/folders/:id', authWrite, async (req, res) => {
  try {
    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.order !== undefined) updates.order = req.body.order;
    // Only CMO can change folder visibility flags
    if (req.body.shared !== undefined && req.memberRole === 'cmo') updates.shared = req.body.shared;
    if (req.body.leadersOnly !== undefined && req.memberRole === 'cmo') updates.leadersOnly = req.body.leadersOnly;
    await orgCol(req, 'folders').doc(req.params.id).update(updates);
    res.json({ id: req.params.id, ...updates });
  } catch (err) { res.status(500).json({ error: 'Failed to update folder' }); }
});

app.delete('/api/folders/:id', authWrite, async (req, res) => {
  if (req.memberRole !== 'cmo') return res.status(403).json({ error: 'Only CMO can delete folders' });
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
      query = orgCol(req, 'notes');
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
        authorName: memberNames[d.createdBy] || 'Unknown',
        pinned: d.pinned || false,
        archived: d.archived || false
      };
    });

    // Build folder visibility maps
    const foldersSnap = await orgCol(req, 'folders').get();
    const sharedFolderIds = new Set();
    const leadersFolderIds = new Set();
    foldersSnap.docs.forEach(d => {
      if (d.data().shared) sharedFolderIds.add(d.id);
      if (d.data().leadersOnly) leadersFolderIds.add(d.id);
    });

    // Notes are private: only show your own + shared + leaders-only (if lead/cmo) + dept-shared
    // CMO sees all
    if (req.memberRole !== 'cmo') {
      notes = notes.filter(n => {
        if (n.createdBy === req.userId) return true;
        if (sharedFolderIds.has(n.folderId)) return true;
        if (leadersFolderIds.has(n.folderId) && req.memberRole === 'lead') return true;
        const sw = n.sharedWith || [];
        if (sw.includes(req.userId)) return true;
        if (req.memberDepts.some(d => sw.includes('dept:' + d))) return true;
        if (req.memberReportsTo && sw.includes('reports:' + req.memberReportsTo)) return true;
        if (sw.includes('all')) return true;
        return false;
      });
    }
    if (req.query.mine === 'true') {
      notes = notes.filter(n => n.createdBy === req.userId);
    }

    // Filter out archived unless explicitly requested
    if (req.query.includeArchived !== 'true') {
      notes = notes.filter(n => !n.archived);
    }

    // Pinned notes first, then sort by updatedAt
    notes.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });
    res.json(notes);
  } catch (err) {
    console.error('Failed to fetch notes:', err.message);
    res.status(500).json({ error: 'Failed to fetch notes: ' + err.message });
  }
});

app.get('/api/notes/:id', auth, async (req, res) => {
  try {
    const doc = await orgCol(req, 'notes').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Note not found' });
    const note = doc.data();
    // Non-CMO can only read their own notes, shared notes, or notes in shared folders
    if (req.memberRole !== 'cmo' && note.createdBy !== req.userId) {
      // Check if note is in a shared or leaders-only folder
      let hasAccess = false;
      if (note.folderId) {
        const folderDoc = await orgCol(req, 'folders').doc(note.folderId).get();
        if (folderDoc.exists) {
          const fd = folderDoc.data();
          if (fd.shared) hasAccess = true;
          if (fd.leadersOnly && req.memberRole === 'lead') hasAccess = true;
        }
      }
      const sw = note.sharedWith || [];
      if (!hasAccess && !sw.includes(req.userId) && !req.memberDepts.some(d => sw.includes('dept:' + d)) && !(req.memberReportsTo && sw.includes('reports:' + req.memberReportsTo)) && !sw.includes('all')) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }
    res.json({ id: doc.id, ...note });
  } catch (err) { res.status(500).json({ error: 'Failed to fetch note' }); }
});

app.post('/api/notes', authWrite, async (req, res) => {
  try {
    const now = new Date().toISOString();
    const note = {
      title: req.body.title || 'Untitled', content: req.body.content || '',
      folderId: req.body.folderId || '', source: req.body.source || 'manual',
      createdAt: now, updatedAt: now, aiSummary: '', createdBy: req.userId,
      links: req.body.links || [],
      pinned: false
    };
    const ref = await orgCol(req, 'notes').add(note);
    res.status(201).json({ id: ref.id, ...note });
  } catch (err) { res.status(500).json({ error: 'Failed to create note' }); }
});

app.put('/api/notes/:id', authWrite, async (req, res) => {
  try {
    const ref = orgCol(req, 'notes').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Note not found' });

    // Only creator and CMO can edit
    const note = doc.data();
    if (req.memberRole !== 'cmo' && note.createdBy !== req.userId) {
      return res.status(403).json({ error: 'Only the note creator can edit this note' });
    }

    const updates = { updatedAt: new Date().toISOString() };
    const allowed = ['title', 'content', 'folderId', 'aiSummary', 'sharedWith', 'links', 'pinned', 'archived'];
    for (const f of allowed) { if (req.body[f] !== undefined) updates[f] = req.body[f]; }
    await ref.update(updates);
    res.json({ id: req.params.id, ...updates });
  } catch (err) { res.status(500).json({ error: 'Failed to update note' }); }
});

app.delete('/api/notes/:id', authWrite, async (req, res) => {
  try {
    await orgCol(req, 'notes').doc(req.params.id).delete();
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: 'Failed to delete note' }); }
});

// === Search ===
app.get('/api/search', auth, async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase().trim();
    if (!q || q.length < 2) return res.json({ tasks: [], notes: [] });

    // Search tasks
    const tasksSnap = await orgCol(req, 'tasks').get();
    let taskResults = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(t => {
      const searchable = `${t.title} ${t.notes} ${t.department} ${t.subDepartment || ''}`.toLowerCase();
      return searchable.includes(q);
    });

    // Filter by role
    if (req.memberRole !== 'cmo') {
      taskResults = taskResults.filter(t =>
        req.memberDepts.includes(t.department) ||
        t.assignedTo === req.userId ||
        (t.sharedWith && t.sharedWith.includes(req.userId)) ||
        t.createdBy === req.userId
      );
    }

    // Search notes
    const notesSnap = await orgCol(req, 'notes').get();
    const foldersSnap = await orgCol(req, 'folders').get();
    const folderMap = {};
    const sharedFolderIds = new Set();
    const leadersFolderIds = new Set();
    foldersSnap.docs.forEach(d => {
      folderMap[d.id] = d.data().name;
      if (d.data().shared) sharedFolderIds.add(d.id);
      if (d.data().leadersOnly) leadersFolderIds.add(d.id);
    });

    const membersSnap = await orgCol(req, 'members').get();
    const memberNames = {};
    membersSnap.docs.forEach(d => { memberNames[d.id] = d.data().displayName || d.data().email; });

    let noteResults = notesSnap.docs.map(d => {
      const n = d.data();
      return {
        id: d.id, title: n.title, folderId: n.folderId,
        folderName: folderMap[n.folderId] || 'Unfiled',
        updatedAt: n.updatedAt, createdBy: n.createdBy,
        authorName: memberNames[n.createdBy] || 'Unknown',
        sharedWith: n.sharedWith || [],
        contentPreview: stripHtml(n.content || '').substring(0, 200)
      };
    }).filter(n => {
      const searchable = `${n.title} ${n.contentPreview} ${n.folderName}`.toLowerCase();
      return searchable.includes(q);
    });

    // Filter notes by access
    if (req.memberRole !== 'cmo') {
      noteResults = noteResults.filter(n => {
        if (n.createdBy === req.userId) return true;
        if (sharedFolderIds.has(n.folderId)) return true;
        if (leadersFolderIds.has(n.folderId) && req.memberRole === 'lead') return true;
        const sw = n.sharedWith || [];
        if (sw.includes(req.userId)) return true;
        if (req.memberDepts.some(d => sw.includes('dept:' + d))) return true;
        if (req.memberReportsTo && sw.includes('reports:' + req.memberReportsTo)) return true;
        if (sw.includes('all')) return true;
        return false;
      });
    }

    res.json({
      tasks: taskResults.slice(0, 20),
      notes: noteResults.slice(0, 20)
    });
  } catch (err) {
    res.status(500).json({ error: 'Search failed: ' + err.message });
  }
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

    // Get team members for assignee suggestions
    const membersSnap = await orgCol(req, 'members').get();
    const memberList = membersSnap.docs.map(d => {
      const m = d.data();
      return `${m.displayName} (userId: ${m.userId})`;
    }).join(', ');

    const model = getGeminiModel();
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `You are a marketing strategy assistant for a CMO at Follett Higher Education. Analyze this document and extract actionable tasks.

If the document describes a project or initiative with multiple steps, return a PARENT TASK with SUB-TASKS. If it's just a list of unrelated action items, return them as separate parent tasks with no sub-tasks.

Return ONLY a JSON object (no markdown, no code fences) with this structure:
{
  "groups": [
    {
      "parent": {
        "title": "Main project or initiative name",
        "department": "B2B Marketing" | "B2C Marketing" | "Personal",
        "subDepartment": "Biz Dev" | "Growth & Brand" | "Rev Ops" | "Internal Comms" | "" (only for B2B Marketing),
        "priority": "High" | "Medium" | "Low",
        "notes": "Brief context",
        "assignedTo": "userId if a team member name is mentioned, otherwise empty string"
      },
      "subtasks": [
        {
          "title": "Specific action item",
          "priority": "High" | "Medium" | "Low",
          "notes": "Brief context",
          "assignedTo": "userId if mentioned, otherwise empty string"
        }
      ]
    }
  ]
}

Rules:
- If there's one clear project with steps, make ONE group with subtasks
- If there are multiple unrelated items, make multiple groups each with an empty subtasks array
- Sub-tasks inherit department from parent
- Only include genuinely actionable items
- If no actionable items, return {"groups": []}

Available team members: ${memberList}

Document title: ${note.title}

Content:
${text}` }] }]
    });

    const responseText = result.response.text().trim();
    const cleaned = responseText.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return res.status(400).json({ error: 'AI returned invalid format. Try again.' });
    }

    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Generate tasks failed: ' + err.message });
  }
});

// POST /api/ai/quick-add — Parse natural language into task fields
app.post('/api/ai/quick-add', auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Text is required' });

    // Get team members for assignee matching
    const membersSnap = await orgCol(req, 'members').get();
    const memberList = membersSnap.docs.map(d => {
      const m = d.data();
      return `${m.displayName} (userId: ${m.userId})`;
    }).join(', ');

    const today = new Date().toISOString().split('T')[0];
    const model = getGeminiModel();
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `You are a task parser for a marketing team at Follett Higher Education. Parse the following natural language input into a structured task. Today's date is ${today}.

Return ONLY a JSON object (no markdown, no code fences) with these fields:
- "title": string (clear, concise task title)
- "department": one of "B2B Marketing", "B2C Marketing", "Personal" (infer from context, default to "Personal" if unclear)
- "subDepartment": if department is "B2B Marketing", one of "Biz Dev", "Growth & Brand", "Rev Ops", "Internal Comms" or "" if unclear. If department is "B2C Marketing" or "Personal", use ""
- "priority": one of "High", "Medium", "Low" (infer from urgency words, default to "Medium")
- "dueDate": string in YYYY-MM-DD format (calculate from relative dates like "next Tuesday", "end of week", "tomorrow". If no date mentioned, use "")
- "assignedTo": string (match to a team member userId if a name is mentioned. Available team members: ${memberList}. If no name mentioned or no match, use "")
- "notes": string (any additional context from the input that doesn't fit in other fields, or "" if none)
- "recurring": one of "none", "daily", "weekly", "biweekly", "monthly" (infer if words like "every week", "daily", "monthly" are used, default to "none")

Input: "${text}"` }] }]
    });

    const responseText = result.response.text().trim();
    const cleaned = responseText.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim();
    try {
      const parsed = JSON.parse(cleaned);
      res.json(parsed);
    } catch {
      res.status(400).json({ error: 'AI returned invalid format. Try again.' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Quick add failed: ' + err.message });
  }
});

// === Global AI Chat ===
app.post('/api/ai/chat', auth, async (req, res) => {
  try {
    const { message, history } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    // Gather tasks — apply same role-based filtering as task list
    const tasksSnap = await orgCol(req, 'tasks').orderBy('createdAt', 'desc').get();
    let taskDocs = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (req.memberRole !== 'cmo') {
      taskDocs = taskDocs.filter(t =>
        req.memberDepts.includes(t.department) ||
        t.assignedTo === req.userId ||
        (t.sharedWith && t.sharedWith.includes(req.userId)) ||
        t.createdBy === req.userId
      );
    }
    const allTasks = taskDocs.map(t =>
      `[${t.status}] ${t.title} | Dept: ${t.department}${t.subDepartment ? '/' + t.subDepartment : ''} | Priority: ${t.priority}${t.dueDate ? ' | Due: ' + t.dueDate : ''}${t.notes ? ' | Notes: ' + t.notes.substring(0, 200) : ''}`
    );

    // Gather notes — apply same access filtering as notes list
    const notesSnap = await orgCol(req, 'notes').get();
    const foldersSnap = await orgCol(req, 'folders').get();
    const folderMap = {};
    const sharedFolderIds = new Set();
    const leadersFolderIds = new Set();
    foldersSnap.docs.forEach(d => {
      folderMap[d.id] = d.data().name;
      if (d.data().shared) sharedFolderIds.add(d.id);
      if (d.data().leadersOnly) leadersFolderIds.add(d.id);
    });

    let noteDocs = notesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (req.memberRole !== 'cmo') {
      noteDocs = noteDocs.filter(n => {
        if (n.createdBy === req.userId) return true;
        if (sharedFolderIds.has(n.folderId)) return true;
        if (leadersFolderIds.has(n.folderId) && req.memberRole === 'lead') return true;
        const sw = n.sharedWith || [];
        if (sw.includes(req.userId)) return true;
        if (req.memberDepts.some(d => sw.includes('dept:' + d))) return true;
        if (req.memberReportsTo && sw.includes('reports:' + req.memberReportsTo)) return true;
        if (sw.includes('all')) return true;
        return false;
      });
    }
    const allNotes = noteDocs.map(n => {
      const folder = folderMap[n.folderId] || 'Unfiled';
      const content = stripHtml(n.content || '').substring(0, 500);
      return `[${folder}] ${n.title}\n${content}`;
    });

    const today = new Date().toISOString().split('T')[0];
    const isCmo = req.memberRole === 'cmo';
    const roleName = isCmo ? 'CMO' : req.memberRole === 'lead' ? 'Department Lead' : 'team member';

    const systemPrompt = `You are an AI assistant for ${req.memberName}, a ${roleName} at Follett Higher Education. You have access to their task list and notes. Be concise, actionable, and strategic. Today's date is ${today}.

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
    // Return all notifications for this user (both read and unread)
    const snap = await orgCol(req, 'notifications')
      .where('toUserId', '==', req.userId).get();
    const notifs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Sort newest first, limit to last 50
    notifs.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json(notifs.slice(0, 50));
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
    departments: req.memberDepts,
    reportsTo: req.memberReportsTo,
    subDepartments: req.memberSubDepts,
    orgId: req.orgId
  });
});

// GET /api/team — List team members (full details for CMO, limited for others)
app.get('/api/team', auth, async (req, res) => {
  try {
    const snap = await orgCol(req, 'members').get();
    const members = snap.docs.map(d => {
      const m = d.data();
      if (req.memberRole === 'cmo') return { id: d.id, ...m };
      return { id: d.id, userId: m.userId, displayName: m.displayName, department: m.department, departments: getMemberDepts(m), subDepartments: getMemberSubDepts(m) };
    });
    res.json(members);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch team' }); }
});

// GET /api/team/:id/profile — Get a team member's profile for impersonation (CMO only)
app.get('/api/team/:id/profile', auth, async (req, res) => {
  if (req.memberRole !== 'cmo') return res.status(403).json({ error: 'CMO only' });
  try {
    const doc = await orgCol(req, 'members').doc(req.params.id).get();
    if (!doc.exists) return res.status(404).json({ error: 'Member not found' });
    const m = doc.data();
    res.json({
      userId: m.userId, email: m.email, name: m.displayName,
      role: m.role, departments: getMemberDepts(m),
      reportsTo: m.reportsTo || '', orgId: req.orgId
    });
  } catch (err) { res.status(500).json({ error: 'Failed to get profile' }); }
});

// POST /api/team/invite — Invite a team member (CMO or dept lead for their reports)
app.post('/api/team/invite', auth, async (req, res) => {
  if (req.memberRole !== 'cmo' && req.memberRole !== 'lead') return res.status(403).json({ error: 'Only CMO and dept leads can invite' });
  try {
    const { email, displayName, role, departments } = req.body;
    if (!email || !departments || departments.length === 0) return res.status(400).json({ error: 'Email and at least one department required' });

    // Leads can only invite members/viewers into their own departments
    if (req.memberRole === 'lead') {
      if (role === 'cmo' || role === 'lead') return res.status(403).json({ error: 'Leads can only invite members or viewers' });
      const invalidDepts = departments.filter(d => !req.memberDepts.includes(d));
      if (invalidDepts.length > 0) return res.status(403).json({ error: `You can only invite into your departments: ${req.memberDepts.join(', ')}` });
    }

    const tempPassword = Math.random().toString(36).slice(-12) + 'A1!';
    const userRecord = await admin.auth().createUser({
      email,
      password: tempPassword,
      displayName: displayName || email.split('@')[0]
    });

    await orgCol(req, 'members').doc(userRecord.uid).set({
      userId: userRecord.uid,
      email,
      displayName: displayName || email.split('@')[0],
      role: role || 'member',
      departments: Array.isArray(departments) ? departments : [departments],
      reportsTo: req.memberRole === 'lead' ? req.userId : (req.body.reportsTo || ''),
      subDepartments: req.body.subDepartments || [],
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
  // CMO can edit anyone, leads can edit their reports
  if (req.memberRole === 'lead') {
    const targetDoc = await orgCol(req, 'members').doc(req.params.id).get();
    if (!targetDoc.exists || targetDoc.data().reportsTo !== req.userId) {
      return res.status(403).json({ error: 'You can only edit your direct reports' });
    }
  } else if (req.memberRole !== 'cmo') {
    return res.status(403).json({ error: 'Not authorized' });
  }
  try {
    const updates = {};
    if (req.body.role) updates.role = req.body.role;
    if (req.body.departments) updates.departments = req.body.departments;
    if (req.body.displayName) updates.displayName = req.body.displayName;
    if (req.body.reportsTo !== undefined) updates.reportsTo = req.body.reportsTo;
    if (req.body.subDepartments) updates.subDepartments = req.body.subDepartments;
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

// === Daily Briefing ===
app.get('/api/briefing', auth, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Get user's tasks
    const tasksSnap = await orgCol(req, 'tasks').get();
    let allTasks = tasksSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filter to user's visible tasks
    if (req.memberRole !== 'cmo') {
      allTasks = allTasks.filter(t =>
        req.memberDepts.includes(t.department) ||
        t.assignedTo === req.userId ||
        (t.sharedWith && t.sharedWith.includes(req.userId)) ||
        t.createdBy === req.userId
      );
    }

    const myTasks = allTasks.filter(t => t.assignedTo === req.userId || t.createdBy === req.userId);

    const dueToday = myTasks.filter(t => t.dueDate === today && t.status !== 'Completed');
    const overdue = myTasks.filter(t => t.dueDate && t.dueDate < today && t.status !== 'Completed' && t.status !== 'Delegated');

    // Coming this week (next 7 days, excluding today and overdue)
    const weekEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const comingThisWeek = myTasks.filter(t =>
      t.dueDate && t.dueDate > today && t.dueDate <= weekEnd && t.status !== 'Completed'
    ).sort((a, b) => a.dueDate.localeCompare(b.dueDate));

    // Completed this week
    const completedThisWeek = myTasks.filter(t =>
      t.status === 'Completed' && t.completedAt && t.completedAt >= weekAgo
    );

    const briefing = {
      name: req.memberName,
      dueToday: dueToday.map(t => ({ id: t.id, title: t.title })),
      overdue: overdue.map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate })),
      comingThisWeek: comingThisWeek.slice(0, 5).map(t => ({ id: t.id, title: t.title, dueDate: t.dueDate })),
      completedCount: completedThisWeek.length
    };

    // CMO extras: team stats
    if (req.memberRole === 'cmo') {
      const teamOverdue = allTasks.filter(t => t.dueDate && t.dueDate < today && t.status !== 'Completed' && t.status !== 'Delegated' && t.assignedTo !== req.userId);
      const teamCompletedThisWeek = allTasks.filter(t => t.status === 'Completed' && t.completedAt && t.completedAt >= weekAgo && t.createdBy !== req.userId);

      // Group team overdue by person
      const membersSnap = await orgCol(req, 'members').get();
      const memberNames = {};
      membersSnap.docs.forEach(d => { memberNames[d.data().userId] = d.data().displayName; });

      const overdueByPerson = {};
      teamOverdue.forEach(t => {
        const name = memberNames[t.assignedTo] || 'Unassigned';
        if (!overdueByPerson[name]) overdueByPerson[name] = 0;
        overdueByPerson[name]++;
      });

      briefing.teamOverdue = Object.entries(overdueByPerson).map(([name, count]) => ({ name, count }));
      briefing.teamCompletedCount = teamCompletedThisWeek.length;
    }

    res.json(briefing);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate briefing: ' + err.message });
  }
});

// === Feature Requests ===

// POST /api/feature-request — Submit a feature request (any authenticated user)
app.post('/api/feature-request', auth, async (req, res) => {
  try {
    const { description } = req.body;
    if (!description || !description.trim()) return res.status(400).json({ error: 'Description required' });

    // AI summarize the request
    let summary = description.trim();
    try {
      const model = getGeminiModel();
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: `Summarize this feature request in 1-2 clear sentences. Keep it concise and actionable. Just the summary, no preamble.\n\nRequest: "${description}"` }] }]
      });
      summary = result.response.text().trim();
    } catch { /* Use raw description if AI fails */ }

    // Save the request
    const request = {
      description: description.trim(),
      summary,
      requestedBy: req.userId,
      requestedByName: req.memberName,
      requestedByEmail: req.userEmail,
      status: 'new',
      createdAt: new Date().toISOString()
    };
    const ref = await orgCol(req, 'featureRequests').add(request);

    // Notify CMO
    const membersSnap = await orgCol(req, 'members').get();
    const cmo = membersSnap.docs.find(d => d.data().role === 'cmo');
    if (cmo && cmo.data().userId !== req.userId) {
      await createNotification(req.orgId, cmo.data().userId, {
        type: 'feature_request',
        title: `${req.memberName} suggested: ${summary.substring(0, 80)}`,
        fromUserId: req.userId,
        fromName: req.memberName
      });
    }

    res.status(201).json({ id: ref.id, summary });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit request: ' + err.message });
  }
});

// GET /api/feature-requests — List all feature requests (all users)
app.get('/api/feature-requests', auth, async (req, res) => {
  try {
    const snap = await orgCol(req, 'featureRequests').get();
    const requests = snap.docs.map(d => {
      const data = d.data();
      const votes = data.votes || {};
      const upvotes = Object.values(votes).filter(v => v === 'up').length;
      const downvotes = Object.values(votes).filter(v => v === 'down').length;
      return {
        id: d.id, summary: data.summary, description: data.description,
        requestedByName: data.requestedByName, status: data.status || 'new',
        createdAt: data.createdAt, upvotes, downvotes, score: upvotes - downvotes,
        myVote: votes[req.userId] || null
      };
    });
    requests.sort((a, b) => b.score - a.score || (b.createdAt || '').localeCompare(a.createdAt || ''));
    res.json(requests);
  } catch (err) { res.status(500).json({ error: 'Failed to fetch requests' }); }
});

// POST /api/feature-requests/:id/vote — Vote on a feature request
app.post('/api/feature-requests/:id/vote', auth, async (req, res) => {
  try {
    const { vote } = req.body; // 'up', 'down', or 'none' (remove vote)
    const ref = orgCol(req, 'featureRequests').doc(req.params.id);
    const doc = await ref.get();
    if (!doc.exists) return res.status(404).json({ error: 'Request not found' });

    const votes = doc.data().votes || {};
    if (vote === 'none') {
      delete votes[req.userId];
    } else {
      votes[req.userId] = vote;
    }
    await ref.update({ votes });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: 'Failed to vote' }); }
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

      // Extract body — handle nested multipart structures
      function extractTextBody(part) {
        if (part.mimeType === 'text/plain' && part.body && part.body.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
        if (part.parts) {
          for (const sub of part.parts) {
            const text = extractTextBody(sub);
            if (text) return text;
          }
        }
        // Fallback to text/html if no plain text found
        if (part.mimeType === 'text/html' && part.body && part.body.data) {
          const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
          return html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        }
        return '';
      }
      let body = extractTextBody(fullMsg.data.payload) || '';

      if (body.length > 5000) body = body.substring(0, 5000) + '\n\n[Truncated]';

      const notes = (from ? `From: ${from}\n` : '') + (date ? `Date: ${date}\n\n` : '\n') + body;

      const docRef = tasksRef.doc();
      batch.set(docRef, {
        title: subject || 'Forwarded email',
        department: detectDept(subject + ' ' + body),
        subDepartment: '',
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

app.listen(PORT, async () => {
  console.log(`CMO Task Manager running on port ${PORT}`);

  // One-time migration: update Welcome note content
  try {
    const orgsSnap = await db.collection('orgs').get();
    for (const orgDoc of orgsSnap.docs) {
      const foldersSnap = await orgDoc.ref.collection('folders').where('name', '==', 'All Team').get();
      if (foldersSnap.empty) continue;
      const allTeamFolderId = foldersSnap.docs[0].id;

      // Find the Welcome note
      const notesSnap = await orgDoc.ref.collection('notes')
        .where('folderId', '==', allTeamFolderId)
        .where('title', '==', 'Welcome!')
        .get();

      if (notesSnap.empty) {
        console.log('[Migration] No Welcome note found in All Team folder, skipping');
        continue;
      }

      const welcomeContent = `<h2>Welcome to Follett Marketing</h2>
<p>Hi team! I'm excited to share a tool I've built to help us stay organized and aligned across marketing. <strong>Follett Marketing</strong> is our task and strategy management app — think of it as our home base for tracking work, sharing notes, and staying on top of priorities.</p>

<h3>What you can do:</h3>

<p><strong>Tasks</strong> — Create, assign, and track tasks across your department. Each task has a priority, due date, status, subtasks, comments, and file attachments. Use the <strong>My Tasks / My Team / All</strong> toggles to focus your view.</p>

<p><strong>Strategy &amp; Notes</strong> — Keep meeting notes, strategy docs, and department documentation organized by folder. Notes are private by default — share them with specific people, your department, or the whole team. You can attach files and links to notes too.</p>

<p><strong>AI Assistant</strong> — Click the sparkle icon in the sidebar. It can see your tasks and notes to help with priorities, summaries, and strategy questions. Try asking "What should I focus on today?" You can also use <strong>Quick Add</strong> to paste an email or Slack message and let AI turn it into a task.</p>

<p><strong>Daily Briefing</strong> — Each morning when you log in, you'll see a personalized summary of what's due today, what's overdue, and what's coming up this week.</p>

<p><strong>Notifications</strong> — You'll get notified when tasks are assigned to you, when someone comments on your tasks, or when due dates are approaching.</p>

<h3>Getting started:</h3>
<ol>
<li>Use the password reset link I sent you to set your password</li>
<li>Log in with your email and password</li>
<li>Your assigned tasks and department tasks will be waiting for you</li>
<li>Create notes in Strategy &amp; Notes — they're private unless you share them</li>
</ol>

<h3>Task statuses:</h3>
<table>
<tr><th>Status</th><th>What it means</th></tr>
<tr><td>Not Started</td><td>Haven't begun yet</td></tr>
<tr><td>In Progress</td><td>Actively working on it</td></tr>
<tr><td>Blocked</td><td>Stuck on an external dependency — waiting on someone or something</td></tr>
<tr><td>Approved</td><td>Signed off — ready to finalize</td></tr>
<tr><td>Delegated</td><td>Assigned to someone else</td></tr>
<tr><td>Completed</td><td>Done!</td></tr>
</table>
<p>Update your statuses as you work — it helps everyone see where things stand without having to ask.</p>

<h3>Tips:</h3>
<ul>
<li>Set due dates on everything so we can sort by urgency</li>
<li>Use <strong>Quick Add</strong> to paste in emails or messages and create tasks instantly</li>
<li>Add subtasks to break big tasks into smaller pieces</li>
<li>Share notes when you want the team to see your strategy docs</li>
<li>Got an idea to make the app better? Use <strong>Ideas &amp; Feedback</strong> in the sidebar</li>
</ul>

<p>This is a living tool — we'll keep improving it together. If something is confusing, missing, or could be better, let me know in our next 1:1 or drop it in Ideas &amp; Feedback.</p>

<p>— Leann</p>`;

      for (const noteDoc of notesSnap.docs) {
        await noteDoc.ref.update({ content: welcomeContent, updatedAt: new Date().toISOString() });
        console.log('[Migration] Updated Welcome note:', noteDoc.id);
      }
    }
  } catch (err) {
    console.error('[Migration] Failed to update Welcome note:', err.message);
  }

  // One-time migration: rename "Awaiting Feedback" → "Blocked"
  try {
    const orgsSnap2 = await db.collection('orgs').get();
    for (const orgDoc of orgsSnap2.docs) {
      const tasksSnap = await orgDoc.ref.collection('tasks')
        .where('status', '==', 'Awaiting Feedback').get();
      if (tasksSnap.empty) continue;
      console.log(`[Migration] Renaming ${tasksSnap.size} "Awaiting Feedback" tasks to "Blocked" in org ${orgDoc.id}`);
      for (const taskDoc of tasksSnap.docs) {
        await taskDoc.ref.update({ status: 'Blocked' });
      }
    }
  } catch (err) {
    console.error('[Migration] Failed to rename Awaiting Feedback:', err.message);
  }
});
