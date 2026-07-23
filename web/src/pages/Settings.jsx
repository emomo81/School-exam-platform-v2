import React, { useState } from 'react';
import { api } from '../api.js';
import { Card, Btn, Field, Icon, useToast } from '../ui.jsx';
import { useAuth } from '../App.jsx';

export default function Settings() {
  const { teacher } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const change = async () => {
    if (pw.next !== pw.confirm) return toast('New passwords do not match', 'err');
    try {
      await api.post('/api/auth/teacher/change-password', { current: pw.current, next: pw.next });
      toast('Password changed');
      setPw({ current: '', next: '', confirm: '' });
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <div>
      <div className="page-head"><div><h1 className="page-title">Settings</h1><div className="page-sub">Your instructor account.</div></div></div>
      <div className="g-r2">
        <Card title="Profile">
          <div className="kv"><span>Name</span><b>{teacher?.name}</b></div>
          <div className="kv"><span>Email</span><b>{teacher?.email}</b></div>
          <div className="kv"><span>Role</span><b>{teacher?.role}</b></div>
          <div className="hint" style={{ marginTop: 10 }}>Co-teachers and TAs are assigned per course (Course → Teachers tab).</div>
        </Card>
        <Card title="Change password">
          <Field label="Current password"><input className="input" type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
          <Field label="New password" hint="Minimum 8 characters."><input className="input" type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
          <Field label="Confirm new password"><input className="input" type="password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
          <Btn kind="primary" onClick={change} disabled={!pw.current || !pw.next}>Update password</Btn>
        </Card>
      </div>
    </div>
  );
}
