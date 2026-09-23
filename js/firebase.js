(() => {
  const cfg = window.NDB_CONFIG?.firebaseConfig;
  const configured = !!(cfg && cfg.apiKey && cfg.projectId && window.firebase);
  window.ndbConfigured = configured;
  if (!configured) {
    window.fbApp = null;
    window.auth = null;
    window.db = null;
    return;
  }
  window.fbApp = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
  window.auth = firebase.auth();
  window.db = firebase.firestore();
})();
