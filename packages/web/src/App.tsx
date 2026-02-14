import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/auth.js";
import { useUiStore } from "./store/ui.js";
import Login from "./pages/Login.js";
import Register from "./pages/Register.js";
import Chat from "./pages/Chat.js";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Apply a11y data attributes to <html> element so CSS can respond */
function useA11yAttributes() {
  const theme = useUiStore((s) => s.theme);
  const reducedMotion = useUiStore((s) => s.a11yReducedMotion);
  const font = useUiStore((s) => s.a11yFont);
  const highContrast = useUiStore((s) => s.a11yHighContrast);

  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("data-theme", theme);

    if (reducedMotion) el.setAttribute("data-reduced-motion", "");
    else el.removeAttribute("data-reduced-motion");

    if (font !== "default") el.setAttribute("data-a11y-font", font);
    else el.removeAttribute("data-a11y-font");

    if (highContrast) el.setAttribute("data-high-contrast", "");
    else el.removeAttribute("data-high-contrast");
  }, [theme, reducedMotion, font, highContrast]);
}

export default function App() {
  const init = useAuthStore((s) => s.init);
  const initialized = useAuthStore((s) => s.initialized);
  const user = useAuthStore((s) => s.user);

  useA11yAttributes();

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
