// Firebase bootstrap. Everything else imports `db`, `auth` and the helpers from here.
// No build step: this is a plain ES module loaded straight from the CDN.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js';
import {
  getDatabase, ref, set, update, get, push, remove, onValue, runTransaction,
  query, orderByChild, limitToLast, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile
} from 'https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAmjPncy6Css6xOTF1E97Xb6eZO9tXUhok',
  authDomain: 'mrguitarpos.firebaseapp.com',
  databaseURL: 'https://mrguitarpos-default-rtdb.firebaseio.com',
  projectId: 'mrguitarpos',
  storageBucket: 'mrguitarpos.firebasestorage.app',
  messagingSenderId: '730797498075',
  appId: '1:730797498075:web:36e2b2e8a496602c33b6fe',
  measurementId: 'G-H5SMTVZ7MK'
};

export const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const auth = getAuth(app);

export {
  ref, set, update, get, push, remove, onValue, runTransaction,
  query, orderByChild, limitToLast, serverTimestamp,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, sendPasswordResetEmail, updateProfile
};

/** Shorthand: dbRef('inventory', id) -> ref(db, 'inventory/id') */
export const R = (...parts) => ref(db, parts.filter(p => p !== undefined && p !== null).join('/'));
