import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, setStudentToken, setTeacherToken } from '../api.js';
import { Btn, Field, Icon, useToast } from '../ui.jsx';

export default function Login({ onAuth }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [mode, setMode] = useState('teacher'); // teacher | register | student
  const [f, setF] = useState({ email: 'john.doe@exampro.edu', password: 'demo1234', name: '', roll: 'STU-1001', code: 'CARD-7291' });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'teacher' || mode === 'register') {
        const u = mode === 'teacher'
          ? await api.post('/api/auth/teacher/login', { email: f.email, password: f.password })
          : await api.post('/api/auth/teacher/register', { name: f.name, email: f.email, password: f.password });
        if (u.token) setTeacherToken(u.token);
        onAuth(u);
        navigate('/');
      } else {
        const r = await api.post('/api/auth/student/login', { rollNo: f.roll, accessCode: f.code });
        setStudentToken(r.token);
        navigate('/exam/lobby');
      }
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <div className="logo-mark"><Icon name="grad" size={19} /></div>
          <div>
            <div className="logo-name">ExamPro</div>
            <div className="logo-tag">Secure. Fair. Transparent.</div>
          </div>
        </div>

        <div className="login-tabs">
          <button className={mode === 'teacher' ? 'on' : ''} onClick={() => setMode('teacher')}>Instructor</button>
          <button className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>Register</button>
          <button className={mode === 'student' ? 'on' : ''} onClick={() => setMode('student')}>Student</button>
        </div>

        {mode === 'register' && (
          <Field label="Full name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Dr. Jane Smith" /></Field>
        )}
        {mode !== 'student' ? (
          <>
            <Field label="Email"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
            <Field label="Password" hint={mode === 'register' ? 'Minimum 8 characters.' : ''}>
              <input className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            </Field>
            <Btn kind="primary" className="btn-block btn-xl" onClick={submit} disabled={busy || !f.email || !f.password || (mode === 'register' && !f.name)}>
              {mode === 'teacher' ? 'Sign in' : 'Create instructor account'}
            </Btn>
            <div className="demo-box">
              <b>Seeded accounts</b><br />
              Instructor: <code>john.doe@exampro.edu / demo1234</code><br />
              Co-teacher: <code>mark.rivera@exampro.edu</code> · TA: <code>alice.chen@exampro.edu</code> · Admin: <code>admin@exampro.edu / admin1234</code>
            </div>
          </>
        ) : (
          <>
            <Field label="Roll number"><input className="input" value={f.roll} onChange={(e) => setF({ ...f, roll: e.target.value })} placeholder="STU-1001" /></Field>
            <Field label="Exam access code" hint="Your instructor shared this with the roster.">
              <input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} onKeyDown={(e) => e.key === 'Enter' && submit()} />
            </Field>
            <Btn kind="primary" className="btn-block btn-xl" onClick={submit} disabled={busy || !f.roll || !f.code}>Enter exam</Btn>
            <div className="demo-box">
              <b>Try the live exam:</b> roll <code>STU-1001</code> · code <code>CARD-7291</code><br />
              <b>See released results:</b> roll <code>STU-1121</code> · code <code>ANAT-1103</code>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
