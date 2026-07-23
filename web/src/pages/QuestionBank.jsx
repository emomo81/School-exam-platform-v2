import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Card, Btn, Modal, Field, Spinner, Empty, Badge, Icon, useToast } from '../ui.jsx';
import { useCourses } from '../Shell.jsx';
import { QuestionForm } from './ExamDetail.jsx';

export default function QuestionBank() {
  const { courses } = useCourses();
  const toast = useToast();
  const [courseId, setCourseId] = useState(null);
  const [banks, setBanks] = useState([]);
  const [sel, setSel] = useState(null);
  const [qs, setQs] = useState(null);
  const [showBank, setShowBank] = useState(false);
  const [bankName, setBankName] = useState('');
  const [showQ, setShowQ] = useState(false);
  const [editQ, setEditQ] = useState(null);

  useEffect(() => { if (courses.length && !courseId) setCourseId(courses[0].id); }, [courses]);
  const loadBanks = () => courseId && api.get(`/api/courses/${courseId}/banks`).then((b) => {
    setBanks(b);
    if (!sel && b.length) setSel(b[0].id);
  });
  useEffect(() => { setSel(null); loadBanks(); }, [courseId]);
  const loadQs = () => sel && api.get(`/api/banks/${sel}/questions`).then(setQs);
  useEffect(() => { setQs(null); loadQs(); }, [sel]);

  const addBank = async () => {
    try { const b = await api.post(`/api/courses/${courseId}/banks`, { name: bankName }); setShowBank(false); setBankName(''); setSel(b.id); loadBanks(); }
    catch (e) { toast(e.message, 'err'); }
  };
  const delBank = async () => {
    if (!confirm('Delete this bank and all its questions?')) return;
    await api.del(`/api/banks/${sel}`); setSel(null); loadBanks();
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <h1 className="page-title">Question Bank</h1>
          <div className="page-sub">Reusable pools — bank-mode exams draw N random questions per student.</div>
        </div>
        <div className="page-actions">
          <select className="select" style={{ width: 240 }} value={courseId || ''} onChange={(e) => setCourseId(Number(e.target.value))}>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title}</option>)}
          </select>
          <Btn kind="outline" icon="plus" onClick={() => setShowBank(true)}>New bank</Btn>
          {sel && <Btn kind="primary" icon="plus" onClick={() => { setEditQ(null); setShowQ(true); }}>Add question</Btn>}
        </div>
      </div>

      <div className="g-260">
        <Card title="Banks" pad={false}>
          <div style={{ padding: '10px 12px' }}>
            {banks.length === 0 && <Empty icon="bank" title="No banks" hint="Create one to start." />}
            {banks.map((b) => (
              <button key={b.id} className={`side-item ${sel === b.id ? 'active' : ''}`} style={{ width: '100%' }} onClick={() => setSel(b.id)}>
                <Icon name="bank" size={15} /><span>{b.name}</span>
                <span className="side-badge b-muted" style={{ background: '#f1f5f9', color: '#64748b' }}>{b.questions}</span>
              </button>
            ))}
          </div>
        </Card>

        <Card
          title={sel ? `${banks.find((b) => b.id === sel)?.name} — questions` : 'Questions'}
          action={sel && <button className="icon-btn" title="Delete bank" onClick={delBank}><Icon name="trash" size={14} /></button>}>
          {!sel ? <Empty icon="bank" title="Select or create a bank" /> : !qs ? <Spinner /> : qs.length === 0 ? (
            <Empty icon="bank" title="Bank is empty" action={<Btn kind="primary" icon="plus" onClick={() => { setEditQ(null); setShowQ(true); }}>Add question</Btn>} />
          ) : qs.map((x, i) => (
            <div key={x.id} style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, marginBottom: 9 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <b style={{ color: 'var(--muted)', fontSize: 12 }}>#{i + 1}</b>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{x.text}</div>
                  {x.type === 'mcq' && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
                      {x.options.map((o, oi) => (
                        <span key={oi} className="pill" style={{ background: oi === x.correct_index ? 'var(--green-l)' : '#f1f5f9', color: oi === x.correct_index ? '#15803d' : 'var(--body)' }}>{o}</span>
                      ))}
                    </div>
                  )}
                </div>
                <Badge kind={x.type === 'mcq' ? 'info' : 'violet'}>{x.type}</Badge>
                <Badge kind="muted">{x.points} pts</Badge>
                <span style={{ display: 'flex', gap: 2 }}>
                  <button className="icon-btn" onClick={() => { setEditQ(x); setShowQ(true); }}><Icon name="edit" size={14} /></button>
                  <button className="icon-btn" onClick={async () => { await api.del(`/api/questions/${x.id}`); loadQs(); }}><Icon name="trash" size={14} /></button>
                </span>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <Modal open={showBank} onClose={() => setShowBank(false)} title="New question bank"
        footer={<><Btn kind="outline" onClick={() => setShowBank(false)}>Cancel</Btn><Btn kind="primary" onClick={addBank} disabled={!bankName.trim()}>Create</Btn></>}>
        <Field label="Bank name"><input className="input" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Physiology Master Bank" /></Field>
      </Modal>
      <QuestionForm open={showQ} onClose={() => setShowQ(false)} bankId={sel} q={editQ} onSaved={() => { setShowQ(false); loadQs(); loadBanks(); }} toast={toast} />
    </div>
  );
}
