const source = 'too-many-leagues-connector';

function notify(id, status, result) {
  window.postMessage({ source, id, status, result }, location.origin);
}

window.addEventListener('message', async (event) => {
  if (event.source !== window || event.origin !== location.origin || event.data?.source !== 'too-many-leagues-app') return;
  const { id, action, provider, openLogin } = event.data;
  if (action === 'ping') { notify(id, 'available'); return; }
  if (action !== 'connect' || !['espn', 'yahoo'].includes(provider) || typeof id !== 'string') return;
  try {
    const reply = await chrome.runtime.sendMessage({ type: 'tml-connect', provider, openLogin });
    if (reply?.status !== 'ready') { notify(id, reply?.status === 'login-required' ? 'login-required' : 'error'); return; }
    const response = await fetch(`/api/${provider}/extension`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(reply.credentials),
    });
    const result = await response.json();
    notify(id, response.ok ? 'connected' : 'error', response.ok ? result : { status: response.status, error: result?.error || 'Could not connect this account.' });
  } catch {
    notify(id, 'error', { error: 'Could not connect this account. Try again.' });
  }
});

notify(null, 'available');
