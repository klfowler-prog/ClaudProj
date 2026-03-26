// === Constants ===
const DEPARTMENTS = ['B2B Marketing', 'Internal Comms', 'Rev Ops', 'B2C Marketing'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const STATUSES = ['Not Started', 'In Progress', 'Awaiting Feedback', 'Completed'];
const STORAGE_KEY = 'cmo_tasks';
const MIGRATION_KEY = 'cmo_migrated_to_cloud';

// === Auth State ===
let authToken = null;
let currentUser = null;

// === API Helper ===
async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

const DEPT_KEYS = {
  'B2B Marketing': 'b2b',
  'Internal Comms': 'comms',
  'Rev Ops': 'revops',
  'B2C Marketing': 'b2c'
};

const STATUS_KEYS = {
  'Not Started': 'not-started',
  'In Progress': 'in-progress',
  'Awaiting Feedback': 'awaiting',
  'Completed': 'completed'
};

// Keywords for auto-detecting department from imported content
const DEPT_KEYWORDS = {
  'B2B Marketing': ['b2b', 'enterprise', 'account-based', 'abm', 'lead gen', 'demand gen', 'sales enablement', 'whitepaper', 'case study', 'webinar', 'linkedin'],
  'Internal Comms': ['internal', 'comms', 'newsletter', 'all-hands', 'town hall', 'employee', 'culture', 'onboarding', 'intranet', 'announcement'],
  'Rev Ops': ['rev ops', 'revenue', 'operations', 'hubspot', 'salesforce', 'crm', 'pipeline', 'forecast', 'attribution', 'analytics', 'reporting', 'dashboard'],
  'B2C Marketing': ['b2c', 'consumer', 'social media', 'instagram', 'tiktok', 'influencer', 'brand', 'campaign', 'creative', 'content marketing', 'seo', 'paid media']
};

// === State ===
let tasks = [];
let filters = { department: 'all', priority: 'all', search: '' };
let pendingAttachments = []; // temp attachments for the add-task form
let pendingLinks = [];       // temp links for the add-task form
let editingTaskId = null;    // null = adding, string = editing
let deleteConfirmId = null;  // track which task is awaiting delete confirm

// === Persistence (API-backed) ===
async function loadTasks() {
  try {
    tasks = await api('GET', '/api/tasks');
  } catch (err) {
    console.error('Failed to load tasks:', err);
    tasks = [];
  }
}

// No-op: each mutation calls the API directly
function saveTasks() {}

// === localStorage Migration ===
async function migrateLocalStorage() {
  if (localStorage.getItem(MIGRATION_KEY)) return;

  const data = localStorage.getItem(STORAGE_KEY);
  if (!data) {
    localStorage.setItem(MIGRATION_KEY, 'done');
    return;
  }

  let localTasks;
  try { localTasks = JSON.parse(data); } catch { return; }
  if (!localTasks || localTasks.length === 0) {
    localStorage.setItem(MIGRATION_KEY, 'done');
    return;
  }

  // Migrate status for old tasks
  localTasks.forEach(t => {
    if (!t.status) {
      t.status = t.completed ? 'Completed' : 'Not Started';
      t.completedAt = t.completed ? (t.completedAt || new Date().toISOString()) : '';
    }
  });

  const count = localTasks.length;
  if (!confirm(`Found ${count} task${count !== 1 ? 's' : ''} saved locally on this device. Import them to your cloud account?`)) {
    return;
  }

  try {
    await api('POST', '/api/tasks/batch', { tasks: localTasks });
    localStorage.setItem(MIGRATION_KEY, 'done');
    alert(`Successfully imported ${count} task${count !== 1 ? 's' : ''} to the cloud!`);
    await loadTasks();
    render();
  } catch (err) {
    alert('Migration failed: ' + err.message + '. Your local tasks are still safe. Try again on next login.');
  }
}

// === Rendering ===
function render() {
  renderStats();
  renderDepartmentCards();
  renderTaskList();
}

function renderStats() {
  const active = tasks.filter(t => t.status !== 'Completed');
  const completed = tasks.filter(t => t.status === 'Completed');
  const awaiting = tasks.filter(t => t.status === 'Awaiting Feedback').length;
  const today = new Date().toISOString().split('T')[0];
  const overdue = tasks.filter(t => t.status !== 'Completed' && t.dueDate && t.dueDate < today).length;
  document.getElementById('stat-total').textContent = active.length;
  document.getElementById('stat-completed').textContent = completed.length;
  document.getElementById('stat-awaiting').textContent = awaiting;
  document.getElementById('stat-overdue').textContent = overdue;
}

function renderDepartmentCards() {
  for (const dept of DEPARTMENTS) {
    const key = DEPT_KEYS[dept];
    const deptTasks = tasks.filter(t => t.department === dept);
    const total = deptTasks.length;
    const done = deptTasks.filter(t => t.status === 'Completed').length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    document.getElementById(`dept-count-${key}`).textContent = `${total} task${total !== 1 ? 's' : ''}`;
    document.getElementById(`dept-done-${key}`).textContent = `${done} done`;
    document.getElementById(`dept-bar-${key}`).style.width = pct + '%';
  }

  // Highlight active department filter
  document.querySelectorAll('.dept-card').forEach(card => {
    card.classList.toggle('active', card.dataset.dept === filters.department);
  });
}

function renderTaskItem(task) {
  const deptKey = DEPT_KEYS[task.department] || 'b2b';
  const prioKey = task.priority.toLowerCase();
  const statusKey = STATUS_KEYS[task.status] || 'not-started';
  const hasAttachments = task.attachments && task.attachments.length > 0;
  const sourceLabel = task.source === 'email' ? '&#9993; Email' : task.source === 'slack' ? '# Slack' : '';
  const isConfirming = deleteConfirmId === task.id;
  const isCompleted = task.status === 'Completed';
  const dueDateHtml = formatDueDate(task.dueDate, isCompleted);

  const statusOptions = STATUSES.map(s =>
    `<option value="${s}" ${s === task.status ? 'selected' : ''}>${s}</option>`
  ).join('');

  return `
    <div class="task-item ${isCompleted ? 'completed' : ''} status-${statusKey}" data-id="${task.id}">
      <select class="status-select status-${statusKey}" data-action="status" data-id="${task.id}" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
        ${statusOptions}
      </select>
      <div class="task-body" data-action="detail" data-id="${task.id}">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          <span class="badge badge-${deptKey}">${escapeHtml(task.department)}</span>
          <span class="badge badge-${prioKey}">${task.priority}</span>
          ${dueDateHtml}
          ${isCompleted && task.completedAt ? `<span class="task-source">Done ${new Date(task.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>` : ''}
          ${!isCompleted && sourceLabel ? `<span class="task-source">${sourceLabel}</span>` : ''}
        </div>
      </div>
      ${hasAttachments ? '<span class="task-attachment-icon" title="Has attachments">&#128206;</span>' : ''}
      <div class="task-actions">
        ${isConfirming
          ? `<button class="confirm-delete" data-action="confirm-delete" data-id="${task.id}">Delete?</button>
             <button class="btn-danger" data-action="cancel-delete" data-id="${task.id}" title="Cancel">&#10005;</button>`
          : `<button class="btn-danger" data-action="delete" data-id="${task.id}" title="Delete task">&#128465;</button>`}
      </div>
    </div>`;
}

function renderTaskList() {
  const filtered = getFilteredTasks();
  const container = document.getElementById('task-list');
  const emptyState = document.getElementById('empty-state');
  const completedSection = document.getElementById('completed-section');
  const completedList = document.getElementById('completed-list');
  const completedCount = document.getElementById('completed-count');

  const activeTasks = filtered.filter(t => t.status !== 'Completed');
  const completedTasks = getFilteredCompletedTasks();

  // Active tasks
  if (activeTasks.length === 0 && completedTasks.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    if (tasks.length === 0) {
      document.querySelector('.empty-title').textContent = 'No tasks yet';
      document.querySelector('.empty-subtitle').textContent = 'Click "Add Task" to get started, or import from email/Slack';
    } else {
      document.querySelector('.empty-title').textContent = 'No matching tasks';
      document.querySelector('.empty-subtitle').textContent = 'Try adjusting your filters';
    }
    completedSection.style.display = 'none';
    return;
  }

  emptyState.style.display = activeTasks.length === 0 && completedTasks.length > 0 ? 'none' : 'none';
  if (activeTasks.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding: 1.5rem;"><p class="empty-subtitle">All filtered tasks are completed</p></div>';
  } else {
    emptyState.style.display = 'none';
    // Group by status
    const grouped = {};
    ['Awaiting Feedback', 'In Progress', 'Not Started'].forEach(s => {
      const group = activeTasks.filter(t => t.status === s);
      if (group.length > 0) grouped[s] = group;
    });

    let html = '';
    for (const [status, group] of Object.entries(grouped)) {
      const statusKey = STATUS_KEYS[status];
      html += `<div class="status-group-header status-header-${statusKey}">${status} <span class="status-group-count">${group.length}</span></div>`;
      html += group.map(renderTaskItem).join('');
    }
    container.innerHTML = html;
  }

  // Completed section
  if (completedTasks.length > 0) {
    completedSection.style.display = 'block';
    completedCount.textContent = completedTasks.length;
    completedList.innerHTML = completedTasks.map(renderTaskItem).join('');
    // Auto-expand if there are no active tasks
    if (activeTasks.length === 0) {
      completedList.style.display = 'flex';
      document.getElementById('completed-toggle').textContent = 'Hide';
    }
  } else {
    completedSection.style.display = 'none';
  }
}

function getFilteredCompletedTasks() {
  const completedPeriod = document.getElementById('completed-period') ?
    document.getElementById('completed-period').value : 'all';
  let completed = getFilteredTasks().filter(t => t.status === 'Completed');

  if (completedPeriod !== 'all') {
    const now = new Date();
    let cutoff;
    if (completedPeriod === 'week') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    } else if (completedPeriod === 'month') {
      cutoff = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    } else if (completedPeriod === 'quarter') {
      cutoff = new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    }
    completed = completed.filter(t => t.completedAt && new Date(t.completedAt) >= cutoff);
  }
  return completed;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// === Due Date Formatting ===
function formatDueDate(dueDate, isCompleted) {
  if (!dueDate) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + 'T00:00:00');
  const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
  const dateLabel = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (isCompleted) {
    return `<span class="task-due-date">${dateLabel}</span>`;
  }
  if (diffDays < 0) {
    return `<span class="task-due-date overdue">Overdue \u00b7 ${dateLabel}</span>`;
  }
  if (diffDays === 0) {
    return `<span class="task-due-date due-today">Due today</span>`;
  }
  if (diffDays <= 3) {
    return `<span class="task-due-date due-soon">Due in ${diffDays}d</span>`;
  }
  return `<span class="task-due-date">${dateLabel}</span>`;
}

// === Filtering ===
function getFilteredTasks() {
  return tasks.filter(t => {
    if (filters.department !== 'all' && t.department !== filters.department) return false;
    if (filters.priority !== 'all' && t.priority !== filters.priority) return false;
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!t.title.toLowerCase().includes(q) && !(t.notes || '').toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

function applyFilters() {
  filters.department = document.getElementById('filter-department').value;
  filters.priority = document.getElementById('filter-priority').value;
  filters.search = document.getElementById('filter-search').value;
  render();
}

// === Task Operations (API-backed) ===
async function addTask(title, department, priority, notes, source, attachments, dueDate) {
  const taskData = {
    title: title.trim(),
    department,
    priority: priority || 'Medium',
    notes: notes || '',
    status: 'Not Started',
    completedAt: '',
    createdAt: new Date().toISOString(),
    source: source || 'manual',
    attachments: attachments || [],
    dueDate: dueDate || ''
  };

  try {
    const created = await api('POST', '/api/tasks', taskData);
    tasks.unshift(created);
    render();
    return created;
  } catch (err) {
    alert('Failed to create task: ' + err.message);
    return null;
  }
}

async function setTaskStatus(id, newStatus) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const updates = {
    status: newStatus,
    completed: newStatus === 'Completed',
    completedAt: newStatus === 'Completed' ? (task.completedAt || new Date().toISOString()) : ''
  };

  // Optimistic update
  Object.assign(task, updates);
  render();

  try {
    await api('PUT', `/api/tasks/${id}`, updates);
  } catch (err) {
    // Revert on failure
    await loadTasks();
    render();
    alert('Failed to update status: ' + err.message);
  }
}

async function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  deleteConfirmId = null;
  render();

  try {
    await api('DELETE', `/api/tasks/${id}`);
  } catch (err) {
    await loadTasks();
    render();
    alert('Failed to delete task: ' + err.message);
  }
}

// === Edit Task ===
function editTask(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  closeModal('modal-detail');
  editingTaskId = id;

  document.getElementById('input-title').value = task.title;
  document.getElementById('input-department').value = task.department;
  document.getElementById('input-priority').value = task.priority;
  document.getElementById('input-due-date').value = task.dueDate || '';
  document.getElementById('input-notes').value = task.notes || '';

  // Load existing attachments into pending lists
  pendingAttachments = (task.attachments || []).filter(a => a.type === 'file');
  pendingLinks = (task.attachments || []).filter(a => a.type === 'link');
  renderPendingAttachments();
  renderPendingLinks();

  document.getElementById('modal-add-title').textContent = 'Edit Task';
  document.getElementById('btn-submit-task').textContent = 'Save Changes';
  openModal('modal-add');
}

// === Department Auto-detection ===
function detectDepartment(text) {
  const lower = text.toLowerCase();
  let bestDept = '';
  let bestScore = 0;

  for (const [dept, keywords] of Object.entries(DEPT_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestDept = dept;
    }
  }
  return bestDept;
}

// === Modal Helpers ===
function openModal(id) {
  document.getElementById(id).style.display = 'flex';
  // Focus first input
  setTimeout(() => {
    const input = document.querySelector(`#${id} input[type="text"], #${id} textarea`);
    if (input) input.focus();
  }, 50);
}

function closeModal(id) {
  document.getElementById(id).style.display = 'none';
}

function resetAddForm() {
  editingTaskId = null;
  document.getElementById('form-add-task').reset();
  document.getElementById('input-priority').value = 'Medium';
  document.getElementById('modal-add-title').textContent = 'Add Task';
  document.getElementById('btn-submit-task').textContent = 'Add Task';
  pendingAttachments = [];
  pendingLinks = [];
  renderPendingAttachments();
  renderPendingLinks();
}

// === Attachment Handling ===
function handleFiles(files) {
  for (const file of files) {
    if (file.size > 2 * 1024 * 1024) {
      alert(`File "${file.name}" is too large (max 2MB). Use a link instead.`);
      continue;
    }
    const reader = new FileReader();
    reader.onload = () => {
      pendingAttachments.push({
        type: 'file',
        name: file.name,
        data: reader.result
      });
      renderPendingAttachments();
    };
    reader.readAsDataURL(file);
  }
}

function renderPendingAttachments() {
  const list = document.getElementById('attachment-list');
  list.innerHTML = pendingAttachments.map((a, i) => `
    <div class="attachment-item">
      <span class="attachment-item-name">&#128196; ${escapeHtml(a.name)}</span>
      <button class="attachment-remove" data-attachment-idx="${i}">&times;</button>
    </div>
  `).join('');
}

function renderPendingLinks() {
  const list = document.getElementById('link-list');
  list.innerHTML = pendingLinks.map((l, i) => `
    <div class="link-item">
      <span class="link-item-name">&#128279; ${escapeHtml(l.name || l.url)}</span>
      <button class="link-remove" data-link-idx="${i}">&times;</button>
    </div>
  `).join('');
}

// === Task Detail View ===
function showTaskDetail(id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;

  const deptKey = DEPT_KEYS[task.department] || 'b2b';
  const prioKey = task.priority.toLowerCase();
  const date = new Date(task.createdAt);
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

  let attachmentsHtml = '';
  if (task.attachments && task.attachments.length > 0) {
    const items = task.attachments.map(a => {
      if (a.type === 'file') {
        return `<li><a href="${a.data}" download="${escapeHtml(a.name)}">&#128196; ${escapeHtml(a.name)}</a></li>`;
      } else {
        return `<li><a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">&#128279; ${escapeHtml(a.name || a.url)}</a></li>`;
      }
    }).join('');
    attachmentsHtml = `
      <div class="detail-section">
        <div class="detail-section-title">Attachments</div>
        <ul class="detail-attachments">${items}</ul>
      </div>`;
  }

  document.getElementById('detail-title').textContent = task.title;
  document.getElementById('detail-content').innerHTML = `
    <div class="detail-badges">
      <span class="badge badge-${deptKey}">${escapeHtml(task.department)}</span>
      <span class="badge badge-${prioKey}">${task.priority}</span>
      ${task.source !== 'manual' ? `<span class="badge badge-low">${task.source === 'email' ? '&#9993; Email' : '# Slack'}</span>` : ''}
    </div>
    ${task.notes ? `<div class="detail-section"><div class="detail-section-title">Notes</div><div class="detail-notes">${escapeHtml(task.notes)}</div></div>` : ''}
    ${attachmentsHtml}
    <div class="detail-section">
      <div class="detail-section-title">Status</div>
      <span class="badge badge-status-${STATUS_KEYS[task.status] || 'not-started'}">${task.status}</span>
      ${task.completedAt ? `<span style="font-size: 0.8rem; color: var(--color-text-light); margin-left: 0.5rem;">Completed ${new Date(task.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>` : ''}
    </div>
    ${task.dueDate ? `<div class="detail-section"><div class="detail-section-title">Due Date</div><div>${formatDueDate(task.dueDate, task.status === 'Completed')} &mdash; ${new Date(task.dueDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div></div>` : ''}
    <div class="detail-timestamp">Created ${dateStr}</div>
    <div class="detail-actions">
      <button class="btn btn-primary" onclick="editTask('${task.id}')">Edit Task</button>
    </div>
  `;
  openModal('modal-detail');
}

// === Quick Import Logic ===
function parseImportText(text) {
  const lines = text.trim().split('\n');
  let title = '';
  let notes = '';
  let source = 'manual';

  // Try to detect email format (Subject: / From: headers)
  const subjectMatch = text.match(/^Subject:\s*(.+)$/mi);
  const fromMatch = text.match(/^From:\s*(.+)$/mi);

  if (subjectMatch) {
    title = subjectMatch[1].trim();
    // Remove common forwarding prefixes
    title = title.replace(/^(Fw|Fwd|Re):\s*/i, '');
    notes = text;
    source = 'email';
  } else {
    // First line = title, rest = notes
    title = lines[0].trim();
    if (title.length > 120) title = title.substring(0, 120) + '...';
    notes = lines.slice(1).join('\n').trim();
  }

  // Detect if it looks like email or slack
  if (fromMatch || text.includes('Subject:') || text.includes('From:')) {
    source = 'email';
  } else if (text.includes('#') && text.match(/#[\w-]+/)) {
    source = 'slack';
  }

  const detectedDept = detectDepartment(text);
  return { title, notes, source, detectedDept };
}

function handleImport(e) {
  e.preventDefault();
  const pasteText = document.getElementById('import-paste').value.trim();
  if (!pasteText) return;

  const department = document.getElementById('import-department').value;
  const priority = document.getElementById('import-priority').value;
  const dueDate = document.getElementById('import-due-date').value;

  const parsed = parseImportText(pasteText);
  const finalDept = department || parsed.detectedDept || 'B2B Marketing';

  addTask(parsed.title, finalDept, priority, parsed.notes, parsed.source, [], dueDate);
  closeModal('modal-import');
  document.getElementById('form-import').reset();
  document.getElementById('import-preview').style.display = 'none';
}

function updateImportPreview() {
  const text = document.getElementById('import-paste').value.trim();
  const preview = document.getElementById('import-preview');
  if (!text) {
    preview.style.display = 'none';
    return;
  }
  const parsed = parseImportText(text);
  document.getElementById('import-preview-title').textContent = parsed.title || '(no title)';
  const dept = document.getElementById('import-department').value || parsed.detectedDept;
  document.getElementById('import-preview-dept').textContent = dept ? `Department: ${dept}` : 'Department: Auto-detect';
  preview.style.display = 'block';
}

// === Gmail Sync ===
async function checkGmailStatus() {
  try {
    const status = await api('GET', '/api/gmail/status');
    const syncBtn = document.getElementById('btn-sync-email');
    if (status.connected) {
      syncBtn.innerHTML = '&#8635; Sync Email';
      syncBtn.title = `Connected to ${status.email}`;
    } else {
      syncBtn.innerHTML = '&#9993; Connect Gmail';
      syncBtn.title = 'Connect your task inbox';
    }
    return status.connected;
  } catch {
    return false;
  }
}

async function handleSyncClick() {
  const connected = await checkGmailStatus();

  if (!connected) {
    // Start OAuth flow
    try {
      const { url } = await api('GET', '/api/gmail/auth');
      window.open(url, 'gmail-auth', 'width=500,height=600');
      // Poll for connection status
      const poll = setInterval(async () => {
        const status = await api('GET', '/api/gmail/status');
        if (status.connected) {
          clearInterval(poll);
          await checkGmailStatus();
          alert(`Connected to ${status.email}! Click "Sync Email" to import messages.`);
        }
      }, 2000);
      // Stop polling after 5 minutes
      setTimeout(() => clearInterval(poll), 300000);
    } catch (err) {
      alert('Failed to start Gmail authorization: ' + err.message);
    }
    return;
  }

  // Already connected — sync emails
  try {
    document.getElementById('btn-sync-email').innerHTML = '&#8987; Syncing...';
    const result = await api('POST', '/api/sync');
    if (result.synced > 0) {
      await loadTasks();
      render();
      alert(`Synced ${result.synced} new email${result.synced !== 1 ? 's' : ''} as tasks!`);
    } else {
      alert('No new unread emails to sync.');
    }
  } catch (err) {
    alert('Sync failed: ' + err.message);
  }
  await checkGmailStatus();
}

// === Event Binding ===
async function init() {
  await loadTasks();
  await migrateLocalStorage();

  // Add Task button
  document.getElementById('btn-add-task').addEventListener('click', () => {
    resetAddForm();
    openModal('modal-add');
  });

  // Quick Import button
  document.getElementById('btn-quick-import').addEventListener('click', () => {
    document.getElementById('form-import').reset();
    document.getElementById('import-preview').style.display = 'none';
    openModal('modal-import');
  });

  // Sync Email / Connect Gmail button
  document.getElementById('btn-sync-email').addEventListener('click', handleSyncClick);
  checkGmailStatus();

  // Import form submit + live preview
  document.getElementById('form-import').addEventListener('submit', handleImport);
  document.getElementById('import-paste').addEventListener('input', updateImportPreview);
  document.getElementById('import-department').addEventListener('change', updateImportPreview);

  // Add/Edit task form submit
  document.getElementById('form-add-task').addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('input-title').value.trim();
    const department = document.getElementById('input-department').value;
    const priority = document.getElementById('input-priority').value;
    const notes = document.getElementById('input-notes').value.trim();
    const dueDate = document.getElementById('input-due-date').value;

    if (!title || !department) return;

    const allAttachments = [...pendingAttachments, ...pendingLinks];

    if (editingTaskId) {
      // Update existing task via API
      const updates = { title, department, priority, notes, dueDate, attachments: allAttachments };
      try {
        await api('PUT', `/api/tasks/${editingTaskId}`, updates);
        const task = tasks.find(t => t.id === editingTaskId);
        if (task) Object.assign(task, updates);
        render();
      } catch (err) {
        alert('Failed to update task: ' + err.message);
      }
    } else {
      await addTask(title, department, priority, notes, 'manual', allAttachments, dueDate);
    }

    closeModal('modal-add');
    resetAddForm();
  });

  // Close modals
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.close));
  });

  // Close modal on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Close modal on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay').forEach(overlay => {
        if (overlay.style.display !== 'none') closeModal(overlay.id);
      });
    }
  });

  // Filters
  document.getElementById('filter-department').addEventListener('change', applyFilters);
  document.getElementById('filter-priority').addEventListener('change', applyFilters);
  document.getElementById('filter-search').addEventListener('input', applyFilters);

  // Department card clicks
  document.querySelectorAll('.dept-card').forEach(card => {
    card.addEventListener('click', () => {
      const dept = card.dataset.dept;
      const filterEl = document.getElementById('filter-department');
      // Toggle: if already selected, go back to all
      filterEl.value = filterEl.value === dept ? 'all' : dept;
      applyFilters();
    });
  });

  // Task list event delegation (for both active + completed lists)
  function handleTaskClick(e) {
    // Ignore clicks on the status select — let the browser handle it natively
    if (e.target.matches('select[data-action="status"]') || e.target.matches('select[data-action="status"] option')) {
      return;
    }

    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id;

    switch (action) {
      case 'detail':
        showTaskDetail(id);
        break;
      case 'delete':
        deleteConfirmId = id;
        render();
        break;
      case 'confirm-delete':
        deleteTask(id);
        break;
      case 'cancel-delete':
        deleteConfirmId = null;
        render();
        break;
    }
  }

  function handleTaskChange(e) {
    if (e.target.matches('select[data-action="status"]')) {
      setTaskStatus(e.target.dataset.id, e.target.value);
    }
  }

  document.getElementById('task-list').addEventListener('click', handleTaskClick);
  document.getElementById('task-list').addEventListener('change', handleTaskChange);
  document.getElementById('completed-list').addEventListener('click', handleTaskClick);
  document.getElementById('completed-list').addEventListener('change', handleTaskChange);

  // Completed period filter
  document.getElementById('completed-period').addEventListener('change', render);

  // Completed section toggle
  document.getElementById('completed-toggle').addEventListener('click', () => {
    const list = document.getElementById('completed-list');
    const toggle = document.getElementById('completed-toggle');
    const isHidden = list.style.display === 'none';
    list.style.display = isHidden ? 'flex' : 'none';
    toggle.textContent = isHidden ? 'Hide' : 'Show';
  });

  // File drag & drop
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFiles(e.dataTransfer.files);
  });

  dropZone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });

  // Remove pending attachment
  document.getElementById('attachment-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-attachment-idx]');
    if (btn) {
      pendingAttachments.splice(parseInt(btn.dataset.attachmentIdx), 1);
      renderPendingAttachments();
    }
  });

  // Add link
  document.getElementById('btn-add-link').addEventListener('click', () => {
    const name = document.getElementById('input-link-name').value.trim();
    const url = document.getElementById('input-link-url').value.trim();
    if (!url) return;
    pendingLinks.push({ type: 'link', name: name || url, url });
    document.getElementById('input-link-name').value = '';
    document.getElementById('input-link-url').value = '';
    renderPendingLinks();
  });

  // Remove pending link
  document.getElementById('link-list').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-link-idx]');
    if (btn) {
      pendingLinks.splice(parseInt(btn.dataset.linkIdx), 1);
      renderPendingLinks();
    }
  });

  // Initial render
  render();
}

// === Firebase Auth & Boot ===
document.addEventListener('DOMContentLoaded', () => {
  const loginScreen = document.getElementById('login-screen');
  const appContainer = document.getElementById('app-container');
  const btnLogin = document.getElementById('btn-google-login');
  const btnSignOut = document.getElementById('btn-sign-out');
  const userEmail = document.getElementById('user-email');

  btnLogin.addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider).catch(err => {
      alert('Sign-in failed: ' + err.message);
    });
  });

  btnSignOut.addEventListener('click', () => {
    firebase.auth().signOut();
  });

  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      currentUser = user;
      authToken = await user.getIdToken();
      userEmail.textContent = user.email;
      loginScreen.style.display = 'none';
      appContainer.style.display = 'block';
      await init();
    } else {
      currentUser = null;
      authToken = null;
      tasks = [];
      loginScreen.style.display = 'flex';
      appContainer.style.display = 'none';
    }
  });

  // Refresh token before expiry (tokens last 1 hour)
  setInterval(async () => {
    if (currentUser) {
      authToken = await currentUser.getIdToken(true);
    }
  }, 50 * 60 * 1000); // Refresh every 50 minutes
});
