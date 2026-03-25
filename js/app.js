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
  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-completed').textContent = completed;
  document.getElementById('stat-percent').textContent = pct + '%';
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

    return `
      <div class="task-item ${task.completed ? 'completed' : ''}" data-id="${task.id}">
        <div class="task-checkbox" data-action="toggle" data-id="${task.id}">${task.completed ? '&#10003;' : ''}</div>
        <div class="task-body" data-action="detail" data-id="${task.id}">
          <div class="task-title">${escapeHtml(task.title)}</div>
          <div class="task-meta">
            <span class="badge badge-${deptKey}">${escapeHtml(task.department)}</span>
            <span class="badge badge-${prioKey}">${task.priority}</span>
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
function addTask(title, department, priority, notes, source, attachments) {
  const task = {
    id: crypto.randomUUID(),
    title: title.trim(),
    department,
    priority: priority || 'Medium',
    notes: notes || '',
    completed: false,
    createdAt: new Date().toISOString(),
    source: source || 'manual',
    attachments: attachments || []
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
    <div class="detail-timestamp">Created ${dateStr}</div>
  `;
  openModal('modal-detail');
}

// === Import Logic ===
function handleImport(e) {
  e.preventDefault();
  const activeTab = document.querySelector('.import-tab.active').dataset.tab;
  const department = document.getElementById('import-department').value;
  const priority = document.getElementById('import-priority').value;

  let title, notes, source;

  if (activeTab === 'email') {
    const subject = document.getElementById('import-email-subject').value.trim();
    const from = document.getElementById('import-email-from').value.trim();
    const body = document.getElementById('import-email-body').value.trim();
    title = subject || 'Imported email task';
    notes = (from ? `From: ${from}\n\n` : '') + body;
    source = 'email';
  } else {
    const channel = document.getElementById('import-slack-channel').value.trim();
    const message = document.getElementById('import-slack-message').value.trim();
    // Use first line or first 100 chars as title
    const firstLine = message.split('\n')[0];
    title = firstLine.length > 100 ? firstLine.substring(0, 100) + '...' : firstLine || 'Imported Slack task';
    notes = (channel ? `Channel: ${channel}\n\n` : '') + message;
    source = 'slack';
  }

  // Auto-detect department if not manually selected
  const detectedDept = department || detectDepartment(title + ' ' + notes);
  const finalDept = detectedDept || 'B2B Marketing'; // fallback

  addTask(title, finalDept, priority, notes, source, []);
  closeModal('modal-import');
  document.getElementById('form-import').reset();
  document.querySelector('.import-tab[data-tab="email"]').click();
}

// === Event Binding ===
function init() {
  loadTasks();

  // Add Task button
  document.getElementById('btn-add-task').addEventListener('click', () => {
    resetAddForm();
    openModal('modal-add');
  });

  // Import buttons
  document.getElementById('btn-import-email').addEventListener('click', () => {
    document.querySelector('.import-tab[data-tab="email"]').click();
    document.getElementById('modal-import-title').textContent = 'Import from Email';
    openModal('modal-import');
  });

  document.getElementById('btn-import-slack').addEventListener('click', () => {
    document.querySelector('.import-tab[data-tab="slack"]').click();
    document.getElementById('modal-import-title').textContent = 'Import from Slack';
    openModal('modal-import');
  });

  // Import tabs
  document.querySelectorAll('.import-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.import-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-email').style.display = tab.dataset.tab === 'email' ? 'block' : 'none';
      document.getElementById('panel-slack').style.display = tab.dataset.tab === 'slack' ? 'block' : 'none';
    });
  });

  // Import form submit
  document.getElementById('form-import').addEventListener('submit', handleImport);

  // Add task form submit
  document.getElementById('form-add-task').addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('input-title').value.trim();
    const department = document.getElementById('input-department').value;
    const priority = document.getElementById('input-priority').value;
    const notes = document.getElementById('input-notes').value.trim();

    if (!title || !department) return;

    const allAttachments = [...pendingAttachments, ...pendingLinks];
    addTask(title, department, priority, notes, 'manual', allAttachments);
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
