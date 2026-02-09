import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/auth.js";
import Login from "./pages/Login.js";
import Register from "./pages/Register.js";
import Chat from "./pages/Chat.js";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const init = useAuthStore((s) => s.init);
  const initialized = useAuthStore((s) => s.initialized);
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    init();
  }, [init]);

  if (!initialized) {
    return (
      <div className="loading-screen">
        <h1>Haven</h1>
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Chat />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
