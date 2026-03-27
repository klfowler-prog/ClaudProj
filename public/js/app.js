// === Constants ===
const DEPARTMENTS = ['B2B Marketing', 'Internal Comms', 'Rev Ops', 'B2C Marketing', 'Personal'];
const PRIORITIES = ['High', 'Medium', 'Low'];
const STATUSES = ['Not Started', 'In Progress', 'Awaiting Feedback', 'Delegated', 'Completed'];
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
  'B2C Marketing': 'b2c',
  'Personal': 'personal'
};

const STATUS_KEYS = {
  'Not Started': 'not-started',
  'In Progress': 'in-progress',
  'Awaiting Feedback': 'awaiting',
  'Delegated': 'delegated',
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
let filters = { department: 'all', priority: 'all', search: '', sort: 'created' };
let pendingAttachments = []; // temp attachments for the add-task form
let pendingLinks = [];       // temp links for the add-task form
let editingTaskId = null;    // null = adding, string = editing
let deleteConfirmId = null;  // track which task is awaiting delete confirm

// === Persistence (API-backed) ===
async function loadTasks() {
  try {
    const url = showMyTasksOnly ? '/api/tasks?mine=true' : '/api/tasks';
    tasks = await api('GET', url);
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
  renderSidebarCounts();
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

function renderSidebarCounts() {
  const container = document.getElementById('tasks-subnav');

  // Determine which departments to show
  let visibleDepts;
  if (myProfile && myProfile.role === 'cmo') {
    visibleDepts = DEPARTMENTS;
  } else {
    // Show user's department + any department where they have tasks
    const myDept = myProfile ? myProfile.department : 'all';
    const deptsWithTasks = new Set(tasks.map(t => t.department));
    visibleDepts = DEPARTMENTS.filter(d => d === myDept || deptsWithTasks.has(d));
  }

  let html = '<button class="sidebar-dept-item ' + (filters.department === 'all' ? 'active' : '') + '" data-dept="all">All Tasks</button>';
  for (const dept of visibleDepts) {
    const key = DEPT_KEYS[dept];
    const count = tasks.filter(t => t.department === dept && t.status !== 'Completed').length;
    const isActive = filters.department === dept;
    html += `<button class="sidebar-dept-item ${isActive ? 'active' : ''}" data-dept="${dept}">
      <span class="dept-dot dept-${key}"></span> ${dept} <span class="sidebar-count">${count}</span>
    </button>`;
  }
  container.innerHTML = html;

  // Re-attach click handlers
  container.querySelectorAll('.sidebar-dept-item').forEach(item => {
    item.addEventListener('click', () => {
      document.getElementById('filter-department').value = item.dataset.dept;
      applyFilters();
      switchView('tasks');
      closeSidebar();
    });
  });
}

// === View Switching ===
let currentView = 'tasks';

function switchView(view) {
  currentView = view;
  document.getElementById('view-tasks').style.display = view === 'tasks' ? 'block' : 'none';
  document.getElementById('view-notes').style.display = view === 'notes' ? 'flex' : 'none';
  document.getElementById('view-ai').style.display = view === 'ai' ? 'flex' : 'none';
  document.getElementById('view-team').style.display = view === 'team' ? 'block' : 'none';
  document.getElementById('view-notifications').style.display = view === 'notifications' ? 'block' : 'none';
  document.querySelectorAll('.sidebar-nav-item').forEach(el => {
    const match = el.dataset.view === view || (el.id === 'btn-open-chat' && view === 'ai') || (el.id === 'btn-notifications' && view === 'notifications');
    el.classList.toggle('active', match);
  });
}

function toggleSidebarSection(sectionId, caretId) {
  const subnav = document.getElementById(sectionId);
  const caret = document.getElementById(caretId);
  const isCollapsed = subnav.classList.contains('collapsed');
  subnav.classList.toggle('collapsed');
  caret.innerHTML = isCollapsed ? '&#9662;' : '&#9656;';
}

function openSidebar() {
  document.getElementById('app-sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.add('active');
}

function closeSidebar() {
  document.getElementById('app-sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('active');
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
  const isRecurring = task.recurring && task.recurring !== 'none';
  const recurringLabel = { daily: 'Daily', weekly: 'Weekly', biweekly: 'Biweekly', monthly: 'Monthly' }[task.recurring] || '';

  const statusOptions = STATUSES.map(s =>
    `<option value="${s}" ${s === task.status ? 'selected' : ''}>${s}</option>`
  ).join('');

  return `
    <div class="task-item ${isCompleted ? 'completed' : ''} status-${statusKey}" data-id="${task.id}">
      <button class="task-check ${isCompleted ? 'checked' : ''}" data-action="toggle-complete" data-id="${task.id}" title="${isCompleted ? 'Mark incomplete' : 'Mark complete'}">${isCompleted ? '&#10003;' : ''}</button>
      <select class="status-select status-${statusKey}" data-action="status" data-id="${task.id}" onclick="event.stopPropagation()" onmousedown="event.stopPropagation()">
        ${statusOptions}
      </select>
      <div class="task-body" data-action="detail" data-id="${task.id}">
        <div class="task-title">${escapeHtml(task.title)}</div>
        <div class="task-meta">
          <span class="badge badge-${deptKey}">${escapeHtml(task.department)}</span>
          <span class="badge badge-${prioKey}">${task.priority}</span>
          ${dueDateHtml}
          ${isRecurring ? `<span class="task-recurring" title="${recurringLabel}">&#8635; ${recurringLabel}</span>` : ''}
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
    ['Awaiting Feedback', 'Delegated', 'In Progress', 'Not Started'].forEach(s => {
      const group = sortTasks(activeTasks.filter(t => t.status === s));
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

function escapeHtmlWithLinks(str) {
  const escaped = escapeHtml(str);
  return escaped.replace(
    /(https?:\/\/[^\s<>"']+)/g,
    '<a href="$1" target="_blank" rel="noopener" class="inline-link">$1</a>'
  );
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

// === Sorting ===
function sortTasks(taskList) {
  const sort = filters.sort;
  return [...taskList].sort((a, b) => {
    if (sort === 'due-date') {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return a.dueDate.localeCompare(b.dueDate);
    }
    if (sort === 'priority') {
      const order = { 'High': 0, 'Medium': 1, 'Low': 2 };
      return (order[a.priority] || 1) - (order[b.priority] || 1);
    }
    return (b.createdAt || '').localeCompare(a.createdAt || '');
  });
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
  filters.sort = document.getElementById('filter-sort').value;
  render();
}

// === Task Operations (API-backed) ===
async function addTask(title, department, priority, notes, source, attachments, dueDate, recurring, assignedTo) {
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
    dueDate: dueDate || '',
    recurring: recurring || 'none'
  };
  if (assignedTo) {
    taskData.assignedTo = assignedTo;
    taskData.status = 'Delegated';
  }

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

function getNextDueDate(currentDueDate, frequency) {
  if (!currentDueDate) {
    // No due date — use today as the base
    const today = new Date();
    currentDueDate = today.toISOString().split('T')[0];
  }
  const date = new Date(currentDueDate + 'T00:00:00');
  switch (frequency) {
    case 'daily': date.setDate(date.getDate() + 1); break;
    case 'weekly': date.setDate(date.getDate() + 7); break;
    case 'biweekly': date.setDate(date.getDate() + 14); break;
    case 'monthly': date.setMonth(date.getMonth() + 1); break;
  }
  return date.toISOString().split('T')[0];
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

    // Auto-create next occurrence for recurring tasks
    if (newStatus === 'Completed' && task.recurring && task.recurring !== 'none') {
      const nextDue = getNextDueDate(task.dueDate, task.recurring);
      await addTask(
        task.title,
        task.department,
        task.priority,
        task.notes,
        'manual',
        task.attachments || [],
        nextDue,
        task.recurring
      );
    }
  } catch (err) {
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
  document.getElementById('input-recurring').value = task.recurring || 'none';
  document.getElementById('input-assign-to').value = task.assignedTo || '';

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
    ${task.notes ? `<div class="detail-section"><div class="detail-section-title">Notes</div><div class="detail-notes">${escapeHtmlWithLinks(task.notes)}</div></div>` : ''}
    ${attachmentsHtml}
    <div class="detail-section">
      <div class="detail-section-title">Status</div>
      <span class="badge badge-status-${STATUS_KEYS[task.status] || 'not-started'}">${task.status}</span>
      ${task.completedAt ? `<span style="font-size: 0.8rem; color: var(--color-text-light); margin-left: 0.5rem;">Completed ${new Date(task.completedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>` : ''}
      ${task.recurring && task.recurring !== 'none' ? `<span style="font-size: 0.8rem; color: var(--follett-medium-blue); margin-left: 0.5rem;">&#8635; Repeats ${{ daily: 'daily', weekly: 'weekly', biweekly: 'every 2 weeks', monthly: 'monthly' }[task.recurring]}</span>` : ''}
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

// === Notes State & Logic ===
let folders = [];
let notesList = [];
let activeNoteId = null;
let activeFolderId = null;
let showMyNotesOnly = false;
let saveTimeout = null;

async function loadFolders() {
  try {
    folders = await api('GET', '/api/folders');
    renderSidebarFolders();
  } catch (err) { console.error('Failed to load folders:', err); }
}

function renderSidebarFolders() {
  const container = document.getElementById('sidebar-folders');
  container.innerHTML = `<button class="sidebar-dept-item ${!activeFolderId ? 'active' : ''}" data-folder-id="">All Notes</button>` +
    folders.map(f =>
      `<button class="sidebar-dept-item ${activeFolderId === f.id ? 'active' : ''}" data-folder-id="${f.id}">${escapeHtml(f.name)}</button>`
    ).join('');
  container.querySelectorAll('[data-folder-id]').forEach(btn => {
    btn.addEventListener('click', async () => {
      // Save any pending note before switching
      if (saveTimeout && activeNoteId) {
        clearTimeout(saveTimeout);
        await api('PUT', `/api/notes/${activeNoteId}`, {
          title: document.getElementById('editor-title').value || 'Untitled',
          content: document.getElementById('editor-content').innerHTML
        }).catch(() => {});
      }
      activeNoteId = null;
      document.getElementById('notes-editor-panel').style.display = 'none';
      document.getElementById('notes-no-selection').style.display = 'flex';
      activeFolderId = btn.dataset.folderId || null;
      switchView('notes');
      loadNotesList(activeFolderId);
      renderSidebarFolders();
      const folder = activeFolderId ? folders.find(f => f.id === activeFolderId) : null;
      document.getElementById('notes-folder-title').textContent = folder ? folder.name : 'All Notes';
      closeSidebar();
    });
  });
}

async function loadNotesList(folderId) {
  try {
    let url = folderId ? `/api/notes?folderId=${folderId}` : '/api/notes';
    if (showMyNotesOnly) url += (url.includes('?') ? '&' : '?') + 'mine=true';
    notesList = await api('GET', url);
    renderNotesList();
  } catch (err) { notesList = []; renderNotesList(); }
}

function renderNotesList() {
  const container = document.getElementById('notes-list');
  const empty = document.getElementById('notes-empty');
  if (notesList.length === 0) { container.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  container.innerHTML = notesList.map(n => {
    const date = new Date(n.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isOwn = myProfile && n.createdBy === myProfile.userId;
    const authorLabel = isOwn ? '' : ` &middot; ${escapeHtml(n.authorName || 'Unknown')}`;
    return `<button class="note-list-item ${activeNoteId === n.id ? 'active' : ''}" data-note-id="${n.id}">
      <div class="note-list-item-title">${escapeHtml(n.title || 'Untitled')}</div>
      <div class="note-list-item-date">${date}${authorLabel}</div>
    </button>`;
  }).join('');
  container.querySelectorAll('[data-note-id]').forEach(btn => {
    btn.addEventListener('click', () => openNote(btn.dataset.noteId));
  });
}

async function openNote(noteId) {
  try {
    const note = await api('GET', `/api/notes/${noteId}`);
    activeNoteId = noteId;
    document.getElementById('editor-title').value = note.title || '';
    document.getElementById('editor-content').innerHTML = note.content || '';
    document.getElementById('notes-editor-panel').style.display = 'flex';
    document.getElementById('notes-no-selection').style.display = 'none';
    document.getElementById('editor-saved').textContent = '';
    renderNotesList();
  } catch (err) { alert('Failed to open note: ' + err.message); }
}

async function createNote() {
  if (!activeFolderId && folders.length > 0) activeFolderId = folders[0].id;
  try {
    const note = await api('POST', '/api/notes', { title: 'Untitled', content: '', folderId: activeFolderId || '' });
    notesList.unshift(note);
    renderNotesList();
    openNote(note.id);
  } catch (err) { alert('Failed to create note: ' + err.message); }
}

function scheduleAutoSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  document.getElementById('editor-saved').textContent = 'Saving...';
  saveTimeout = setTimeout(async () => {
    if (!activeNoteId) return;
    try {
      await api('PUT', `/api/notes/${activeNoteId}`, {
        title: document.getElementById('editor-title').value || 'Untitled',
        content: document.getElementById('editor-content').innerHTML
      });
      document.getElementById('editor-saved').textContent = 'Saved';
      const item = notesList.find(n => n.id === activeNoteId);
      if (item) { item.title = document.getElementById('editor-title').value || 'Untitled'; item.updatedAt = new Date().toISOString(); renderNotesList(); }
    } catch { document.getElementById('editor-saved').textContent = 'Save failed'; }
  }, 500);
}

async function deleteNote() {
  if (!activeNoteId || !confirm('Delete this note?')) return;
  try {
    await api('DELETE', `/api/notes/${activeNoteId}`);
    notesList = notesList.filter(n => n.id !== activeNoteId);
    activeNoteId = null;
    document.getElementById('notes-editor-panel').style.display = 'none';
    document.getElementById('notes-no-selection').style.display = 'flex';
    renderNotesList();
  } catch (err) { alert('Failed to delete note: ' + err.message); }
}

async function createFolder() {
  const name = prompt('Folder name:');
  if (!name) return;
  try {
    const folder = await api('POST', '/api/folders', { name, order: folders.length });
    folders.push(folder);
    renderSidebarFolders();
  } catch (err) { alert('Failed to create folder: ' + err.message); }
}

// === Note Sharing ===
let currentNoteSharedWith = [];

async function openShareModal() {
  if (!activeNoteId) return;

  // Get current note's sharedWith
  const note = await api('GET', `/api/notes/${activeNoteId}`);
  currentNoteSharedWith = note.sharedWith || [];

  // Build people checkboxes
  const peopleContainer = document.getElementById('share-people-list');
  if (teamMembers.length === 0 && myProfile && myProfile.role === 'cmo') {
    await loadTeam();
  }
  const otherMembers = teamMembers.filter(m => m.userId !== (myProfile && myProfile.userId) && m.status === 'active');
  peopleContainer.innerHTML = otherMembers.map(m => `
    <label style="display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; font-size: 0.85rem; text-transform: none; font-weight: 400; color: var(--color-text);">
      <input type="checkbox" class="share-person-cb" value="${m.userId}" ${currentNoteSharedWith.includes(m.userId) ? 'checked' : ''}>
      ${escapeHtml(m.displayName)} <span style="color: var(--color-text-muted); font-size: 0.75rem;">(${m.department})</span>
    </label>
  `).join('') || '<p style="font-size: 0.8rem; color: var(--color-text-muted);">No team members yet</p>';

  // Build department checkboxes
  const deptContainer = document.getElementById('share-dept-list');
  deptContainer.innerHTML = DEPARTMENTS.map(d => `
    <label style="display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0; font-size: 0.85rem; text-transform: none; font-weight: 400; color: var(--color-text);">
      <input type="checkbox" class="share-dept-cb" value="dept:${d}" ${currentNoteSharedWith.includes('dept:' + d) ? 'checked' : ''}>
      ${d}
    </label>
  `).join('');

  // All team checkbox
  document.getElementById('share-all-team').checked = currentNoteSharedWith.includes('all');

  openModal('modal-share-note');
}

async function saveSharing() {
  const sharedWith = [];

  // Collect checked people
  document.querySelectorAll('.share-person-cb:checked').forEach(cb => sharedWith.push(cb.value));

  // Collect checked departments
  document.querySelectorAll('.share-dept-cb:checked').forEach(cb => sharedWith.push(cb.value));

  // All team
  if (document.getElementById('share-all-team').checked) sharedWith.push('all');

  try {
    await api('PUT', `/api/notes/${activeNoteId}`, { sharedWith });
    closeModal('modal-share-note');
    const count = sharedWith.length;
    alert(count > 0 ? `Note shared with ${count} ${count === 1 ? 'recipient' : 'recipients'}.` : 'Note is now private.');
  } catch (err) {
    alert('Failed to save sharing: ' + err.message);
  }
}


// === AI Features ===
function showAiPanel(title, content) {
  document.getElementById('ai-panel-title').textContent = title;
  document.getElementById('ai-panel-content').innerHTML = content;
  document.getElementById('ai-panel').style.display = 'block';
}

function hideAiPanel() {
  document.getElementById('ai-panel').style.display = 'none';
}

async function aiSummarize() {
  if (!activeNoteId) return;
  showAiPanel('Summary', '<span class="ai-loading">Generating summary...</span>');
  try {
    const result = await api('POST', `/api/notes/${activeNoteId}/summarize`);
    showAiPanel('Summary', escapeHtmlWithLinks(result.summary));
  } catch (err) {
    showAiPanel('Error', err.message);
  }
}

async function aiAsk() {
  if (!activeNoteId) return;
  const question = prompt('What would you like to know about this note?');
  if (!question) return;
  showAiPanel('Answer', '<span class="ai-loading">Thinking...</span>');
  try {
    const result = await api('POST', `/api/notes/${activeNoteId}/ask`, { question });
    showAiPanel('Answer', escapeHtmlWithLinks(result.answer));
  } catch (err) {
    showAiPanel('Error', err.message);
  }
}

let pendingAiTasks = [];

async function aiGenerateTasks() {
  if (!activeNoteId) return;
  showAiPanel('Generate Tasks', '<span class="ai-loading">Extracting tasks...</span>');
  try {
    const result = await api('POST', `/api/notes/${activeNoteId}/generate-tasks`);
    hideAiPanel();
    pendingAiTasks = result.tasks || [];
    if (pendingAiTasks.length === 0) {
      alert('No actionable tasks found in this note.');
      return;
    }
    // Show confirmation modal
    const list = document.getElementById('ai-tasks-list');
    list.innerHTML = pendingAiTasks.map((t, i) => `
      <div class="ai-task-item">
        <input type="checkbox" checked data-ai-task-idx="${i}">
        <div>
          <div class="ai-task-item-title">${escapeHtml(t.title)}</div>
          <div class="ai-task-item-meta">${escapeHtml(t.department)} &middot; ${t.priority} priority</div>
          ${t.notes ? `<div class="ai-task-item-meta">${escapeHtml(t.notes)}</div>` : ''}
        </div>
      </div>
    `).join('');
    openModal('modal-ai-tasks');
  } catch (err) {
    showAiPanel('Error', err.message);
  }
}

async function createAiTasks() {
  const checkboxes = document.querySelectorAll('#ai-tasks-list input[type="checkbox"]');
  const selected = [];
  checkboxes.forEach(cb => {
    if (cb.checked) {
      const idx = parseInt(cb.dataset.aiTaskIdx);
      selected.push(pendingAiTasks[idx]);
    }
  });
  if (selected.length === 0) { alert('No tasks selected.'); return; }

  try {
    const tasksToCreate = selected.map(t => ({
      title: t.title,
      department: t.department || 'Personal',
      priority: t.priority || 'Medium',
      notes: t.notes || '',
      status: 'Not Started',
      source: 'manual',
      dueDate: '',
      recurring: 'none'
    }));
    await api('POST', '/api/tasks/batch', { tasks: tasksToCreate });
    closeModal('modal-ai-tasks');
    await loadTasks();
    render();
    alert(`Created ${selected.length} task${selected.length !== 1 ? 's' : ''}!`);
  } catch (err) {
    alert('Failed to create tasks: ' + err.message);
  }
}

// === Global AI Chat (full-screen view) ===
let chatHistory = [];
let chatStarted = false;

function openAiView() {
  switchView('ai');
  setTimeout(() => document.getElementById('chat-input').focus(), 100);
}

function addChatMessage(role, text) {
  // Hide welcome screen on first message
  if (!chatStarted) {
    chatStarted = true;
    document.getElementById('ai-welcome').style.display = 'none';
    document.getElementById('ai-messages').style.display = 'flex';
  }

  const container = document.getElementById('ai-messages');
  const div = document.createElement('div');
  div.className = `ai-msg ${role === 'user' ? 'ai-msg-user' : 'ai-msg-ai'}`;
  div.innerHTML = role === 'user' ? escapeHtml(text) : escapeHtmlWithLinks(text);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

async function sendChatMessage(messageOverride) {
  const input = document.getElementById('chat-input');
  const message = messageOverride || input.value.trim();
  if (!message) return;

  input.value = '';
  addChatMessage('user', message);
  const loadingDiv = addChatMessage('ai', 'Thinking...');
  loadingDiv.classList.add('loading');

  chatHistory.push({ role: 'user', text: message });

  try {
    const result = await api('POST', '/api/ai/chat', {
      message,
      history: chatHistory.slice(-10)
    });
    loadingDiv.classList.remove('loading');
    loadingDiv.innerHTML = escapeHtmlWithLinks(result.reply);
    chatHistory.push({ role: 'model', text: result.reply });
  } catch (err) {
    loadingDiv.classList.remove('loading');
    loadingDiv.textContent = 'Error: ' + err.message;
  }
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
    const recurring = document.getElementById('input-recurring').value;
    const assignTo = document.getElementById('input-assign-to').value || undefined;

    if (!title || !department) return;

    const allAttachments = [...pendingAttachments, ...pendingLinks];

    if (editingTaskId) {
      const updates = { title, department, priority, notes, dueDate, recurring, attachments: allAttachments };
      if (assignTo) {
        updates.assignedTo = assignTo;
        updates.status = 'Delegated';
      }
      try {
        await api('PUT', `/api/tasks/${editingTaskId}`, updates);
        const task = tasks.find(t => t.id === editingTaskId);
        if (task) Object.assign(task, updates);
        render();
      } catch (err) {
        alert('Failed to update task: ' + err.message);
      }
    } else {
      await addTask(title, department, priority, notes, 'manual', allAttachments, dueDate, recurring, assignTo);
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
  document.getElementById('filter-sort').addEventListener('change', applyFilters);
  document.getElementById('filter-search').addEventListener('input', applyFilters);

  // Sidebar navigation
  document.querySelectorAll('.sidebar-nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const view = item.dataset.view;
      switchView(view);
      // Toggle subnav
      if (view === 'tasks') toggleSidebarSection('tasks-subnav', 'tasks-caret');
      if (view === 'notes') {
        toggleSidebarSection('notes-subnav', 'notes-caret');
        // Show all notes when clicking the header
        activeFolderId = null;
        loadNotesList(null);
        renderSidebarFolders();
        document.getElementById('notes-folder-title').textContent = 'All Notes';
      }
      closeSidebar();
    });
  });

  // Sidebar department clicks (filter tasks)
  document.querySelectorAll('.sidebar-dept-item').forEach(item => {
    item.addEventListener('click', () => {
      const dept = item.dataset.dept;
      document.getElementById('filter-department').value = dept;
      applyFilters();
      switchView('tasks');
      closeSidebar();
    });
  });

  // Sidebar toggle (mobile)
  document.getElementById('sidebar-toggle').addEventListener('click', openSidebar);
  document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
  document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

  // Notes event listeners
  document.getElementById('btn-new-note').addEventListener('click', createNote);

  // My Notes / All Notes toggle
  document.getElementById('btn-my-notes').addEventListener('click', () => {
    showMyNotesOnly = true;
    document.getElementById('btn-my-notes').classList.add('active');
    document.getElementById('btn-all-notes').classList.remove('active');
    loadNotesList(activeFolderId);
  });
  document.getElementById('btn-all-notes').addEventListener('click', () => {
    showMyNotesOnly = false;
    document.getElementById('btn-all-notes').classList.add('active');
    document.getElementById('btn-my-notes').classList.remove('active');
    loadNotesList(activeFolderId);
  });
  document.getElementById('btn-delete-note').addEventListener('click', deleteNote);
  document.getElementById('btn-share-note').addEventListener('click', openShareModal);
  document.getElementById('btn-save-share').addEventListener('click', saveSharing);
  document.getElementById('btn-add-folder').addEventListener('click', createFolder);
  document.getElementById('editor-title').addEventListener('input', scheduleAutoSave);
  document.getElementById('editor-content').addEventListener('input', scheduleAutoSave);

  // AI buttons
  // AI Chat (full-screen view)
  // Notifications
  document.getElementById('btn-notifications').addEventListener('click', () => { showNotifications(); closeSidebar(); });

  // Team (CMO only)
  document.getElementById('btn-invite-member') && document.getElementById('btn-invite-member').addEventListener('click', inviteMember);
  document.getElementById('form-invite') && document.getElementById('form-invite').addEventListener('submit', submitInvite);
  document.querySelectorAll('[data-view="team"]').forEach(btn => {
    btn.addEventListener('click', () => { showTeamView(); closeSidebar(); });
  });

  // My Tasks / All Tasks toggle
  document.getElementById('btn-my-tasks').addEventListener('click', () => {
    showMyTasksOnly = true;
    document.getElementById('btn-my-tasks').classList.add('active');
    document.getElementById('btn-all-tasks').classList.remove('active');
    loadTasks().then(render);
  });
  document.getElementById('btn-all-tasks').addEventListener('click', () => {
    showMyTasksOnly = false;
    document.getElementById('btn-all-tasks').classList.add('active');
    document.getElementById('btn-my-tasks').classList.remove('active');
    loadTasks().then(render);
  });

  // AI Chat
  document.getElementById('btn-open-chat').addEventListener('click', () => { openAiView(); closeSidebar(); });
  document.getElementById('btn-send-chat').addEventListener('click', () => sendChatMessage());
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });
  // Suggestion button clicks
  document.querySelectorAll('.ai-suggestion').forEach(btn => {
    btn.addEventListener('click', () => sendChatMessage(btn.dataset.q));
  });

  document.getElementById('btn-ai-summarize').addEventListener('click', aiSummarize);
  document.getElementById('btn-ai-ask').addEventListener('click', aiAsk);
  document.getElementById('btn-ai-tasks').addEventListener('click', aiGenerateTasks);
  document.getElementById('ai-panel-close').addEventListener('click', hideAiPanel);
  document.getElementById('btn-create-ai-tasks').addEventListener('click', createAiTasks);

  // Editor toolbar (execCommand for rich text)
  document.querySelectorAll('.editor-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const cmd = btn.dataset.cmd;
      const val = btn.dataset.value || null;
      document.getElementById('editor-content').focus();
      document.execCommand(cmd, false, val);
      scheduleAutoSave();
    });
  });

  // Load folders for sidebar
  await loadFolders();

  // Load team members for Assign To dropdown (all users need this)
  await loadTeam();

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
      case 'toggle-complete':
        const task = tasks.find(t => t.id === id);
        if (task) {
          setTaskStatus(id, task.status === 'Completed' ? 'Not Started' : 'Completed');
        }
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

// === Team, Notifications, My Tasks ===
let myProfile = null;
let showMyTasksOnly = false;
let teamMembers = [];

async function loadProfile() {
  try {
    myProfile = await api('GET', '/api/me');
    // Show Team section for CMO only
    if (myProfile.role === 'cmo') {
      document.getElementById('sidebar-team-section').style.display = 'block';
    }
  } catch (err) { console.error('Failed to load profile:', err); }
}

async function loadNotifications() {
  try {
    const notifs = await api('GET', '/api/notifications');
    const badge = document.getElementById('notif-badge');
    if (notifs.length > 0) {
      badge.textContent = notifs.length;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
    return notifs;
  } catch { return []; }
}

async function showNotifications() {
  switchView('notifications');
  const notifs = await loadNotifications();
  const container = document.getElementById('notifications-list');
  const empty = document.getElementById('notifications-empty');
  if (notifs.length === 0) { container.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  container.innerHTML = notifs.map(n => {
    const ago = timeAgo(n.createdAt);
    return `<div class="notif-item" data-notif-id="${n.id}" data-task-id="${n.taskId || ''}">
      <div class="notif-item-title">${escapeHtml(n.title)}</div>
      <div class="notif-item-time">${ago}</div>
    </div>`;
  }).join('');
  container.querySelectorAll('.notif-item').forEach(item => {
    item.addEventListener('click', async () => {
      await api('POST', `/api/notifications/${item.dataset.notifId}/read`).catch(() => {});
      loadNotifications();
      if (item.dataset.taskId) { switchView('tasks'); }
    });
  });
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function loadTeam() {
  try { teamMembers = await api('GET', '/api/team'); } catch { teamMembers = []; }
  populateAssignToDropdown();
}

function populateAssignToDropdown() {
  const select = document.getElementById('input-assign-to');
  if (!select) return;
  select.innerHTML = '<option value="">Me (default)</option>' +
    teamMembers.filter(m => m.status === 'active').map(m =>
      `<option value="${m.userId}">${escapeHtml(m.displayName)} (${m.department})</option>`
    ).join('');
}

async function showTeamView() {
  switchView('team');
  await loadTeam();
  const container = document.getElementById('team-roster');
  container.innerHTML = teamMembers.map(m => `
    <div class="team-member-card">
      <div class="team-member-info">
        <div class="team-member-name">${escapeHtml(m.displayName)}</div>
        <div class="team-member-meta">${escapeHtml(m.email)} &middot; ${m.role} &middot; ${m.department} &middot; ${m.status}</div>
      </div>
      <div class="team-member-actions">
        ${m.role !== 'cmo' ? `<button class="btn btn-ghost btn-sm" style="color: var(--follett-coral);" onclick="deleteMember('${m.id}', '${escapeHtml(m.displayName)}')">Remove</button>` : ''}
      </div>
    </div>
  `).join('');
}

function inviteMember() {
  document.getElementById('form-invite').reset();
  document.getElementById('invite-result').style.display = 'none';
  document.getElementById('form-invite').style.display = 'block';
  openModal('modal-invite');
}

async function submitInvite(e) {
  e.preventDefault();
  const name = document.getElementById('invite-name').value.trim();
  const email = document.getElementById('invite-email').value.trim();
  const department = document.getElementById('invite-department').value;
  const role = document.getElementById('invite-role').value;

  if (!name || !email || !department) return;

  try {
    const result = await api('POST', '/api/team/invite', { email, displayName: name, department, role });
    // Show success with the reset link
    document.getElementById('form-invite').style.display = 'none';
    document.getElementById('invite-result').style.display = 'block';
    document.getElementById('invite-result-text').textContent = `Send this link to ${name} so they can set their password and log in:`;

    document.getElementById('btn-copy-invite-link').onclick = () => {
      navigator.clipboard.writeText(result.resetLink).then(() => {
        document.getElementById('btn-copy-invite-link').textContent = 'Copied!';
        setTimeout(() => { document.getElementById('btn-copy-invite-link').textContent = 'Copy Link'; }, 2000);
      });
    };

    showTeamView();
  } catch (err) { alert('Failed to add member: ' + err.message); }
}

async function disableMember(id) {
  if (!confirm('Disable this team member? They will lose access immediately.')) return;
  try { await api('POST', `/api/team/${id}/disable`); showTeamView(); } catch (err) { alert(err.message); }
}

async function enableMember(id) {
  try { await api('POST', `/api/team/${id}/enable`); showTeamView(); } catch (err) { alert(err.message); }
}

async function deleteMember(id, name) {
  if (!confirm(`Remove ${name} from the team? This deletes their account entirely so you can re-invite them if needed.`)) return;
  try { await api('DELETE', `/api/team/${id}`); showTeamView(); } catch (err) { alert(err.message); }
}

// === Firebase Auth & Boot ===
document.addEventListener('DOMContentLoaded', () => {
  const loginScreen = document.getElementById('login-screen');
  const appContainer = document.getElementById('app-container');

  // Google sign-in
  document.getElementById('btn-google-login').addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    firebase.auth().signInWithPopup(provider).catch(err => {
      document.getElementById('login-error').textContent = err.message;
    });
  });

  // Email/password sign-in
  document.getElementById('btn-email-login').addEventListener('click', () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) { document.getElementById('login-error').textContent = 'Enter email and password'; return; }
    firebase.auth().signInWithEmailAndPassword(email, password).catch(err => {
      document.getElementById('login-error').textContent = err.message;
    });
  });

  // Enter key on password field
  document.getElementById('login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btn-email-login').click();
  });

  // Forgot password
  document.getElementById('btn-forgot-password').addEventListener('click', (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    if (!email) { document.getElementById('login-error').textContent = 'Enter your email first'; return; }
    firebase.auth().sendPasswordResetEmail(email).then(() => {
      document.getElementById('login-error').textContent = '';
      alert('Password reset email sent to ' + email);
    }).catch(err => { document.getElementById('login-error').textContent = err.message; });
  });

  // Sign out
  document.getElementById('btn-sign-out').addEventListener('click', () => firebase.auth().signOut());

  firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
      currentUser = user;
      authToken = await user.getIdToken();
      document.getElementById('user-email').textContent = user.email;
      loginScreen.style.display = 'none';
      appContainer.style.display = 'flex';
      await loadProfile();
      await init();
      loadNotifications();
      // Poll notifications every 60 seconds
      setInterval(loadNotifications, 60000);
    } else {
      currentUser = null;
      authToken = null;
      myProfile = null;
      tasks = [];
      loginScreen.style.display = 'flex';
      appContainer.style.display = 'none';
    }
  });

  setInterval(async () => {
    if (currentUser) authToken = await currentUser.getIdToken(true);
  }, 50 * 60 * 1000);
});
