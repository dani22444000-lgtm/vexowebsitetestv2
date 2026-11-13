import { auth } from './firebase.js';
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  GoogleAuthProvider, signInWithPopup, onAuthStateChanged, signOut,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import { httpsCallable, getFunctions } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js';

const $ = id => document.getElementById(id);
const functions = getFunctions(undefined, 'us-central1');
const ensurePlayer = httpsCallable(functions, 'ensurePlayer');
const msg = value => { const el = $('message'); if (el) el.textContent = value; };
const friendlyError = error => {
  const code = error?.code || '';
  const messages = {
    'auth/email-already-in-use': 'این ایمیل قبلاً ثبت‌نام کرده است. وارد حساب شوید.',
    'auth/invalid-email': 'فرمت ایمیل معتبر نیست.',
    'auth/weak-password': 'رمز عبور باید حداقل ۸ کاراکتر باشد.',
    'auth/user-not-found': 'حسابی با این ایمیل پیدا نشد.',
    'auth/wrong-password': 'رمز عبور اشتباه است.',
    'auth/invalid-credential': 'ایمیل یا رمز عبور اشتباه است.',
    'auth/popup-closed-by-user': 'پنجره ورود گوگل بسته شد.',
    'auth/unauthorized-domain': 'این دامنه در Firebase مجاز نشده است.',
    'auth/network-request-failed': 'اتصال اینترنت را بررسی کنید.',
    'functions/not-found': 'تابع ensurePlayer روی Firebase مستقر نشده است؛ ابتدا Cloud Functions را Deploy کنید.',
    'functions/unavailable': 'سرویس سرور موقتاً در دسترس نیست.'
  };
  return messages[code] || error?.message || 'عملیات ورود ناموفق بود.';
};

async function completeLogin(user, displayName = '') {
  msg('حساب تأیید شد؛ در حال آماده‌سازی پروفایل VEXO…');
  // ensurePlayer creates the server-side profile, unique Player ID and initial wallet.
  await ensurePlayer(displayName ? { displayName } : {});
  location.replace('dashboard.html');
}

const form = $('loginForm');
if (form) {
  const mode = $('mode');
  const syncMode = () => {
    const signup = mode.value === 'signup';
    $('username').required = signup;
    $('confirm').required = signup;
    $('username').closest('.field').hidden = !signup;
    $('confirm').closest('.field').hidden = !signup;
    $('password').autocomplete = signup ? 'new-password' : 'current-password';
  };
  mode.addEventListener('change', syncMode);
  syncMode();

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('email').value.trim();
    const password = $('password').value;
    const signup = mode.value === 'signup';
    const displayName = $('username').value.trim();
    if (signup && displayName.length < 3) return msg('نام کاربری باید حداقل ۳ کاراکتر باشد.');
    if (signup && password !== $('confirm').value) return msg('تکرار رمز عبور با رمز اصلی یکسان نیست.');
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    msg(signup ? 'در حال ساخت حساب در Firebase Authentication…' : 'در حال ورود…');
    try {
      let credential;
      if (signup) {
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

if ($('google')) $('google').addEventListener('click', async () => {
  const button = $('google'); button.disabled = true;
  try {
    const credential = await signInWithPopup(auth, new GoogleAuthProvider());
    await completeLogin(credential.user, credential.user.displayName || '');
  } catch (error) { console.error(error); msg(friendlyError(error)); button.disabled = false; }
});

if ($('logout')) $('logout').addEventListener('click', async () => {
  await signOut(auth); location.replace('login.html');
});

// Route authenticated visitors away from the login screen; guard every protected page.
onAuthStateChanged(auth, user => {
  document.querySelectorAll('[data-user-email]').forEach(el => el.textContent = user?.email || 'Guest');
  const protectedPage = document.body.dataset.protected === 'true';
  if (protectedPage && !user) location.replace('login.html');
  if (form && user) location.replace('dashboard.html');
});
