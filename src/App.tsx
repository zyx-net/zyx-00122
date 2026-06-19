import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import Home from "@/pages/Home";
import TaskList from "@/pages/inspector/TaskList";
import Inspect from "@/pages/inspector/Inspect";
import Anomalies from "@/pages/inspector/Anomalies";
import Templates from "@/pages/admin/Templates";
import TemplateEdit from "@/pages/admin/TemplateEdit";
import Review from "@/pages/admin/Review";
import ReviewDetail from "@/pages/admin/ReviewDetail";
import Logs from "@/pages/Logs";
import Export from "@/pages/Export";
import ImportCenter from "@/pages/ImportCenter";
import Toast from "@/components/Toast";
import { seedDatabase } from "@/db";

function AppContent() {
  useEffect(() => {
    seedDatabase()
  }, [])

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/inspector/tasks" element={<TaskList />} />
        <Route path="/inspector/inspect/:taskId" element={<Inspect />} />
        <Route path="/inspector/anomalies" element={<Anomalies />} />
        <Route path="/inspector/logs" element={<Logs />} />
        <Route path="/admin/templates" element={<Templates />} />
        <Route path="/admin/templates/:id" element={<TemplateEdit />} />
        <Route path="/admin/review" element={<Review />} />
        <Route path="/admin/review/:taskId" element={<ReviewDetail />} />
        <Route path="/admin/logs" element={<Logs />} />
        <Route path="/logs/:taskId?" element={<Logs />} />
        <Route path="/export" element={<Export />} />
        <Route path="/import-center" element={<ImportCenter />} />
        <Route path="/admin/import-center" element={<ImportCenter />} />
        <Route path="/inspector/import-center" element={<ImportCenter />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toast />
    </>
  );
}

export default function App() {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
