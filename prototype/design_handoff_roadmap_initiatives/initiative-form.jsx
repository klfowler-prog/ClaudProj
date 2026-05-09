/* global React */
const { useState } = React;

const IF_DEPTS = ['All Marketing', 'B2B Marketing', 'B2C Marketing', 'Personal', 'Rev Ops'];
const IF_HEALTH = [
  { value:'on-track', label:'On Track' },
  { value:'at-risk',  label:'At Risk'  },
  { value:'off-track',label:'Off Track'},
];
const IF_MILESTONE_KINDS = [
  { value:'launch',   label:'Launch'   },
  { value:'event',    label:'Event'    },
  { value:'decision', label:'Decision' },
  { value:'team',     label:'Team'     },
];

function blankInitiative(today) {
  return {
    id: 'init-new-' + Date.now(),
    name: '',
    thesis: '',
    department: 'B2B Marketing',
    owner: 'GA',
    collaborators: [],
    priority: 'Medium',
    status: 'On Track',
    health: 'on-track',
    start: today,
    end: today,
    progress: 0,
    milestones: [],
    tasks: [],
  };
}

function InitiativeForm({ initiative, people, today, onClose, onSave, onDelete }) {
  const [form, setForm] = useState(() => initiative ? structuredClone(initiative) : blankInitiative(today));
  const isNew = !initiative;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const toggleCollab = (id) => {
    setForm(f => ({
      ...f,
      collaborators: f.collaborators.includes(id)
        ? f.collaborators.filter(x => x !== id)
        : [...f.collaborators, id],
    }));
  };

  const addMilestone = () => set('milestones', [...form.milestones, { date: form.start || today, label:'', kind:'event' }]);
  const editMilestone = (i, k, v) => set('milestones', form.milestones.map((m, idx) => idx === i ? { ...m, [k]: v } : m));
  const removeMilestone = (i) => set('milestones', form.milestones.filter((_, idx) => idx !== i));

  return (
    <div className="rm-modal-overlay" onClick={onClose}>
      <div className="rm-modal rm-modal--form rm-modal--wide" onClick={e=>e.stopPropagation()}>
        <div className="rm-modal__header">
          <div>
            <div className="rm-modal__bread">{isNew ? 'New initiative' : 'Edit initiative'}</div>
            <h2>{form.name || 'Untitled initiative'}</h2>
          </div>
          <button className="rm-modal__close" onClick={onClose}>×</button>
        </div>
        <div className="rm-modal__body">
          <div className="tv-form">
            <label className="tv-field tv-field--full">
              <span className="tv-field__label">Name</span>
              <input value={form.name} onChange={e=>set('name', e.target.value)}
                placeholder="e.g. Shopify Rollout — 50 Stores" autoFocus/>
            </label>

            <label className="tv-field tv-field--full">
              <span className="tv-field__label">
                Why this matters
                <span className="tv-field__hint">One sentence — the strategic thesis. Will show on hover and in detail views.</span>
              </span>
              <textarea rows="3" value={form.thesis} onChange={e=>set('thesis', e.target.value)}
                placeholder="What's the bet, and why is it worth doing now?"/>
            </label>

            <label className="tv-field">
              <span className="tv-field__label">Department</span>
              <select value={form.department} onChange={e=>set('department', e.target.value)}>
                {IF_DEPTS.map(d => <option key={d}>{d}</option>)}
              </select>
            </label>

            <label className="tv-field">
              <span className="tv-field__label">Priority</span>
              <select value={form.priority} onChange={e=>set('priority', e.target.value)}>
                <option>High</option><option>Medium</option><option>Low</option>
              </select>
            </label>

            <label className="tv-field">
              <span className="tv-field__label">Health</span>
              <div className="tv-segmented tv-segmented--inline">
                {IF_HEALTH.map(h => (
                  <button key={h.value} type="button" className={form.health===h.value?'is-active':''}
                    onClick={()=>set('health', h.value)}>{h.label}</button>
                ))}
              </div>
            </label>

            <label className="tv-field">
              <span className="tv-field__label">Owner</span>
              <select value={form.owner} onChange={e=>set('owner', e.target.value)}>
                {Object.entries(people).map(([id,p]) => <option key={id} value={id}>{p.name}</option>)}
              </select>
            </label>

            <label className="tv-field">
              <span className="tv-field__label">Start date</span>
              <input type="date" value={form.start} onChange={e=>set('start', e.target.value)}/>
            </label>
            <label className="tv-field">
              <span className="tv-field__label">End date</span>
              <input type="date" value={form.end} onChange={e=>set('end', e.target.value)}/>
            </label>

            <div className="tv-field tv-field--full">
              <span className="tv-field__label">
                Collaborators
                <span className="tv-field__hint">Click to add to this initiative.</span>
              </span>
              <div className="if-collab-grid">
                {Object.entries(people).filter(([id]) => id !== form.owner).map(([id, p]) => {
                  const active = form.collaborators.includes(id);
                  return (
                    <button key={id} type="button"
                      className={`if-collab ${active?'is-active':''}`}
                      onClick={()=>toggleCollab(id)}>
                      <window.RMAvatar id={id} people={people} size={20}/>
                      <span>{p.name}</span>
                      {active && <span className="if-collab__check">✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="tv-field tv-field--full">
              <div className="if-section-head">
                <span className="tv-field__label" style={{ marginBottom:0 }}>Milestones</span>
                <button type="button" className="if-add" onClick={addMilestone}>＋ Add milestone</button>
              </div>
              {form.milestones.length === 0 && (
                <div className="if-empty">No milestones yet — these are the externally-visible moments (a launch, a press date, a board decision).</div>
              )}
              <div className="if-milestones">
                {form.milestones.map((m, i) => (
                  <div key={i} className="if-milestone">
                    <input type="date" value={m.date} onChange={e=>editMilestone(i,'date',e.target.value)}/>
                    <input className="if-milestone__lbl" value={m.label} onChange={e=>editMilestone(i,'label',e.target.value)} placeholder="What happens?"/>
                    <select value={m.kind} onChange={e=>editMilestone(i,'kind',e.target.value)}>
                      {IF_MILESTONE_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                    </select>
                    <button type="button" className="if-remove" onClick={()=>removeMilestone(i)} aria-label="Remove">×</button>
                  </div>
                ))}
              </div>
            </div>

            {!isNew && (
              <div className="tv-field tv-field--full">
                <span className="tv-field__label">Linked tasks</span>
                <div className="if-tasks">
                  {form.tasks.length === 0 && <div className="if-empty">No tasks linked yet. Add tasks from the Tasks tab and pick this initiative.</div>}
                  {form.tasks.map(t => (
                    <div key={t.id} className="if-task">
                      <span className={`task-status-dot status-${({'Backlog':'backlog','Not Started':'not-started','In Progress':'in-progress','Blocked':'blocked','Approved':'approved','Delegated':'delegated','Completed':'completed'})[t.status]}`}></span>
                      <span className="if-task__title">{t.title}</span>
                      <span className="if-task__meta">{t.priority} · {t.due}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rm-modal__actions">
            {!isNew && onDelete && (
              <button className="btn btn-ghost btn-danger" onClick={()=>onDelete(form)}>Archive initiative</button>
            )}
            <div style={{ flex: 1 }}></div>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={()=>onSave(form)} disabled={!form.name.trim() || !form.thesis.trim()}>
              {isNew ? 'Create initiative' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.InitiativeForm = InitiativeForm;
