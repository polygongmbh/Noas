// Wait for DOM to be fully loaded
document.addEventListener('DOMContentLoaded', function() {
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

// Simple signup form elements
const signupForm = document.getElementById('signupForm');
const signupUsername = document.getElementById('signupUsername');
const signupPassword = document.getElementById('signupPassword');
const signupPasswordConfirm = document.getElementById('signupPasswordConfirm');
const signupNsec = document.getElementById('signupNsec');
const signupRelays = document.getElementById('signupRelays');
const signupStatus = document.getElementById('signupStatus');
const signupSuccess = document.getElementById('signupSuccess');
const successUsername = document.getElementById('successUsername');
const successPublicKey = document.getElementById('successPublicKey');

console.log('📝 Signup form elements initialized:', {
  signupForm: !!signupForm,
  signupStatus: !!signupStatus
});

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

// Simple Account Registration - Server handles all key processing
function validateSignupForm() {
  const username = signupUsername?.value.trim() || '';
  const password = signupPassword?.value || '';
  const passwordConfirm = signupPasswordConfirm?.value || '';
  const nsecValue = signupNsec?.value.trim() || '';

  // Validate required fields
  if (!username) {
    setStatus(signupStatus, 'Username is required', 'error');
    signupUsername?.focus();
    return false;
  }
  if (!password) {
    setStatus(signupStatus, 'Password is required', 'error');
    signupPassword?.focus();
    return false;
  }
  if (!passwordConfirm) {
    setStatus(signupStatus, 'Please confirm your password', 'error');
    signupPasswordConfirm?.focus();
    return false;
  }
  if (!nsecValue) {
    setStatus(signupStatus, 'Private key is required', 'error');
    signupNsec?.focus();
    return false;
  }

  // Validate formats
  if (!/^[a-z0-9_]{3,32}$/.test(username)) {
    setStatus(signupStatus, 'Username must be 3-32 characters, lowercase letters, numbers, and underscore only', 'error');
    signupUsername?.focus();
    return false;
  }
  
  if (password.length < 8) {
    setStatus(signupStatus, 'Password must be at least 8 characters long', 'error');
    signupPassword?.focus();
    return false;
  }
  
  if (password !== passwordConfirm) {
    setStatus(signupStatus, 'Passwords do not match', 'error');
    signupPasswordConfirm?.focus();
    return false;
  }

  return true;
}

// Handle signup form submission  
if (signupForm) {
  signupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    console.log('🚀 Creating new account...');
    
    if (!validateSignupForm()) return;
    
    const username = signupUsername.value.trim().toLowerCase();
    const password = signupPassword.value;
    const nsecKey = signupNsec.value.trim();
    const relaysText = signupRelays?.value.trim() || '';
    
    setStatus(signupStatus, 'Creating account...', 'info');
    
    try {
      // Parse relays
      const relays = relaysText 
        ? relaysText.split('\n').map(r => r.trim()).filter(r => r && r.startsWith('wss://'))
        : [];
      
      // Register with server - server handles all key processing
      const response = await fetch('/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          nsecKey,
          relays
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Registration failed');
      }
      
      // Show success
      successUsername.textContent = data.user.username;
      successPublicKey.textContent = data.user.publicKey;
      signupSuccess.hidden = false;
      
      setStatus(signupStatus, '🎉 Account created successfully!', 'success');
      
      // Clear form
      signupForm.reset();
      
      // Scroll to result
      signupSuccess.scrollIntoView({ behavior: 'smooth' });
      
    } catch (error) {
      console.error('❌ Registration failed:', error);
      setStatus(signupStatus, `❌ Registration failed: ${error.message}`, 'error');
    }
  });
}
});
