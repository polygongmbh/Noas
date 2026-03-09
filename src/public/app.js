const state = {
  username: null,
  password: null,
};

const signinForm = document.getElementById('signinForm');
const updateForm = document.getElementById('updateForm');
const deleteForm = document.getElementById('deleteForm');
const signinStatus = document.getElementById('signinStatus');
const updateStatus = document.getElementById('updateStatus');
const deleteStatus = document.getElementById('deleteStatus');
const accountPanel = document.getElementById('accountPanel');
const publicKeyEl = document.getElementById('publicKey');
const encryptedKeyEl = document.getElementById('encryptedKey');
const relayListEl = document.getElementById('relayList');
const copyEncrypted = document.getElementById('copyEncrypted');

function setStatus(el, message, type = 'info') {
  if (!el) return;
  el.textContent = message;
  el.dataset.type = type;
}

function parseRelays(text) {
  if (!text) return [];
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function request(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error || 'Request failed';
    throw new Error(message);
  }
  return data;
}

signinForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus(signinStatus, 'Signing in...');
  const formData = new FormData(signinForm);
  const username = formData.get('username');
  const password = formData.get('password');

  try {
    const data = await request('/signin', { username, password });
    state.username = username;
    state.password = password;

    publicKeyEl.textContent = data.publicKey || '—';
    encryptedKeyEl.textContent = data.encryptedPrivateKey || '—';
    relayListEl.textContent = (data.relays || []).join(', ') || '—';
    accountPanel.hidden = false;
    setStatus(signinStatus, 'Signed in successfully.', 'success');
    updateForm.querySelector('textarea[name="relays"]').value = (data.relays || []).join('\n');
  } catch (error) {
    setStatus(signinStatus, error.message, 'error');
  }
});

copyEncrypted.addEventListener('click', async () => {
  const value = encryptedKeyEl.textContent;
  if (!value || value === '—') return;
  try {
    await navigator.clipboard.writeText(value);
    setStatus(signinStatus, 'Encrypted key copied to clipboard.', 'success');
  } catch (error) {
    setStatus(signinStatus, 'Unable to copy key. Copy it manually.', 'error');
  }
});

updateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.username || !state.password) {
    setStatus(updateStatus, 'Sign in before updating your account.', 'error');
    return;
  }

  const formData = new FormData(updateForm);
  const updates = {};
  const newPassword = formData.get('newPassword');
  const encryptedPrivateKey = formData.get('encryptedPrivateKey');
  const relays = parseRelays(formData.get('relays'));

  if (newPassword) updates.newPassword = newPassword;
  if (encryptedPrivateKey) updates.encryptedPrivateKey = encryptedPrivateKey;
  if (relays.length) updates.relays = relays;

  if (Object.keys(updates).length === 0) {
    setStatus(updateStatus, 'Add at least one field to update.', 'error');
    return;
  }

  setStatus(updateStatus, 'Updating account...');
  try {
    await request('/update', {
      username: state.username,
      password: state.password,
      updates,
    });
    setStatus(updateStatus, 'Account updated successfully.', 'success');
  } catch (error) {
    setStatus(updateStatus, error.message, 'error');
  }
});

deleteForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.username || !state.password) {
    setStatus(deleteStatus, 'Sign in before deleting your account.', 'error');
    return;
  }

  const formData = new FormData(deleteForm);
  const savedKey = formData.get('savedKey');
  const confirm = formData.get('confirm');

  if (!savedKey) {
    setStatus(deleteStatus, 'Please confirm you saved your private key.', 'error');
    return;
  }
  if (confirm !== 'DELETE') {
    setStatus(deleteStatus, 'Type DELETE to confirm account deletion.', 'error');
    return;
  }

  setStatus(deleteStatus, 'Deleting account...');
  try {
    await request('/delete', {
      username: state.username,
      password: state.password,
      savedKey: true,
    });
    setStatus(deleteStatus, 'Account deleted.', 'success');
    accountPanel.hidden = true;
    signinForm.reset();
    updateForm.reset();
    deleteForm.reset();
    state.username = null;
    state.password = null;
  } catch (error) {
    setStatus(deleteStatus, error.message, 'error');
  }
});
