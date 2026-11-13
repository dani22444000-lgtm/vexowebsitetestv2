import {auth} from './firebase.js';
import {httpsCallable,getFunctions} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js';
import {onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';

const fn=getFunctions(undefined,'us-central1');
const createExchange=httpsCallable(fn,'createExchangeRequest');
const listMyExchanges=httpsCallable(fn,'listMyExchangeRequests');
const getLimits=httpsCallable(fn,'getExchangeLimits');
const requestWithdrawal=httpsCallable(fn,'requestWithdrawal');
const listMyWithdrawals=httpsCallable(fn,'listMyWithdrawals');

const $=id=>document.getElementById(id);
let user=null, tonUI=null, walletAddress='';

const labels={pending:'Pending review',approved:'Approved',rejected:'Rejected',completed:'Completed'};
const withdrawLabels={review:'Awaiting review',approved:'Approved — awaiting transfer',rejecting:'Refund processing',rejected:'Rejected — refunded',paid:'Paid'};

// راه‌اندازی TON Connect
function initTon(){
  if(!window.TON_CONNECT_UI){
    $('walletState').textContent='TON Connect could not load. Refresh the page.';
    return;
  }
  try{
    tonUI=new TON_CONNECT_UI.TonConnectUI({
      manifestUrl:'https://alirezarashidiking-debug.github.io/Vexo_2025/tonconnect-manifest.json',
      buttonRootId:'ton-connect'
    });
    tonUI.onStatusChange(w=>{
      walletAddress=w?.account?.address||'';
      const chain=w?.account?.chain;
      if(chain&&chain!=='-239'){
        $('walletState').textContent='⚠️ Please switch your wallet to TON Mainnet.';
        $('walletAddress').textContent='';
        walletAddress='';
        return;
      }
      $('walletState').textContent=walletAddress?'✅ TON wallet connected (Mainnet)':'TON wallet not connected';
      $('walletAddress').textContent=walletAddress;
    });
  }catch(e){
    $('walletState').textContent='Wallet setup failed.';
    console.error(e);
  }
}

onAuthStateChanged(auth,async u=>{
  user=u;
  if(!u)return;
  initTon();
  loadLimits();
  loadExchangeHistory();
  loadWithdrawHistory();
});

// محدودیت‌ها
async function loadLimits(){
  try{
    const r=(await getLimits({})).data;
    $('currentPlan').textContent=r.plan||'Free';
    $('buyLimit').textContent=r.buyLimit===null?'Unlimited':r.buyLimit;
    $('sellLimit').textContent=r.sellLimit===null?'Unlimited':r.sellLimit;
    $('usedThisMonth').textContent=r.usedThisMonth||0;
  }catch(e){console.error(e);}
}

// تاریخچه Exchange
async function loadExchangeHistory(){
  try{
    const r=(await listMyExchanges({})).data;
    const box=$('exchangeList');
    const items=r.items||[];
    if(!items.length){box.textContent='No exchange requests yet.';return;}
    box.replaceChildren();
    for(const x of items){
      const div=document.createElement('div');
      div.className='req';
      div.innerHTML=`<div><strong>${x.action.toUpperCase()} ${x.amount} VEXO</strong><div class="fine">Status: ${labels[x.status]||x.status} · ${new Date(x.createdAt).toLocaleString()}</div></div><span class="status">${labels[x.status]||x.status}</span>`;
      box.append(div);
    }
  }catch(e){
    $('exchangeList').textContent=e.message||'Could not load history.';
  }
}

// تاریخچه Withdraw
async function loadWithdrawHistory(){
  try{
    const r=(await listMyWithdrawals({})).data;
    const box=$('withdrawHistory');
    const items=r.items||[];
    if(!items.length){box.textContent='No withdrawal requests yet.';return;}
    box.replaceChildren();
    for(const x of items){
      const div=document.createElement('div');
      div.className='req';
      div.innerHTML=`<div><strong>${x.amount} ${String(x.currency).toUpperCase()}</strong><div class="fine">Fee: ${x.fee||0} · Net: ${x.netAmount||x.amount}${x.txHash?' · Tx: '+x.txHash:''}</div></div><span class="status">${withdrawLabels[x.status]||x.status}</span>`;
      box.append(div);
    }
  }catch(e){
    $('withdrawHistory').textContent=e.message||'Could not load withdrawals.';
  }
}

// پیش‌نمایش کارمزد
$('withdrawAmount')?.addEventListener('input',()=>{
  const amount=Number($('withdrawAmount').value)||0;
  const currency=$('withdrawCurrency').value;
  const fee=currency==='gold'?Math.ceil(amount*0.05):0;
  const net=amount-fee;
  const el=$('feePreview');
  if(el)el.textContent=`Fee: ${fee} ${currency.toUpperCase()} · You receive: ${net} ${currency.toUpperCase()}`;
});

// فرم Exchange
$('exchangeForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!user){$('exchangeMessage').textContent='Sign in first.';return;}
  const action=$('action').value;
  const amount=Number($('exchangeAmount').value);
  const destination=$('exchangeDestination').value.trim();
  
  if(!Number.isSafeInteger(amount)||amount<=0){
    $('exchangeMessage').textContent='Enter a valid positive amount.';
    return;
  }
  if(action==='sell'&&!destination){
    $('exchangeMessage').textContent='TON wallet address is required for selling.';
    return;
  }
  
  const btn=$('submitExchange');
  btn.disabled=true;
  $('exchangeMessage').textContent='Submitting…';
  
  try{
    const r=(await createExchange({action,amount,destination})).data;
    $('exchangeMessage').textContent=`Request ${r.requestId} submitted. Status: ${r.status}.`;
    $('exchangeAmount').value='';
    $('exchangeDestination').value='';
    await loadExchangeHistory();
    await loadLimits();
  }catch(e){
    $('exchangeMessage').textContent=e.message||'Request failed.';
  }finally{
    btn.disabled=false;
  }
});

// فرم Withdraw
$('withdrawForm').addEventListener('submit',async e=>{
  e.preventDefault();
  if(!user){$('withdrawMessage').textContent='Sign in first.';return;}
  if(!walletAddress){
    $('withdrawMessage').textContent='Connect your TON wallet first.';
    return;
  }
  const amount=Number($('withdrawAmount').value);
  const currency=$('withdrawCurrency').value;
  
  if(!Number.isSafeInteger(amount)||amount<=0){
    $('withdrawMessage').textContent='Enter a positive whole-number amount.';
    return;
  }
  
  const btn=$('submitWithdraw');
  btn.disabled=true;
  $('withdrawMessage').textContent='Submitting…';
  
  try{
    const r=(await requestWithdrawal({amount,currency,destination:walletAddress})).data;
    $('withdrawMessage').textContent=`Request ${r.requestId} submitted. Fee: ${r.fee} ${currency.toUpperCase()}. Net: ${r.netAmount} ${currency.toUpperCase()}.`;
    $('withdrawAmount').value='';
    await loadWithdrawHistory();
  }catch(e){
    $('withdrawMessage').textContent=e.message||'Request failed.';
  }finally{
    btn.disabled=false;
  }
});

$('refreshWithdrawals')?.addEventListener('click',loadWithdrawHistory);