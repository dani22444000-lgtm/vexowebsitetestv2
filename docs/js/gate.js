import { auth } from './firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
onAuthStateChanged(auth, user => {
  location.replace(user ? 'dashboard.html' : 'login.html');
});
