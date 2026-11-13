import { auth } from './firebase.js';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile
} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import { httpsCallable, getFunctions } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js';

const $ = id => document.getElementById(id);
const functions = getFunctions(undefined, 'us-central1');
const ensurePlayer = httpsCallable(functions, 'ensurePlayer');
const msg = value => { const el = $('message'); if (el) el.textContent = value; };
const friendlyError = error => {
  const code = error?.code || '';
  const messages = {
    'auth/email-already-in-use': 'This email is already registered. Please sign in.',
    'auth/invalid-email': 'Invalid email format.',
    'auth/weak-password': 'Password must be at least 8 characters.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password.',
    'auth/invalid-credential': 'Incorrect email or password.',
    'auth/unauthorized-domain': 'This domain is not authorized in Firebase.',
    'auth/network-request-failed': 'Check your internet connection.',
    'functions/not-found': 'ensurePlayer function is not deployed.',
    'functions/unavailable': 'Server service is temporarily unavailable.'
  };
  return messages[code] || error?.message || 'Authentication failed.';
};

async function completeLogin(user, displayName = '') {
  msg('Account verified. Preparing VEXO profile…');
  await ensurePlayer(displayName ? { displayName } : {});
  location.replace('dashboard.html');
}

const form = $('loginForm');
if (form) {
  let currentMode = 'signin';

  document.querySelectorAll('.auth-tabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.auth-tabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentMode = tab.dataset.mode;
      const isSignup = currentMode === 'signup';
      document.querySelectorAll('.signup-only').forEach(el => el.hidden = !isSignup);
      $('password').autocomplete = isSignup ? 'new-password' : 'current-password';
      msg('');
    });
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('email').value.trim();
    const password = $('password').value;
    const isSignup = currentMode === 'signup';
    const displayName = $('username').value.trim();
    
    if (isSignup && displayName.length < 3) return msg('Display name must be at least 3 characters.');
    if (isSignup && password !== $('confirm').value) return msg('Passwords do not match.');
    
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    msg(isSignup ? 'Creating account…' : 'Signing in…');
    
    try {
      let credential;
      if (isSignup) {
        credential = await createUserWithEmailAndPassword(auth, email, password);
        await updateProfile(credential.user, { displayName });
        await completeLogin(credential.user, displayName);
      } else {
        credential = await signInWithEmailAndPassword(auth, email, password);
        await completeLogin(credential.user);
      }
    } catch (error) {
      console.error('VEXO authentication:', error);
      msg(friendlyError(error));
      submit.disabled = false;
    }
  });
}

if ($('logout')) $('logout').addEventListener('click', async () => {
  await signOut(auth); location.replace('login.html');
});

onAuthStateChanged(auth, user => {
  document.querySelectorAll('[data-user-email]').forEach(el => el.textContent = user?.email || 'Guest');
  const protectedPage = document.body.dataset.protected === 'true';
  if (protectedPage && !user) location.replace('login.html');
  if (form && user) location.replace('dashboard.html');
});
