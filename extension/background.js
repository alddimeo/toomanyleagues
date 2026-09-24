const appOrigins = new Set([
  'https://toomanyleagues.alddimeo.workers.dev',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]);

const providers = {
  espn: { url: 'https://fantasy.espn.com/', login: 'https://fantasy.espn.com/', names: ['espn_s2', 'SWID'] },
  yahoo: { url: 'https://football.fantasysports.yahoo.com/', login: 'https://football.fantasysports.yahoo.com/', names: ['Y', 'T'] },
};

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  let origin;
  try { origin = new URL(sender.url || sender.tab?.url).origin; } catch { return; }
  if (!appOrigins.has(origin) || message?.type !== 'tml-connect' || !Object.hasOwn(providers, message.provider)) return;
  (async () => {
    const provider = providers[message.provider];
    const cookies = await Promise.all(provider.names.map((name) => chrome.cookies.get({ url: provider.url, name })));
    if (cookies.some((cookie) => !cookie?.value)) {
      if (message.openLogin === true) await chrome.tabs.create({ url: provider.login });
      reply({ status: 'login-required' });
      return;
    }
    reply({ status: 'ready', credentials: Object.fromEntries(provider.names.map((name, index) => [name, cookies[index].value])) });
  })().catch(() => reply({ status: 'error' }));
  return true;
});
