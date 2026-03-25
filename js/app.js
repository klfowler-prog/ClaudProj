// === Constants ===
const DEPARTMENTS = ['B2B Marketing', 'Internal Comms', 'Rev Ops', 'B2C Marketing'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const STORAGE_KEY = 'cmo_tasks';

const DEPT_KEYS = {
  'B2B Marketing': 'b2b',
  'Internal Comms': 'comms',
  'Rev Ops': 'revops',
  'B2C Marketing': 'b2c'
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

// === Persistence ===
function loadTasks() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    tasks = data ? JSON.parse(data) : [];
  } catch {
    tasks = [];
  }
}

function saveTasks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}

// === Rendering ===
function render() {
  renderStats();
  renderDepartmentCards();
  renderTaskList();
}

function renderStats() {
  const total = tasks.length;
  const completed = tasks.filter(t => t.completed).length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  const today = new Date().toISOString().split('T')[0];
  const overdue = tasks.filter(t => !t.completed && t.dueDate && t.dueDate < today).length;
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-completed').textContent = completed;
  document.getElementById('stat-percent').textContent = pct + '%';
  document.getElementById('stat-overdue').textContent = overdue;
}

function renderDepartmentCards() {
  for (const dept of DEPARTMENTS) {
    const key = DEPT_KEYS[dept];
    const deptTasks = tasks.filter(t => t.department === dept);
    const total = deptTasks.length;
    const done = deptTasks.filter(t => t.completed).length;
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

function renderTaskList() {
  const filtered = getFilteredTasks();
  const container = document.getElementById('task-list');
  const emptyState = document.getElementById('empty-state');

  if (filtered.length === 0) {
    container.innerHTML = '';
    emptyState.style.display = 'block';
    if (tasks.length === 0) {
      document.querySelector('.empty-title').textContent = 'No tasks yet';
      document.querySelector('.empty-subtitle').textContent = 'Click "Add Task" to get started, or import from email/Slack';
    } else {
      document.querySelector('.empty-title').textContent = 'No matching tasks';
      document.querySelector('.empty-subtitle').textContent = 'Try adjusting your filters';
    }
    return;
  }

  emptyState.style.display = 'none';
  container.innerHTML = filtered.map(task => {
    const deptKey = DEPT_KEYS[task.department] || 'b2b';
    const prioKey = task.priority.toLowerCase();
    const hasAttachments = task.attachments && task.attachments.length > 0;
    const sourceLabel = task.source === 'email' ? '&#9993; Email' : task.source === 'slack' ? '# Slack' : '';
    const isConfirming = deleteConfirmId === task.id;
    const dueDateHtml = formatDueDate(task.dueDate, task.completed);

    return `
      <div class="task-item ${task.completed ? 'completed' : ''}" data-id="${task.id}">
        <div class="task-checkbox" data-action="toggle" data-id="${task.id}">${task.completed ? '&#10003;' : ''}</div>
        <div class="task-body" data-action="detail" data-id="${task.id}">
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-meta">
            <span class="badge badge-${deptKey}">${escapeHtml(task.department)}</span>
            <span class="badge badge-${prioKey}">${task.priority}</span>
            ${dueDateHtml}
            ${sourceLabel ? `<span class="task-source">${sourceLabel}</span>` : ''}
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
  }).join('');
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// === Due Date Formatting ===
function formatDueDate(dueDate, completed) {
  if (!dueDate) return '';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + 'T00:00:00');
  const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));
  const dateLabel = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (completed) {
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

// === Task Operations ===
function addTask(title, department, priority, notes, source, attachments, dueDate) {
  const task = {
    id: crypto.randomUUID(),
    title: title.trim(),
    department,
    priority: priority || 'Medium',
    notes: notes || '',
    completed: false,
    createdAt: new Date().toISOString(),
    source: source || 'manual',
    attachments: attachments || [],
    dueDate: dueDate || ''
  };
  tasks.unshift(task);
  saveTasks();
  render();
  return task;
}

function toggleTask(id) {
  const task = tasks.find(t => t.id === id);
  if (task) {
    task.completed = !task.completed;
    saveTasks();
    render();
  }
}

function deleteTask(id) {
  tasks = tasks.filter(t => t.id !== id);
  deleteConfirmId = null;
  saveTasks();
  render();
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
    ${task.dueDate ? `<div class="detail-section"><div class="detail-section-title">Due Date</div><div>${formatDueDate(task.dueDate, task.completed)} &mdash; ${new Date(task.dueDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div></div>` : ''}
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

// === Email Sync ===
const SYNC_SHEET_KEY = 'cmo_sync_sheet_url';
const SYNC_LAST_KEY = 'cmo_sync_last_row';

function getSyncSheetId() {
  const url = localStorage.getItem(SYNC_SHEET_KEY) || '';
  const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : '';
}

async function syncFromSheet() {
  const sheetId = getSyncSheetId();
  if (!sheetId) {
    openModal('modal-sync');
    return;
  }

  const csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json`;
  try {
    const response = await fetch(csvUrl);
    const text = await response.text();
    // Google Sheets JSON response is wrapped in google.visualization.Query.setResponse(...)
    const jsonStr = text.match(/google\.visualization\.Query\.setResponse\((.+)\)/);
    if (!jsonStr) throw new Error('Could not parse sheet data');

    const data = JSON.parse(jsonStr[1]);
    const rows = data.table.rows;
    const lastSynced = parseInt(localStorage.getItem(SYNC_LAST_KEY) || '0');
    let newCount = 0;

    for (let i = lastSynced; i < rows.length; i++) {
      const cells = rows[i].c;
      if (!cells || !cells[0]) continue;

      const subject = (cells[0] && cells[0].v) || 'Forwarded email';
      const from = (cells[1] && cells[1].v) || '';
      const body = (cells[2] && cells[2].v) || '';
      const timestamp = (cells[3] && cells[3].v) || '';

      const notes = (from ? `From: ${from}\n` : '') + (timestamp ? `Date: ${timestamp}\n\n` : '\n') + body;
      const dept = detectDepartment(subject + ' ' + body) || 'B2B Marketing';
      addTask(subject, dept, 'Medium', notes, 'email', [], '');
      newCount++;
    }

    localStorage.setItem(SYNC_LAST_KEY, String(rows.length));
    if (newCount > 0) {
      alert(`Synced ${newCount} new email${newCount !== 1 ? 's' : ''} as tasks!`);
    } else {
      alert('No new emails to sync.');
    }
  } catch (err) {
    alert('Sync failed: ' + err.message + '\n\nMake sure the Google Sheet is shared as "Anyone with the link can view".');
  }
}

// === Event Binding ===
function init() {
  loadTasks();

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

  // Sync Email button
  document.getElementById('btn-sync-email').addEventListener('click', syncFromSheet);

  // Import form submit + live preview
  document.getElementById('form-import').addEventListener('submit', handleImport);
  document.getElementById('import-paste').addEventListener('input', updateImportPreview);
  document.getElementById('import-department').addEventListener('change', updateImportPreview);

  // Sync settings save
  document.getElementById('btn-save-sync').addEventListener('click', () => {
    const url = document.getElementById('sync-sheet-url').value.trim();
    if (url) {
      localStorage.setItem(SYNC_SHEET_KEY, url);
      closeModal('modal-sync');
      syncFromSheet();
    }
  });

  // Load saved sheet URL into settings modal
  const savedUrl = localStorage.getItem(SYNC_SHEET_KEY);
  if (savedUrl) document.getElementById('sync-sheet-url').value = savedUrl;

  // Add/Edit task form submit
  document.getElementById('form-add-task').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('input-title').value.trim();
    const department = document.getElementById('input-department').value;
    const priority = document.getElementById('input-priority').value;
    const notes = document.getElementById('input-notes').value.trim();
    const dueDate = document.getElementById('input-due-date').value;

    if (!title || !department) return;

    const allAttachments = [...pendingAttachments, ...pendingLinks];

    if (editingTaskId) {
      // Update existing task
      const task = tasks.find(t => t.id === editingTaskId);
      if (task) {
        task.title = title;
        task.department = department;
        task.priority = priority;
        task.notes = notes;
        task.dueDate = dueDate;
        task.attachments = allAttachments;
        saveTasks();
        render();
      }
    } else {
      addTask(title, department, priority, notes, 'manual', allAttachments, dueDate);
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

  // Task list event delegation
  document.getElementById('task-list').addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');
    if (!target) return;

    const action = target.dataset.action;
    const id = target.dataset.id;

    switch (action) {
      case 'toggle':
        toggleTask(id);
        break;
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

// === Boot ===
document.addEventListener('DOMContentLoaded', init);
