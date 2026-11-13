// Run once from a trusted computer after `npm install` in this folder.
// Requires Google Application Default Credentials for the correct Firebase project.
const {initializeApp, applicationDefault} = require('firebase-admin/app');
const {getAuth} = require('firebase-admin/auth');

// Hardcoded project ID for safety
const projectId = 'vexo-v2'; 

initializeApp({
  credential: applicationDefault(),
  projectId: projectId
});

(async () => {
  const email = (process.argv[2] || '').trim().toLowerCase();
  
  if (!email) {
    throw new Error('Usage: node bootstrap-god.js owner@example.com');
  }
  
  try {
    const user = await getAuth().getUserByEmail(email);
    await getAuth().setCustomUserClaims(user.uid, {
      ...(user.customClaims || {}),
      god: true
    });
    console.log(`✅ GOD claim assigned to ${email} (${user.uid}).`);
    console.log(`⚠️ You must sign out and sign in again on the website.`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to assign GOD claim:', error.message);
    process.exit(1);
  }
})();
