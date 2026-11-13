// Run once from a trusted computer after `npm install` in this folder.
// Requires Google Application Default Credentials for the correct Firebase project.
const {initializeApp,applicationDefault}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const projectId=process.env.GCLOUD_PROJECT||'vexo-v2';
initializeApp({credential:applicationDefault(),projectId});
(async()=>{const email=(process.argv[2]||'').trim().toLowerCase();if(!email)throw new Error('Usage: node bootstrap-god.js owner@example.com');const user=await getAuth().getUserByEmail(email);await getAuth().setCustomUserClaims(user.uid,{...(user.customClaims||{}),god:true});console.log(`GOD claim assigned to ${email} (${user.uid}). Sign out and sign in again.`);process.exit(0);})().catch(e=>{console.error(e);process.exit(1);});
