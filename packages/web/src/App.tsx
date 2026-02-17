import { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { needsServerUrl } from "./lib/serverUrl";
import { useAuthStore } from "./store/auth.js";
import { useUiStore } from "./store/ui.js";
import { sanitizeCss } from "./lib/sanitize-css.js";
import "./i18n/index.js";
import Login from "./pages/Login.js";
import Register from "./pages/Register.js";
import ServerConnect from "./pages/ServerConnect.js";
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
  const customCss = useUiStore((s) => s.customCss);

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

  // Inject user custom CSS into a <style> tag
  useEffect(() => {
    const id = "haven-custom-css";
    let el = document.getElementById(id) as HTMLStyleElement | null;
    if (!customCss) {
      el?.remove();
      return;
    }
    if (!el) {
      el = document.createElement("style");
      el.id = id;
      document.head.appendChild(el);
    }
    el.textContent = sanitizeCss(customCss);
    return () => { el?.remove(); };
  }, [customCss]);
}

export default function App() {
  const init = useAuthStore((s) => s.init);
  const initialized = useAuthStore((s) => s.initialized);
  const user = useAuthStore((s) => s.user);

  useA11yAttributes();

  useEffect(() => {
    init();
  }, [init]);

  if (!initialized) return null;

  const connectRequired = needsServerUrl();

  return (
    <Routes>
      <Route path="/connect" element={<ServerConnect />} />
      <Route path="/login" element={connectRequired ? <Navigate to="/connect" replace /> : user ? <Navigate to="/" replace /> : <Login />} />
      <Route path="/register" element={connectRequired ? <Navigate to="/connect" replace /> : user ? <Navigate to="/" replace /> : <Register />} />
      <Route
        path="/*"
        element={
          connectRequired ? <Navigate to="/connect" replace /> :
          <RequireAuth>
            <Chat />
          </RequireAuth>
        }
      />
    </Routes>
  );
}
