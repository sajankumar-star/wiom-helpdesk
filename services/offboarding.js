// ════════════════════════════════════════════════════════════════════
// Employee Exit — Google Workspace (Gmail) + Slack deactivation
// No extra npm packages: Google service-account JWT is signed with node crypto.
// ════════════════════════════════════════════════════════════════════
const crypto = require('crypto');

// ── Config helpers ──────────────────────────────────────────────────────────
// GOOGLE_SERVICE_ACCOUNT_JSON may be raw JSON or base64 of the JSON file
const getGoogleKey = () => {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const key  = JSON.parse(text);
    if (!key.client_email || !key.private_key) return null;
    return key;
  } catch {
    return null;
  }
};

const googleConfigured = () => !!(getGoogleKey() && process.env.GOOGLE_ADMIN_EMAIL);
const slackConfigured  = () => !!process.env.SLACK_SCIM_TOKEN;

const integrationStatus = () => ({
  google: googleConfigured(),
  slack : slackConfigured(),
});

// ── Google: service-account access token (domain-wide delegation) ───────────
const b64url = (buf) => Buffer.from(buf).toString('base64')
  .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

let cachedToken = null; // { token, exp }

const getGoogleAccessToken = async () => {
  if (cachedToken && cachedToken.exp > Date.now() + 60_000) return cachedToken.token;

  const key = getGoogleKey();
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim  = {
    iss  : key.client_email,
    sub  : process.env.GOOGLE_ADMIN_EMAIL,   // super-admin to impersonate
    scope: 'https://www.googleapis.com/auth/admin.directory.user',
    aud  : 'https://oauth2.googleapis.com/token',
    iat  : now,
    exp  : now + 3600,
  };
  const unsigned  = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(key.private_key);
  const assertion = `${unsigned}.${b64url(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method : 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body   : new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google auth failed: ${data.error_description || data.error || res.status}`);

  cachedToken = { token: data.access_token, exp: Date.now() + (data.expires_in || 3600) * 1000 };
  return cachedToken.token;
};

// ── Google: suspend user + sign out of all sessions ─────────────────────────
const suspendGoogleUser = async (email) => {
  if (!googleConfigured()) throw new Error('Google Workspace API configured nahi hai');
  if (!email) throw new Error('Employee ka email nahi mila');

  const token = await getGoogleAccessToken();
  const base  = `https://admin.googleapis.com/admin/directory/v1/users/${encodeURIComponent(email)}`;

  const res = await fetch(base, {
    method : 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body   : JSON.stringify({ suspended: true }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail suspend failed: ${data.error?.message || res.status}`);

  // Kick out active sessions (phone / browser) — best effort, suspend already done
  await fetch(`${base}/signOut`, {
    method : 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  }).catch(() => {});

  return { suspended: true };
};

// ── Slack: find user ID by email (bot token, users:read.email) ──────────────
const lookupSlackUserId = async (email) => {
  if (!email || !process.env.SLACK_BOT_TOKEN) return null;
  const res  = await fetch(`https://slack.com/api/users.lookupByEmail?email=${encodeURIComponent(email)}`, {
    headers: { 'Authorization': `Bearer ${process.env.SLACK_BOT_TOKEN}` },
  });
  const data = await res.json().catch(() => ({}));
  return data.ok ? data.user.id : null;
};

// ── Slack: deactivate via SCIM (needs Business+ / Enterprise + admin user token) ─
const deactivateSlackUser = async ({ slackUserId, email }) => {
  if (!slackConfigured()) throw new Error('Slack SCIM token configured nahi hai');

  const userId = slackUserId || await lookupSlackUserId(email);
  if (!userId) throw new Error('Slack user ID nahi mila (email se bhi lookup fail)');

  const res = await fetch(`https://api.slack.com/scim/v2/Users/${encodeURIComponent(userId)}`, {
    method : 'DELETE',
    headers: { 'Authorization': `Bearer ${process.env.SLACK_SCIM_TOKEN}` },
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    const msg  = data.Errors?.description || data.detail || res.status;
    throw new Error(`Slack deactivate failed: ${msg}`);
  }
  return { deactivated: true, slackUserId: userId };
};

module.exports = {
  integrationStatus,
  suspendGoogleUser,
  deactivateSlackUser,
};
