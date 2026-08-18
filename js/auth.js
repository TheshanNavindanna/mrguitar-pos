// Sign in / sign up / approval gate. Note that every check here is a convenience —
// the real enforcement lives in database.rules.json.
import {
  auth, R, get, set,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail
} from './firebase.js';
import { state, subscribeAll, unsubscribeAll, emit } from './store.js';
import { $, esc, toast } from './util.js';

let signUpMode = false;

const FRIENDLY = {
  'auth/invalid-email': 'That email address is not valid.',
  'auth/user-not-found': 'No account found for that email.',
  'auth/wrong-password': 'Incorrect password.',
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/email-already-in-use': 'An account already exists for that email.',
  'auth/weak-password': 'Password must be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please wait a minute and try again.',
  'auth/network-request-failed': 'No internet connection.'
};

const friendly = err => FRIENDLY[err?.code] || err?.message || 'Something went wrong.';

function setAuthError(msg) {
  const box = $('#auth-error');
  if (!box) return;
  box.textContent = msg || '';
  box.hidden = !msg;
}

function setBusy(busy) {
  const btn = $('#auth-submit');
  if (!btn) return;
  btn.disabled = busy;
  btn.textContent = busy ? 'Please wait…' : (signUpMode ? 'Create account' : 'Login');
}

export function toggleAuthMode() {
  signUpMode = !signUpMode;
  $('#auth-title').textContent = signUpMode ? 'Create staff account' : 'Staff login';
  $('#auth-submit').textContent = signUpMode ? 'Create account' : 'Login';
  $('#auth-toggle-text').innerHTML = signUpMode
    ? 'Already have an account? <span>Login</span>'
    : 'Need an account? <span>Sign up</span>';
  $('#auth-name-field').hidden = !signUpMode;
  setAuthError('');
}

export async function handleAuth() {
  const email = $('#auth-email').value.trim();
  const password = $('#auth-password').value;
  const name = $('#auth-name').value.trim();

  if (!email || !password) return setAuthError('Enter both email and password.');
  if (signUpMode && password.length < 6) return setAuthError('Password must be at least 6 characters.');

  setBusy(true);
  setAuthError('');
  try {
    if (signUpMode) {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      sessionStorage.setItem('mrguitar.pendingName', name || email.split('@')[0]);
      await provisionProfile(cred.user, name);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    setAuthError(friendly(err));
  } finally {
    setBusy(false);
  }
}

export async function resetPassword() {
  const email = $('#auth-email').value.trim();
  if (!email) return setAuthError('Enter your email address first, then tap "Forgot password".');
  try {
    await sendPasswordResetEmail(auth, email);
    toast('Password reset link sent to ' + email, 'success', 4000);
    setAuthError('');
  } catch (err) {
    setAuthError(friendly(err));
  }
}

/**
 * Create the /users record for a brand new account.
 * The very first account in an empty database becomes the admin — after that the
 * rules force every self-created record to pending/staff.
 */
async function provisionProfile(user, name) {
  let seeded = true;
  try {
    seeded = (await get(R('meta/seeded'))).exists();
  } catch {
    seeded = true; // can't read -> assume not first
  }

  const profile = {
    email: user.email,
    name: name || sessionStorage.getItem('mrguitar.pendingName') || user.email.split('@')[0],
    status: seeded ? 'pending' : 'approved',
    role: seeded ? 'staff' : 'admin',
    createdAt: Date.now()
  };

  await set(R('users', user.uid), profile);
  if (!seeded) {
    await set(R('meta/seeded'), true);
  }
  return profile;
}

export async function logout() {
  unsubscribeAll();
  await signOut(auth);
  state.user = null;
  state.profile = null;
  state.role = 'staff';
  toast('Signed out', 'info');
}

function showAuthScreen(message) {
  $('#boot-screen').hidden = true;
  $('#auth-screen').hidden = false;
  $('#app').hidden = true;
  if (message) setAuthError(message);
}

function showApp() {
  $('#boot-screen').hidden = true;
  $('#auth-screen').hidden = true;
  $('#app').hidden = false;
  setAuthError('');
  $('#auth-password').value = '';
}

/**
 * Wire the auth listener. `onReady(profile)` runs once the user is signed in AND approved.
 */
export function initAuth(onReady) {
  onAuthStateChanged(auth, async user => {
    if (!user) {
      unsubscribeAll();
      state.user = null;
      state.profile = null;
      showAuthScreen();
      emit('auth', null);
      return;
    }

    let snap;
    try {
      snap = await get(R('users', user.uid));
    } catch (err) {
      showAuthScreen('Could not reach the database. Check your connection and try again.');
      return;
    }

    let profile = snap.val();

    if (!profile) {
      // Account exists in Auth but has no profile record (e.g. admin deleted it).
      try {
        profile = await provisionProfile(user, sessionStorage.getItem('mrguitar.pendingName'));
      } catch {
        await signOut(auth);
        return showAuthScreen('Your account could not be set up. Ask an admin for help.');
      }
    }

    if (profile.status === 'blocked') {
      await signOut(auth);
      return showAuthScreen('This account has been blocked. Contact the shop admin.');
    }

    if (profile.status !== 'approved') {
      await signOut(auth);
      return showAuthScreen('Your account is waiting for admin approval.');
    }

    sessionStorage.removeItem('mrguitar.pendingName');
    state.user = { uid: user.uid, email: user.email };
    state.profile = profile;
    state.role = profile.role || 'staff';

    subscribeAll();
    showApp();
    emit('auth', profile);
    onReady(profile);
  });
}

/** Bind the login screen controls. */
export function mountAuthUI() {
  $('#auth-submit').addEventListener('click', handleAuth);
  $('#auth-toggle').addEventListener('click', toggleAuthMode);
  $('#auth-forgot').addEventListener('click', resetPassword);
  $('#auth-password').addEventListener('keydown', e => { if (e.key === 'Enter') handleAuth(); });
  $('#auth-email').addEventListener('keydown', e => { if (e.key === 'Enter') $('#auth-password').focus(); });
}

export { esc };
