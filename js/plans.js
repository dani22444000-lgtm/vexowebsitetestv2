import {auth} from './firebase.js';
import {httpsCallable,getFunctions} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js';
import {onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';

const fn=getFunctions(undefined,'us-central1');
const buyPlan=httpsCallable(fn,'buySubscription');
const verifyPlan=httpsCallable(fn,'verifySubscriptionOrder');

let user=null,order=null,tonUI=null;

onAuthStateChanged(auth,u=>{
  user=u;
  if(u&&window.TON_CONNECT_UI){
    tonUI=new TON_CONNECT_UI.TonConnectUI({
      manifestUrl:'https://alirezarashidiking-debug.github.io/Vexo_2025/tonconnect-manifest.json',
      buttonRootId:'ton-connect-plans'
    });
  }
});

document.querySelectorAll('[data-plan]').forEach(b=>b.onclick=async()=>{
  if(!user){alert('Please sign in first.');return;}
  const plan=b.dataset.plan;
  if(!tonUI){alert('TON Connect not ready. Refresh the page.');return;}
  try{
    const r=(await buyPlan({plan})).data;
    order=r;
    const tx={
      validUntil:Math.floor(Date.now()/1000)+600,
      network:'-239',
      messages:[{address:r.receiver,amount:r.amountNano,payload:btoa(r.memo)}]
    };
    await tonUI.sendTransaction(tx);
    const v=(await verifyPlan({orderId:order.orderId})).data;
    alert(v.status==='paid'?`Plan ${plan} activated successfully!`:'Waiting for network confirmation...');
  }catch(e){
    alert(e.message||'Purchase failed.');
  }
});