(() => {
  if (location.origin !== 'https://rai-community.local' || window.top !== window) return;
  const launch = window.__RAI_LAUNCH__;
  delete window.__RAI_LAUNCH__;
  if (!launch) return;
  if (!localStorage.getItem('rai.webview2Imported')) {
    for (const [key, value] of Object.entries(launch.storage)) {
      if (localStorage.getItem(key) === null) {
        try { localStorage.setItem(key, value); }
        catch (error) { if (error.name !== 'QuotaExceededError') throw error; }
      }
    }
    localStorage.setItem('rai.webview2Imported', '1');
  }
  const pending = new Map();
  let sequence = 0;
  function request(method, value) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('The desktop shell did not respond.'));
      }, 330000);
      pending.set(id, { resolve, reject, timer });
      const json = JSON.stringify({ id, method, value }, (_, item) =>
        item instanceof Uint8Array ? { $bytes: Array.from(item) } : item);
      chrome.webview.postMessage(json);
    });
  }
  chrome.webview.addEventListener('message', ({ data }) => {
    const reply = pending.get(data.id);
    if (!reply) return;
    pending.delete(data.id);
    clearTimeout(reply.timer);
    if (data.error) reply.reject(new Error(data.error));
    else reply.resolve(data.value);
  });
  window.__HC_LAUNCHER_ENV__ = {
    APP_INTERFACE_PORT: launch.appPort,
    APP_INTERFACE_TOKEN: launch.token,
    INSTALLED_APP_ID: launch.appId,
  };
  window.__HC_ZOME_CALL_SIGNER__ = {
    async signZomeCall(value) {
      const { bytes, signature } = await request('sign', value);
      return { bytes: Uint8Array.from(bytes), signature: Uint8Array.from(signature) };
    },
  };
  window.raiShell = {
    getNetwork: () => request('getNetwork'),
    setNetwork: value => request('setNetwork', value),
    restart: () => request('restart'),
    downloadUpdate: (url, sha256) => request('downloadUpdate', { url, sha256 }),
    openUpdate: file => request('openUpdate', file),
  };
})();
