import{auth}from'./firebase.js';
import{onAuthStateChanged}from'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import{httpsCallable,getFunctions}from'https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js';

const $=id=>document.getElementById(id),fn=getFunctions(undefined,'us-central1'),call=n=>httpsCallable(fn,n);
let authorized=false;
const show=(id,v)=>{const e=$(id);if(e)e.textContent=v;};

onAuthStateChanged(auth,async u=>{
  if(!u)return;
  const token=await u.getIdTokenResult(true);
  authorized=token.claims.god===true;
  show('adminState',authorized?'GOD authorization verified.':'Access denied: verified GOD claim required.');
  if(!authorized)return;
  
  document.querySelectorAll('[data-admin-action]').forEach(b=>b.disabled=false);
  if($('refreshWithdrawals'))$('refreshWithdrawals').disabled=false;
  if($('refreshExchanges'))$('refreshExchanges').disabled=false;
  
  refreshWithdrawals();
  refreshExchanges();
  
  try{
    const s=(await call('adminDashboardStats')({})).data;
    show('adminStats',`${s.players} players · ${s.goldToday}/${s.cap} Gold earned today · ${s.pendingOrders} pending orders · ${s.pendingWithdrawals||0} pending withdrawals · ${s.banned} banned`);
  }catch(e){
    show('adminStats',e.message);
  }
});

// ⬇️ بخش مدیریت برداشت‌ها (Withdrawals)
const statusLabels={review:'Awaiting review',approved:'Approved — awaiting transfer',rejecting:'Refund processing',rejected:'Rejected — refunded',paid:'Paid'};

const refreshWithdrawals=async()=>{
  if(!authorized)return;
  const box=$('withdrawalList');
  box.textContent='Loading withdrawal requests…';
  try{
    const status=$('withdrawFilter')?.value||'all';
    const data=(await call('adminListWithdrawals')({status,limit:150})).data;
    box.replaceChildren();
    if(!data.items.length){box.textContent='No requests found for this filter.';return;}
    for(const item of data.items){
      const card=document.createElement('article');
      card.className='withdraw-row';
      const title=document.createElement('strong');
      title.textContent=`${item.amount} ${String(item.currency||'').toUpperCase()} · ${statusLabels[item.status]||item.status}`;
      const meta=document.createElement('div');
      meta.className='withdraw-meta';
      const fields=[['Request ID',item.id],['Player UID',item.uid],['TON destination',item.destination],['Created',item.createdAt?new Date(item.createdAt).toLocaleString():'—'],['Transaction hash',item.txHash||'Not recorded'],['Review note',item.reviewReason||'—']];
      for(const [k,v] of fields){
        const el=document.createElement('div');
        el.textContent=`${k}: ${v??'—'}`;
        meta.append(el);
      }
      card.append(title,meta);
      const actions=document.createElement('div');
      actions.className='admin-actions';
      if(item.status==='review'){
        const reason=document.createElement('input');
        reason.placeholder='Review reason (required)';
        reason.maxLength=300;
        reason.style.minWidth='220px';
        const approve=document.createElement('button');
        approve.className='btn primary';
        approve.textContent='Approve';
        approve.addEventListener('click',()=>reviewWithdrawal(item.id,'approve',reason.value));
        const reject=document.createElement('button');
        reject.className='btn danger';
        reject.textContent='Reject & refund';
        reject.addEventListener('click',()=>reviewWithdrawal(item.id,'reject',reason.value));
        actions.append(reason,approve,reject);
      }
      if(item.status==='approved'){
        const hash=document.createElement('input');
        hash.placeholder='TON transaction hash (after verifying on-chain)';
        hash.maxLength=160;
        hash.style.minWidth='260px';
        const note=document.createElement('input');
        note.placeholder='Optional payment note';
        note.maxLength=300;
        const paid=document.createElement('button');
        paid.className='btn primary';
        paid.textContent='Record payment';
        paid.addEventListener('click',()=>markWithdrawalPaid(item.id,hash.value,note.value));
        actions.append(hash,note,paid);
      }
      if(actions.childNodes.length)card.append(actions);
      box.append(card);
    }
  }catch(e){
    box.textContent=e.message||'Could not load withdrawals.';
  }
};

async function reviewWithdrawal(requestId,action,reason){
  if(!authorized)return;
  if(reason.trim().length<5){show('withdrawalMessage','Enter a review reason of at least 5 characters.');return;}
  if(action==='reject'&&!confirm('Reject this withdrawal and return the reserved amount to the user?'))return;
  try{
    const r=(await call('adminReviewWithdrawal')({requestId,action,reason:reason.trim()})).data;
    show('withdrawalMessage',`Request ${r.status}.`);
    await refreshWithdrawals();
  }catch(e){
    show('withdrawalMessage',e.message||'Review failed.');
  }
}

async function markWithdrawalPaid(requestId,txHash,note){
  if(!authorized)return;
  if(!confirm('Confirm that you have independently verified this exact transfer on TON Explorer and it reached the requested destination?'))return;
  try{
    const r=(await call('adminMarkWithdrawalPaid')({requestId,txHash:txHash.trim(),note:note.trim()})).data;
    show('withdrawalMessage',`Payment recorded. Transaction: ${r.txHash}`);
    await refreshWithdrawals();
  }catch(e){
    show('withdrawalMessage',e.message||'Could not record payment.');
  }
}

$('refreshWithdrawals')?.addEventListener('click',refreshWithdrawals);
$('withdrawFilter')?.addEventListener('change',refreshWithdrawals);

// ⬇️ بخش مدیریت خرید و فروش (Exchange)
const exchangeLabels={pending:'Pending review',approved:'Approved',rejected:'Rejected',completed:'Completed'};

const refreshExchanges=async()=>{
  if(!authorized)return;
  const box=$('exchangeAdminList');
  box.textContent='Loading exchange requests…';
  try{
    const status=$('exchangeFilter')?.value||'all';
    const data=(await call('adminListExchanges')({status,limit:150})).data;
    box.replaceChildren();
    if(!data.items.length){box.textContent='No exchange requests found.';return;}
    for(const item of data.items){
      const card=document.createElement('article');
      card.className='withdraw-row';
      const title=document.createElement('strong');
      title.textContent=`${item.action.toUpperCase()} ${item.amount} VEXO · ${exchangeLabels[item.status]||item.status}`;
      const meta=document.createElement('div');
      meta.className='withdraw-meta';
      const fields=[['Request ID',item.id],['Player UID',item.uid],['Destination',item.destination||'—'],['Created',item.createdAt?new Date(item.createdAt).toLocaleString():'—']];
      for(const [k,v] of fields){
        const el=document.createElement('div');
        el.textContent=`${k}: ${v??'—'}`;
        meta.append(el);
      }
      card.append(title,meta);
      const actions=document.createElement('div');
      actions.className='admin-actions';
      if(item.status==='pending'){
        const reason=document.createElement('input');
        reason.placeholder='Reason (required)';
        reason.maxLength=300;
        reason.style.minWidth='220px';
        const approve=document.createElement('button');
        approve.className='btn primary';
        approve.textContent='Approve';
        approve.addEventListener('click',()=>reviewExchange(item.id,'approve',reason.value));
        const reject=document.createElement('button');
        reject.className='btn danger';
        reject.textContent='Reject';
        reject.addEventListener('click',()=>reviewExchange(item.id,'reject',reason.value));
        actions.append(reason,approve,reject);
      }
      if(item.status==='approved'&&item.action==='sell'){
        const txHash=document.createElement('input');
        txHash.placeholder='TON tx hash (after transfer)';
        txHash.maxLength=160;
        txHash.style.minWidth='260px';
        const complete=document.createElement('button');
        complete.className='btn primary';
        complete.textContent='Mark completed';
        complete.addEventListener('click',()=>completeExchange(item.id,txHash.value));
        actions.append(txHash,complete);
      }
      if(item.status==='approved'&&item.action==='buy'){
        const complete=document.createElement('button');
        complete.className='btn primary';
        complete.textContent='Complete Buy (Credit VEXO)';
        complete.addEventListener('click',()=>completeExchange(item.id,''));
        actions.append(complete);
      }
      if(actions.childNodes.length)card.append(actions);
      box.append(card);
    }
  }catch(e){
    box.textContent=e.message||'Could not load exchanges.';
  }
};

async function reviewExchange(requestId,action,reason){
  if(!authorized)return;
  if(reason.trim().length<5){show('exchangeAdminMessage','Enter a reason (5+ chars).');return;}
  if(!confirm(`${action.toUpperCase()} this exchange request?`))return;
  try{
    await call('adminReviewExchange')({requestId,action,reason:reason.trim()});
    show('exchangeAdminMessage',`Exchange ${action}d.`);
    await refreshExchanges();
  }catch(e){
    show('exchangeAdminMessage',e.message||'Action failed.');
  }
}

async function completeExchange(requestId,txHash){
  if(!authorized)return;
  if(txHash && txHash.trim().length<20){show('exchangeAdminMessage','Enter a valid TON tx hash.');return;}
  if(!confirm('Confirm this exchange is completed?'))return;
  try{
    await call('adminCompleteExchange')({requestId,txHash:txHash?txHash.trim():''});
    show('exchangeAdminMessage','Exchange completed.');
    await refreshExchanges();
  }catch(e){
    show('exchangeAdminMessage',e.message||'Completion failed.');
  }
}

$('refreshExchanges')?.addEventListener('click',refreshExchanges);
$('exchangeFilter')?.addEventListener('change',refreshExchanges);

// ⬇️ بخش جستجوی بازیکن و تنظیمات
$('findPlayer')?.addEventListener('click',async()=>{if(!authorized)return;try{const r=(await call('adminFindPlayer')({playerId:$('playerId').value.trim()})).data;$('playerResult').textContent=r.found?JSON.stringify(r,null,2):'Player not found.';}catch(e){$('playerResult').textContent=e.message;}});
$('adjustWallet')?.addEventListener('click',async()=>{if(!authorized)return;try{const r=(await call('adminAdjustWallet')({playerId:$('adjustPlayerId').value.trim(),currency:$('currency').value,amount:Number($('amount').value),reason:$('reason').value.trim()})).data;$('walletResult').textContent='Wallet updated: '+JSON.stringify(r.wallet);}catch(e){$('walletResult').textContent=e.message;}});
$('banPlayer')?.addEventListener('click',async()=>{if(!authorized)return;try{await call('adminSetBan')({playerId:$('banPlayerId').value.trim(),banned:$('banAction').value==='ban',reason:$('banReason').value.trim()});$('banResult').textContent='Account action saved and audited.';}catch(e){$('banResult').textContent=e.message;}});
$('saveEconomy')?.addEventListener('click',async()=>{if(!authorized)return;try{const r=(await call('adminSetEconomy')({dailyGoldCap:Number($('dailyGoldCap').value)})).data;$('economyResult').textContent=`Daily Gold cap saved: ${r.dailyGoldCap}`;}catch(e){$('economyResult').textContent=e.message;}});
$('loadAudit')?.addEventListener('click',async()=>{if(!authorized)return;try{const r=(await call('adminGetAudit')({})).data;$('auditResult').textContent=JSON.stringify(Object.values(r.entries).reverse().slice(0,50),null,2);}catch(e){$('auditResult').textContent=e.message;}});
