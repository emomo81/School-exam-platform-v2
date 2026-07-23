import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { api } from './api.js';
import Shell from './Shell.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Courses from './pages/Courses.jsx';
import CourseDetail from './pages/CourseDetail.jsx';
import Exams from './pages/Exams.jsx';
import ExamDetail from './pages/ExamDetail.jsx';
import QuestionBank from './pages/QuestionBank.jsx';
import Students from './pages/Students.jsx';
import Monitoring from './pages/Monitoring.jsx';
import MonitorExam from './pages/MonitorExam.jsx';
import Results from './pages/Results.jsx';
import ExamAnalytics from './pages/ExamAnalytics.jsx';
import Reports from './pages/Reports.jsx';
import AIStudio from './pages/AIStudio.jsx';
import Settings from './pages/Settings.jsx';
import Integrations from './pages/Integrations.jsx';
import AuditLogs from './pages/AuditLogs.jsx';
import StudentApp from './student/StudentApp.jsx';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function TeacherArea() {
  const loc = useLocation();
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        <Route path="courses" element={<Courses />} />
        <Route path="courses/:id" element={<CourseDetail />} />
        <Route path="exams" element={<Exams />} />
        <Route path="exams/:id" element={<ExamDetail />} />
        <Route path="question-bank" element={<QuestionBank />} />
        <Route path="monitoring" element={<Monitoring />} />
        <Route path="monitoring/:id" element={<MonitorExam />} />
        <Route path="results" element={<Results />} />
        <Route path="results/:id" element={<ExamAnalytics />} />
        <Route path="reports" element={<Reports />} />
        <Route path="ai-studio" element={<AIStudio />} />
        <Route path="settings" element={<Settings />} />
        <Route path="integrations" element={<Integrations />} />
        <Route path="audit-logs" element={<AuditLogs />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  const [teacher, setTeacher] = useState(undefined); // undefined = loading
  const load = useCallback(async () => {
    try { setTeacher(await api.get('/api/auth/me')); }
    catch { setTeacher(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const value = { teacher, reload: load, setTeacher };
  return (
    <AuthCtx.Provider value={value}>
      <Routes>
        <Route path="/exam/*" element={<StudentApp />} />
        <Route path="/login" element={<Login onAuth={setTeacher} />} />
        <Route
          path="/*"
          element={
            teacher === undefined
              ? <div className="spinner-wrap" style={{ height: '100vh' }}><span className="spinner" /></div>
              : teacher ? <TeacherArea /> : <Navigate to="/login" replace />
          }
        />
      </Routes>
    </AuthCtx.Provider>
  );
}
