const {onCall,HttpsError} = require('firebase-functions/v2/https');
const {onRequest} = require('firebase-functions/v2/https');
const {initializeApp} = require('firebase-admin/app');
const {getDatabase,ServerValue} = require('firebase-admin/database');
const {getAuth} = require('firebase-admin/auth');
const crypto = require('crypto');
initializeApp();
const db = getDatabase();
const REGION = 'us-central1';
const OWNER_EMAIL = 'alireza.rashidi.king@gmail.com';
const DAY_CAP = 100;
const MOVES = ['rock','paper','scissors'];
const clean = (v,n=120) => String(v ?? '').trim().slice(0,n);
const dayKey = () => new Date().toISOString().slice(0,10);
function needAuth(req){if(!req.auth)throw new HttpsError('unauthenticated','Please sign in.');return req.auth.uid;}
function needGod(req){const uid=needAuth(req);if(req.auth.token.god!==true)throw new HttpsError('permission-denied','Verified GOD permission required.');return uid;}
function outcome(a,b){if(a===b)return 'draw';if((a==='rock'&&b==='scissors')||(a==='paper'&&b==='rock')||(a==='scissors'&&b==='paper'))return 'win';return 'loss';}
async function audit(uid,action,target,details={}){await db.ref('adminAudit').push({by:uid,action,target,details,createdAt:ServerValue.TIMESTAMP});}
async function newPlayerId(uid){const index=db.ref('playerIdIndex');for(let i=0;i<12;i++){const id=String(1000000000+crypto.randomInt(0,9000000000));let accepted=false;const tx=await index.child(id).transaction(v=>{if(v===null){accepted=true;return uid;}return;});if(tx.committed&&accepted)return id;}throw new HttpsError('resource-exhausted','Could not allocate player ID. Try again.');}
async function ensureProfile(uid,token){const pRef=db.ref(`profiles/${uid}`);const snap=await pRef.get();if(snap.exists()&&snap.val().playerId)return snap.val();const playerId=await newPlayerId(uid);const p={playerId,displayName:clean(token.name||token.email?.split('@')[0]||'Player',24),email:clean(token.email,160),createdAt:ServerValue.TIMESTAMP,updatedAt:ServerValue.TIMESTAMP};const updates={};updates[`profiles/${uid}`]=p;updates[`publicProfiles/${uid}`]={playerId,displayName:p.displayName};updates[`wallets/${uid}`]={gold:0,silver:0,bronze:0,vxb:0,updatedAt:ServerValue.TIMESTAMP};updates[`playerStats/${uid}`]={wins:0,losses:0,draws:0,rounds:0};await db.ref().update(updates);return p;}
async function getProfile(uid,token){let s=await db.ref(`profiles/${uid}`).get();if(!s.exists()||!s.val().playerId)return ensureProfile(uid,token);return s.val();}
async function assertNotBanned(uid){const s=await db.ref(`bans/${uid}`).get();if(s.exists()&&s.val()?.banned)throw new HttpsError('permission-denied','This account is restricted. Contact VEXO support.');}
async function walletChange(uid,delta,meta){const wref=db.ref(`wallets/${uid}`);let after;const tx=await wref.transaction(w=>{w=w||{gold:0,silver:0,bronze:0,vxb:0};for(const k of ['gold','silver','bronze','vxb']){const next=(Number(w[k])||0)+(Number(delta[k])||0);if(next<0){if(meta?.type==='bot-match')w[k]=0;else return;}else w[k]=next;}w.updatedAt=ServerValue.TIMESTAMP;after={...w};return w;});if(!tx.committed)throw new HttpsError('failed-precondition','Insufficient balance or wallet conflict.');await db.ref(`transactions/${uid}`).push({...meta,delta,balances:after,createdAt:ServerValue.TIMESTAMP});return after;}

async function settleWalletOnce(uid,key,amount,meta){const wref=db.ref(`wallets/${uid}`);let applied=false,after;const tx=await wref.transaction(w=>{w=w||{gold:0,silver:0,bronze:0,vxb:0};w._settled=w._settled||{};if(w._settled[key]){after=w;return w;}const next=(Number(w.vxb)||0)+amount;w.vxb=Math.max(0,next);w._settled[key]=true;const keys=Object.keys(w._settled);if(keys.length>300)delete w._settled[keys[0]];w.updatedAt=ServerValue.TIMESTAMP;after=w;applied=true;return w;});if(!tx.committed)throw new HttpsError('aborted','Wallet settlement conflict.');if(applied)await db.ref(`transactions/${uid}`).push({...meta,delta:{gold:0,silver:0,bronze:0,vxb:amount},createdAt:ServerValue.TIMESTAMP});return after;}


const VIP_PLANS = {
  free: {priceUsd:0, dailyGames:75},
  silver: {priceUsd:20, dailyGames:300},
  gold: {priceUsd:50, dailyGames:700},
  god: {priceUsd:100, dailyGames:null}
};
exports.getSubscriptionPlans = onCall({region:REGION}, async req=>{
  const uid=needAuth(req);
  const sub=(await db.ref(`subscriptions/${uid}`).get()).val()||{plan:'free',status:'active'};
  return {plans:VIP_PLANS, subscription:sub};
});
exports.adminSetSubscription = onCall({region:REGION}, async req=>{
  const admin=needGod(req), id=clean(req.data?.playerId,10), plan=clean(req.data?.plan,12);
  if(!/^\\d{10}$/.test(id)||!VIP_PLANS[plan]||plan==='free')throw new HttpsError('invalid-argument','Valid player ID and paid plan required.');
  const idx=await db.ref(`playerIdIndex/${id}`).get(); if(!idx.exists())throw new HttpsError('not-found','Player not found.');
  const uid=idx.val(), months=Math.max(1,Math.min(12,Number(req.data?.months)||1));
  const now=Date.now(), old=(await db.ref(`subscriptions/${uid}`).get()).val()||{};
  const start=Math.max(now,Number(old.expiresAt)||0), expiresAt=start+months*30*86400000;
  await db.ref(`subscriptions/${uid}`).set({plan,status:'active',priceUsd:VIP_PLANS[plan].priceUsd,startedAt:old.startedAt||now,expiresAt,months,updatedBy:admin,updatedAt:ServerValue.TIMESTAMP});
  await audit(admin,'subscription-set',uid,{plan,months,expiresAt}); return {ok:true,expiresAt};
});
exports.listMyWithdrawals = onCall({region:REGION},async req=>{const uid=needAuth(req);const s=await db.ref('withdrawalRequests').orderByChild('uid').equalTo(uid).limitToLast(50).get();const items=[];s.forEach(x=>items.push({id:x.key,...x.val()}));items.sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0));return{items};});
exports.listMyTransactions = onCall({region:REGION},async req=>{const uid=needAuth(req);const s=await db.ref(`transactions/${uid}`).limitToLast(100).get();const items=[];s.forEach(x=>items.push({id:x.key,...x.val()}));items.sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0));return{items};});

exports.requestWithdrawal = onCall({region:REGION},async req=>{
  const uid=needAuth(req); await assertNotBanned(uid);
  const amount=Number(req.data?.amount), currency=clean(req.data?.currency,8);
  const destination=clean(req.data?.destination,128);
  const tonAddress=/^(?:EQ|UQ)[A-Za-z0-9_-]{46}$|^0:[0-9a-fA-F]{64}$/.test(destination);
  if(!['gold','silver','bronze','vxb'].includes(currency)||!Number.isSafeInteger(amount)||amount<=0||amount>1000000000)
    throw new HttpsError('invalid-argument','Enter a valid positive integer amount.');
  if(!tonAddress) throw new HttpsError('invalid-argument','Connect a valid TON wallet before requesting a withdrawal.');
  const wref=db.ref(`wallets/${uid}`); let reserved=false;
  const tx=await wref.transaction(w=>{if(!w)return;const balance=Number(w[currency]||0);if(balance<amount)return;w[currency]=balance-amount;w.updatedAt=ServerValue.TIMESTAMP;reserved=true;return w;});
  if(!tx.committed||!reserved)throw new HttpsError('failed-precondition','Insufficient balance.');
  const id=crypto.randomBytes(12).toString('hex');
  try {
    await db.ref(`withdrawalRequests/${id}`).set({uid,amount,currency,destination,status:'review',createdAt:ServerValue.TIMESTAMP,updatedAt:ServerValue.TIMESTAMP,notice:'Balance reserved; no TON has been transferred.'});
    await db.ref(`transactions/${uid}`).push({type:'withdrawal-request',requestId:id,amount,currency,destination,status:'review',createdAt:ServerValue.TIMESTAMP});
  } catch(e) {
    await wref.transaction(w=>{if(!w)return w;w[currency]=(Number(w[currency])||0)+amount;w.updatedAt=ServerValue.TIMESTAMP;return w;});
    await db.ref(`withdrawalRequests/${id}`).remove(); throw new HttpsError('internal','Could not create request; reserved balance was restored.');
  }
  return {ok:true,requestId:id,status:'review',message:'Request submitted. The amount is reserved and no TON is transferred yet.'};
});

exports.ensurePlayer = onCall({region:REGION},async req=>{
  const uid=needAuth(req);
  const requestedName=clean(req.data?.displayName,24);
  if(req.data?.displayName!==undefined && requestedName.length<3)
    throw new HttpsError('invalid-argument','Display name must contain at least 3 characters.');
  let p=await getProfile(uid,req.auth.token);
  if(requestedName && p.displayName!==requestedName){
    await db.ref(`profiles/${uid}`).update({displayName:requestedName,updatedAt:ServerValue.TIMESTAMP});
    await db.ref(`publicProfiles/${uid}`).update({displayName:requestedName});
    p={...p,displayName:requestedName};
  }
  const w=(await db.ref(`wallets/${uid}`).get()).val()||{gold:0,silver:0,bronze:0,vxb:0};
  return{profile:p,wallet:w};
});
exports.updatePlayerProfile = onCall({region:REGION},async req=>{const uid=needAuth(req);const name=clean(req.data?.displayName,24);if(name.length<3)throw new HttpsError('invalid-argument','Display name must contain at least 3 characters.');const p=await getProfile(uid,req.auth.token);await db.ref(`profiles/${uid}`).update({displayName:name,updatedAt:ServerValue.TIMESTAMP});await db.ref(`publicProfiles/${uid}`).update({displayName:name});return{ok:true,playerId:p.playerId,displayName:name};});
exports.playBotMatch = onCall({region:REGION,maxInstances:30},async req=>{const uid=needAuth(req);await assertNotBanned(uid);if(!MOVES.includes(req.data?.move))throw new HttpsError('invalid-argument','Invalid move.');const p=await getProfile(uid,req.auth.token);const bot=MOVES[crypto.randomInt(0,3)],result=outcome(req.data.move,bot),day=dayKey();const statsRef=db.ref(`gameState/${uid}/${day}`);let daily;
const [subSnap,levelSnap]=await Promise.all([db.ref(`subscriptions/${uid}`).get(),db.ref(`playerLevels/${uid}`).get()]);
const sub=subSnap.val()||{plan:'free'}, level=Math.max(1,Number(levelSnap.val()?.level)||1);
const active= sub.status==='active' && Number(sub.expiresAt||0)>Date.now();
const plan=active?(VIP_PLANS[sub.plan]?sub.plan:'free'):'free';
const quota=plan==='god'?Infinity:(plan==='free'?75+(level-1):VIP_PLANS[plan].dailyGames);
const tx=await statsRef.transaction(st=>{st=st||{goldEarned:0,rounds:0};if((st.rounds||0)>=quota)return;st.rounds++;daily=st;return st;});
if(!tx.committed)throw new HttpsError('resource-exhausted','Daily match limit reached for your plan.');let delta={gold:0,silver:0,bronze:0,vxb:0};if(result==='win')delta.vxb=20;if(result==='loss')delta.vxb=-5;const wallet=await walletChange(uid,delta,{type:'bot-match',result,move:req.data.move,opponentMove:bot});await db.ref(`matches/${uid}`).push({mode:'bot',move:req.data.move,opponentMove:bot,result,createdAt:ServerValue.TIMESTAMP});await db.ref(`playerStats/${uid}`).transaction(s=>{s=s||{wins:0,losses:0,draws:0,rounds:0};s.rounds++;s[result==='win'?'wins':result==='loss'?'losses':'draws']++;return s;});return{result,opponentMove:bot,wallet,playerId:p.playerId,reward:delta.vxb};});
exports.createPrivateRoom = onCall({region:REGION},async req=>{const uid=needAuth(req);await assertNotBanned(uid);await getProfile(uid,req.auth.token);const code=crypto.randomBytes(4).toString('hex').toUpperCase();const room={code,status:'waiting',host:uid,players:{[uid]:{joinedAt:ServerValue.TIMESTAMP}},createdAt:ServerValue.TIMESTAMP,round:0,moves:{}};await db.ref(`rooms/${code}`).set(room);await db.ref(`userRooms/${uid}`).set(code);return{code};});
exports.joinPrivateRoom = onCall({region:REGION},async req=>{const uid=needAuth(req);await assertNotBanned(uid);await getProfile(uid,req.auth.token);const code=clean(req.data?.code,8).toUpperCase();if(!/^[A-F0-9]{8}$/.test(code))throw new HttpsError('invalid-argument','Invalid room code.');let error;const tx=await db.ref(`rooms/${code}`).transaction(r=>{if(!r||r.status!=='waiting'||r.players?.[uid]||Object.keys(r.players||{}).length>=2){error=true;return;}r.players=r.players||{};r.players[uid]={joinedAt:Date.now()};r.status='playing';return r;});if(!tx.committed||error)throw new HttpsError('failed-precondition','Room is unavailable or full.');await db.ref(`userRooms/${uid}`).set(code);return{code,status:'playing'};});
exports.joinRandomMatch = onCall({region:REGION},async req=>{const uid=needAuth(req);await assertNotBanned(uid);await getProfile(uid,req.auth.token);const qref=db.ref('matchQueue');let found=null;const tx=await qref.transaction(q=>{q=q||{};for(const [other,v] of Object.entries(q)){if(other!==uid&&v&&Date.now()-v.at<90000){found=other;delete q[other];return q;}}q[uid]={at:Date.now()};return q;});if(!tx.committed)throw new HttpsError('aborted','Queue busy; retry.');if(found){const code=crypto.randomBytes(4).toString('hex').toUpperCase();await db.ref(`rooms/${code}`).set({code,status:'playing',host:found,players:{[found]:{joinedAt:ServerValue.TIMESTAMP},[uid]:{joinedAt:ServerValue.TIMESTAMP}},round:0,moves:{},createdAt:ServerValue.TIMESTAMP});await db.ref(`userRooms/${found}`).set(code);await db.ref(`userRooms/${uid}`).set(code);return{status:'matched',code,opponent:found};}return{status:'queued'};});
exports.leaveMatchQueue = onCall({region:REGION},async req=>{const uid=needAuth(req);await db.ref(`matchQueue/${uid}`).remove();return{ok:true};});
exports.submitMultiplayerMove = onCall({region:REGION},async req=>{const uid=needAuth(req);await assertNotBanned(uid);const code=clean(req.data?.code,8).toUpperCase(),move=req.data?.move;if(!MOVES.includes(move))throw new HttpsError('invalid-argument','Invalid move.');let resolved=null;const roomRef=db.ref(`rooms/${code}`);const tx=await roomRef.transaction(r=>{if(!r||r.status!=='playing'||!r.players?.[uid]||r.result?.[r.round])return;const round=String(r.round||0);r.moves=r.moves||{};r.moves[round]=r.moves[round]||{};if(r.moves[round][uid])return;r.moves[round][uid]=move;const ids=Object.keys(r.players);if(ids.length===2&&ids.every(id=>r.moves[round][id])){const a=ids[0],b=ids[1],res=outcome(r.moves[round][a],r.moves[round][b]);r.lastResult={round,players:{[a]:{move:r.moves[round][a],result:res==='win'?'win':res==='loss'?'loss':'draw'},[b]:{move:r.moves[round][b],result:res==='win'?'loss':res==='loss'?'win':'draw'}},at:Date.now()};r.round=(r.round||0)+1;resolved={a,b,result:res,round};}return r;});if(!tx.committed)throw new HttpsError('failed-precondition','Move already submitted or room unavailable.');if(resolved){const settleRef=db.ref(`roomSettlements/${code}/${resolved.round}`);const st=await settleRef.transaction(v=>v||{status:'pending',at:Date.now()});if(st.committed&&st.snapshot.val().status==='pending'){const {a,b,result,round}=resolved;const ar=result==='win'?'win':result==='loss'?'loss':'draw',br=result==='win'?'loss':result==='loss'?'win':'draw';await Promise.all([settleWalletOnce(a,`mp-${code}-${round}`,ar==='win'?20:ar==='loss'?-5:0,{type:'multiplayer-match',room:code,result:ar}),settleWalletOnce(b,`mp-${code}-${round}`,br==='win'?20:br==='loss'?-5:0,{type:'multiplayer-match',room:code,result:br})]);await settleRef.update({status:'settled'});}}return{ok:true,room:(await roomRef.get()).val()};});
exports.getMyRoom = onCall({region:REGION},async req=>{const uid=needAuth(req);const s=await db.ref(`userRooms/${uid}`).get();if(!s.exists())return{room:null};const r=await db.ref(`rooms/${s.val()}`).get();return{room:r.val()};});
exports.leaveRoom = onCall({region:REGION},async req=>{const uid=needAuth(req);const s=await db.ref(`userRooms/${uid}`).get();if(s.exists()){const code=s.val();await db.ref(`rooms/${code}/players/${uid}`).remove();await db.ref(`userRooms/${uid}`).remove();await db.ref(`rooms/${code}`).update({status:'closed',closedAt:ServerValue.TIMESTAMP});}return{ok:true};});
exports.adminFindPlayer = onCall({region:REGION},async req=>{const admin=needGod(req);const id=clean(req.data?.playerId,10);if(!/^\d{10}$/.test(id))throw new HttpsError('invalid-argument','Enter a 10-digit player ID.');const s=await db.ref(`playerIdIndex/${id}`).get();if(!s.exists())return{found:false};const uid=s.val();const [p,w,stats,tx,matches]=await Promise.all([db.ref(`profiles/${uid}`).get(),db.ref(`wallets/${uid}`).get(),db.ref(`playerStats/${uid}`).get(),db.ref(`transactions/${uid}`).limitToLast(20).get(),db.ref(`matches/${uid}`).limitToLast(20).get()]);return{found:true,uid,profile:p.val(),wallet:w.val(),stats:stats.val(),transactions:tx.val(),matches:matches.val(),ban:(await db.ref(`bans/${uid}`).get()).val()||null};});
exports.adminAdjustWallet = onCall({region:REGION},async req=>{const admin=needGod(req);const id=clean(req.data?.playerId,10),currency=clean(req.data?.currency,8),amount=Number(req.data?.amount),reason=clean(req.data?.reason,300);if(!/^\d{10}$/.test(id)||!['gold','silver','bronze','vxb'].includes(currency)||!Number.isSafeInteger(amount)||amount===0||Math.abs(amount)>1000000000||reason.length<5)throw new HttpsError('invalid-argument','Valid player ID, currency, integer amount and reason (5+ chars) required.');const idx=await db.ref(`playerIdIndex/${id}`).get();if(!idx.exists())throw new HttpsError('not-found','Player not found.');const uid=idx.val(),delta={gold:0,silver:0,bronze:0,vxb:0};delta[currency]=amount;const wallet=await walletChange(uid,delta,{type:'admin-adjustment',by:admin,reason});await audit(admin,'wallet-adjustment',uid,{playerId:id,currency,amount,reason});return{ok:true,wallet};});
exports.adminSetBan = onCall({region:REGION},async req=>{const admin=needGod(req);const id=clean(req.data?.playerId,10),reason=clean(req.data?.reason,300),banned=!!req.data?.banned;if(!/^\d{10}$/.test(id)||reason.length<5)throw new HttpsError('invalid-argument','Player ID and reason required.');const s=await db.ref(`playerIdIndex/${id}`).get();if(!s.exists())throw new HttpsError('not-found','Player not found.');const uid=s.val();if(banned)await db.ref(`bans/${uid}`).set({banned:true,reason,by:admin,at:ServerValue.TIMESTAMP});else await db.ref(`bans/${uid}`).remove();await audit(admin,banned?'ban-player':'unban-player',uid,{reason});return{ok:true};});
exports.adminDashboardStats = onCall({region:REGION},async req=>{needGod(req);const [profiles,wallets,orders,bans,economy]=await Promise.all([db.ref('profiles').get(),db.ref('wallets').get(),db.ref('paymentOrders').get(),db.ref('bans').get(),db.ref('economy/public').get()]);let goldToday=0;const day=dayKey();const gs=await db.ref('gameState').get();gs.forEach(u=>{goldToday+=Number(u.child(day).child('goldEarned').val()||0)});const withdrawals=(await db.ref('withdrawalRequests').get()).val()||{};return{players:profiles.numChildren(),goldToday,cap:Number(economy.val()?.dailyGoldCap??DAY_CAP),pendingOrders:Object.values(orders.val()||{}).filter(x=>x.status==='pending').length,pendingWithdrawals:Object.values(withdrawals).filter(x=>x.status==='review'||x.status==='approved'||x.status==='rejecting').length,banned:bans.numChildren()};});

exports.adminSetEconomy = onCall({region:REGION},async req=>{const admin=needGod(req);const cap=Number(req.data?.dailyGoldCap);if(!Number.isInteger(cap)||cap<0||cap>1000)throw new HttpsError('invalid-argument','Daily Gold cap must be an integer from 0 to 1000.');await db.ref('economy/public').update({dailyGoldCap:cap,updatedAt:ServerValue.TIMESTAMP,updatedBy:admin});await audit(admin,'economy-settings','public',{dailyGoldCap:cap});return{ok:true,dailyGoldCap:cap};});

exports.updateSiteSettings = onCall({region:REGION},async req=>{const admin=needGod(req),d=req.data||{},channels=Array.isArray(d.channels)?d.channels.slice(0,4).map(c=>({name:clean(c.name,32),url:clean(c.url,300)})):[];for(const c of channels)if(c.url&&!/^https:\/\//i.test(c.url))throw new HttpsError('invalid-argument','Channel URLs must use HTTPS.');await db.ref('siteSettings/public').set({ads:{top:clean(d.ads?.top,1200),footer:clean(d.ads?.footer,1200)},channels,updatedAt:ServerValue.TIMESTAMP,updatedBy:admin});await audit(admin,'site-settings','public',{});return{ok:true};});
exports.createTonTestOrder = onCall({region:REGION},async req=>{const uid=needAuth(req);await assertNotBanned(uid);const pkg=req.data?.package;if(!['starter','boost','vault'].includes(pkg))throw new HttpsError('invalid-argument','Unknown package.');const receiver=process.env.VEXO_TON_TESTNET_RECEIVER;if(!receiver)throw new HttpsError('failed-precondition','Set VEXO_TON_TESTNET_RECEIVER before enabling testnet checkout.');const packages={starter:{gold:1,nano:100000000},boost:{gold:5,nano:500000000},vault:{gold:10,nano:1000000000}};const p=packages[pkg],id=crypto.randomBytes(12).toString('hex'),memo=`VEXO:${id}`;await db.ref(`paymentOrders/${id}`).set({uid,package:pkg,gold:p.gold,network:'ton-testnet',receiver,amountNano:String(p.nano),memo,status:'pending',createdAt:ServerValue.TIMESTAMP});return{orderId:id,receiver,amountNano:String(p.nano),memo,network:'TON Testnet',status:'pending'};});
exports.verifyTonTestOrder = onCall({region:REGION,timeoutSeconds:60},async req=>{const uid=needAuth(req);await assertNotBanned(uid);const id=clean(req.data?.orderId,40);const ref=db.ref(`paymentOrders/${id}`),s=await ref.get();if(!s.exists()||s.val().uid!==uid)throw new HttpsError('not-found','Order not found.');const order=s.val();if(order.status==='paid')return{ok:true,status:'paid'};const receiver=process.env.VEXO_TON_TESTNET_RECEIVER,key=process.env.TONCENTER_TESTNET_API_KEY;if(!receiver||!key)throw new HttpsError('failed-precondition','TON testnet verification secrets are not configured.');const url=`https://testnet.toncenter.com/api/v2/getTransactions?address=${encodeURIComponent(receiver)}&limit=100&archival=true`;const response=await fetch(url,{headers:{'X-API-Key':key}});if(!response.ok)throw new HttpsError('unavailable','TON testnet explorer unavailable.');const data=await response.json();const match=(data.result||[]).find(t=>{const m=t.in_msg||{};const text=m.message||m.msg_data?.text||'';return m.destination===receiver&&String(m.value)===order.amountNano&&text.includes(order.memo);});if(!match) return{ok:false,status:'pending',message:'No matching confirmed testnet transfer found yet.'};const lock=await db.ref(`paymentTxIndex/${match.transaction_id?.hash||match.transaction_id||id}`).transaction(v=>v||id);if(!lock.committed)throw new HttpsError('already-exists','Transaction already used.');await ref.update({status:'paid',txHash:match.transaction_id?.hash||String(match.transaction_id||''),paidAt:ServerValue.TIMESTAMP});await walletChange(uid,{gold:order.gold,silver:0,bronze:0,vxb:0},{type:'ton-testnet-purchase',orderId:id,txHash:match.transaction_id?.hash||''});return{ok:true,status:'paid',gold:order.gold};});


// Withdrawal operations are callable only by a verified GOD custom claim.
exports.adminListWithdrawals = onCall({region:REGION},async req=>{
  needGod(req);
  const status=clean(req.data?.status,16), limit=Math.max(1,Math.min(200,Number(req.data?.limit)||100));
  const snap=await db.ref('withdrawalRequests').limitToLast(500).get();
  const items=[]; snap.forEach(x=>{const v=x.val()||{};if(!status||status==='all'||v.status===status)items.push({id:x.key,...v});});
  items.sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0));
  return {items:items.slice(0,limit),total:items.length};
});
exports.adminReviewWithdrawal = onCall({region:REGION},async req=>{
  const admin=needGod(req), id=clean(req.data?.requestId,64), action=clean(req.data?.action,12), reason=clean(req.data?.reason,300);
  if(!/^[a-f0-9]{24}$/.test(id)||!['approve','reject'].includes(action)||reason.length<5)
    throw new HttpsError('invalid-argument','Request ID, action and a reason of at least 5 characters are required.');
  const ref=db.ref(`withdrawalRequests/${id}`); let previous;
  const tx=await ref.transaction(v=>{if(!v)return;if(action==='reject'&&v.status==='rejecting'){v.updatedAt=ServerValue.TIMESTAMP;return v;}if(v.status!=='review')return;previous=v;v.status=action==='approve'?'approved':'rejecting';v.reviewedBy=admin;v.reviewReason=reason;v.reviewedAt=Date.now();v.updatedAt=ServerValue.TIMESTAMP;return v;});
  if(!tx.committed)throw new HttpsError('failed-precondition','Request is no longer awaiting review.');
  const item=tx.snapshot.val();
  if(action==='reject'){
    const wref=db.ref(`wallets/${item.uid}`);let refunded=false;
    const refund=await wref.transaction(w=>{w=w||{gold:0,silver:0,bronze:0,vxb:0};w._withdrawalRefunds=w._withdrawalRefunds||{};if(w._withdrawalRefunds[id])return w;w[item.currency]=(Number(w[item.currency])||0)+Number(item.amount);w._withdrawalRefunds[id]=true;w.updatedAt=ServerValue.TIMESTAMP;refunded=true;return w;});
    if(!refund.committed)throw new HttpsError('aborted','Refund could not be completed; retry support review.');
    if(refunded)await db.ref(`transactions/${item.uid}`).push({type:'withdrawal-refund',requestId:id,amount:item.amount,currency:item.currency,reason,createdAt:ServerValue.TIMESTAMP});
    await ref.update({status:'rejected',refunded:true,updatedAt:ServerValue.TIMESTAMP});
  } else { await ref.update({updatedAt:ServerValue.TIMESTAMP}); }
  await audit(admin,`withdrawal-${action}`,item.uid,{requestId:id,amount:item.amount,currency:item.currency,reason});
  return {ok:true,status:action==='approve'?'approved':'rejected'};
});
exports.adminMarkWithdrawalPaid = onCall({region:REGION},async req=>{
  const admin=needGod(req), id=clean(req.data?.requestId,64), txHash=clean(req.data?.txHash,160), note=clean(req.data?.note,300);
  if(!/^[a-f0-9]{24}$/.test(id)||txHash.length<20||!/^[A-Za-z0-9_+=-]+$/.test(txHash))
    throw new HttpsError('invalid-argument','A valid request ID and TON transaction hash are required.');
  const ref=db.ref(`withdrawalRequests/${id}`), snap=await ref.get();
  if(!snap.exists())throw new HttpsError('not-found','Withdrawal request not found.');
  const item=snap.val(); if(item.status==='paid'&&item.txHash===txHash)return{ok:true,status:'paid'};
  if(item.status!=='approved')throw new HttpsError('failed-precondition','Only approved requests can be marked paid.');
  const index=db.ref(`withdrawalTxIndex/${txHash}`);const lock=await index.transaction(v=>v===null?id:undefined);
  if(!lock.committed)throw new HttpsError('already-exists','This transaction hash is already recorded.');
  const tx=await ref.transaction(v=>{if(!v||v.status!=='approved')return;v.status='paid';v.txHash=txHash;v.paidBy=admin;v.paidAt=Date.now();v.paymentNote=note;v.updatedAt=ServerValue.TIMESTAMP;return v;});
  if(!tx.committed){await index.remove();throw new HttpsError('failed-precondition','Request changed before payment was recorded.');}
  await db.ref(`transactions/${item.uid}`).push({type:'withdrawal-paid',requestId:id,amount:item.amount,currency:item.currency,destination:item.destination,txHash,status:'paid',createdAt:ServerValue.TIMESTAMP});
  await audit(admin,'withdrawal-paid',item.uid,{requestId:id,amount:item.amount,currency:item.currency,txHash,note});
  return {ok:true,status:'paid',txHash};
});

exports.adminGetAudit = onCall({region:REGION},async req=>{needGod(req);const s=await db.ref('adminAudit').limitToLast(100).get();return{entries:s.val()||{}};});

exports.adminGrantGodClaim = onCall({region:REGION},async req=>{const admin=needGod(req);const email=clean(req.data?.email,160).toLowerCase();if(!email)throw new HttpsError('invalid-argument','Email required.');const user=await getAuth().getUserByEmail(email);await getAuth().setCustomUserClaims(user.uid,{...(user.customClaims||{}),god:true});await audit(admin,'grant-god',user.uid,{email});return{ok:true,uid:user.uid};});
