import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Card, Btn, Modal, Field, Spinner, Empty, Badge, Icon, useToast } from '../ui.jsx';
import { useCourses } from '../Shell.jsx';

const COLORS = ['#16a34a', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#64748b'];

export function CourseForm({ open, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ code: '', title: '', term: '', color: COLORS[0], term_end: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ code: '', title: '', term: '', color: COLORS[0], term_end: '' }); }, [open]);
  const save = async () => {
    setBusy(true);
    try {
      const c = await api.post('/api/courses', { ...f, term_end: f.term_end || null });
      toast('Course created');
      onSaved(c);
      onClose();
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };
  return (
    <Modal open={open} onClose={onClose} title="Create Course"
      footer={<>
        <Btn kind="outline" onClick={onClose}>Cancel</Btn>
        <Btn kind="primary" onClick={save} disabled={busy || !f.code || !f.title || !f.term}>{busy ? 'Creating…' : 'Create Course'}</Btn>
      </>}>
      <div className="form-grid">
        <Field label="Course code" hint="e.g. BIO 201">
          <input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="BIO 201" />
        </Field>
        <Field label="Term" hint="e.g. Fall 2026">
          <input className="input" value={f.term} onChange={(e) => setF({ ...f, term: e.target.value })} placeholder="Fall 2026" />
        </Field>
        <Field label="Course title" hint="e.g. Human Physiology">
          <input className="input full" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Human Physiology" />
        </Field>
        <Field label="Term ends (optional)" hint="Drives the 'ending soon' indicator">
          <input className="input" type="date" value={f.term_end} onChange={(e) => setF({ ...f, term_end: e.target.value })} />
        </Field>
        <Field label="Color">
          <div style={{ display: 'flex', gap: 7 }}>
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => setF({ ...f, color: c })}
                style={{ width: 26, height: 26, borderRadius: 8, background: c, border: f.color === c ? '3px solid #0f172a' : '2px solid #fff', cursor: 'pointer', boxShadow: '0 0 0 1px var(--line)' }} />
            ))}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

export default function Courses() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { courses, refresh } = useCourses();
  const [showNew, setShowNew] = useState(params.get('new') === '1');

  useEffect(() => { if (params.get('new') === '1') { setShowNew(true); params.delete('new'); setParams(params, { replace: true }); } }, []);

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Courses</h1>
          <div className="page-sub">Courses group rosters, exams and results roll-ups.</div>
        </div>
        <div className="page-actions"><Btn kind="primary" icon="plus" onClick={() => setShowNew(true)}>Create Course</Btn></div>
      </div>

      {courses.length === 0 ? (
        <Card><Empty icon="book" title="No courses yet" hint="Create your first course to enroll a roster and schedule exams."
          action={<Btn kind="primary" icon="plus" onClick={() => setShowNew(true)}>Create Course</Btn>} /></Card>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {courses.map((c) => (
            <Card key={c.id} className="course-card" pad={false}>
              <div className="course-card" style={{ cursor: 'pointer' }} onClick={() => navigate(`/courses/${c.id}`)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div className="cc-code" style={{ color: c.color }}>{c.code}</div>
                    <div className="cc-name" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>{c.title}</div>
                    <div className="cc-name">{c.term}</div>
                  </div>
                  {c.role !== 'owner' && <Badge kind="violet">{c.role === 'admin' ? 'admin' : c.role}</Badge>}
                </div>
                <div className="cc-foot" style={{ marginTop: 'auto' }}>
                  <span><b>{c.exams_count}</b> Exams</span>
                  <span><b>{c.students_count}</b> Students</span>
                  {c.avg_score != null && <span><b>{c.avg_score}%</b> Avg</span>}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <CourseForm open={showNew} onClose={() => setShowNew(false)} onSaved={(c) => { refresh(); navigate(`/courses/${c.id}`); }} />
    </div>
  );
}
