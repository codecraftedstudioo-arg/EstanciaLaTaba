/* Acceso simple de este navegador.
   La contraseña solo se guarda como hash SHA-256.
   config.js es opcional, está en .gitignore y puede reemplazar este acceso
   cuando haya autenticación real. */
(function () {
  const AUTH_KEY = "la-taba-anfitrion-auth";
  const SESSION_KEY = "la-taba-anfitrion-session";

  async function sha256(text) {
    const encoded = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", encoded);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function deviceRecord() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    } catch (error) {
      return null;
    }
  }

  function fileRecord() {
    const config = window.ANFITRION_CONFIG;
    if (!config || !config.user || !config.passwordHash) return null;
    return { user: String(config.user).trim(), passwordHash: String(config.passwordHash).trim() };
  }

  function credentials() {
    return fileRecord() || deviceRecord();
  }

  function session() {
    try {
      return JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
    } catch (error) {
      return null;
    }
  }

  async function defineAccess(user, password) {
    const record = { user: user.trim(), passwordHash: await sha256(password) };
    localStorage.setItem(AUTH_KEY, JSON.stringify(record));
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user: record.user, at: new Date().toISOString() }));
  }

  async function login(user, password) {
    const record = credentials();
    if (!record) throw new Error("Todavía no hay un acceso configurado en este dispositivo.");
    const hash = await sha256(password);
    if (user.trim().toLocaleLowerCase("es") !== record.user.toLocaleLowerCase("es") || hash !== record.passwordHash) {
      throw new Error("Usuario o contraseña incorrectos.");
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ user: record.user, at: new Date().toISOString() }));
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  function loadOptionalConfig() {
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "config.js";
      script.onload = () => resolve(fileRecord());
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
  }

  window.AnfitrionAuth = {
    sha256,
    credentials,
    session,
    defineAccess,
    login,
    logout,
    loadOptionalConfig,
  };
})();
