import {auth,db} from './firebase.js';
import {onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import {httpsCallable,getFunctions} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-functions.js';

const $=id=>document.getElementById(id),fn=getFunctions(undefined,'us-central1'),call=n=>httpsCallable(fn,n);
let user=null,busy=false;

const icons={rock:'✊',paper:'✋',scissors:'✌️'};

function status(t){$('result').textContent=t;}
function setBusy(v){busy=v;document.querySelectorAll('[data-move]').forEach(b=>b.disabled=v);}

onAuthStateChanged(auth,u=>{
  user=u;
  if(!u)return;
  call('ensurePlayer')({}).catch(e=>status(e.message));
});

async function botMove(move){
  if(busy)return;
  setBusy(true);
  try{
    const r=(await call('playBotMatch')({move})).data;
    $('you').textContent=icons[move];
    $('bot').textContent=icons[r.opponentMove];
    
    let msg=`${r.result.toUpperCase()}`;
    if(r.result==='win')msg+=' · +10 Silver +5 Bronze';
    if(r.result==='loss')msg+=' · -2 Silver -1 Bronze';
    if(r.result==='draw')msg+=' · No change';
    msg+=` · XP: +${r.xpGained||10}`;
    status(msg);
    
    $('wins').textContent=r.result==='win'?Number($('wins').textContent)+1:$('wins').textContent;
    $('losses').textContent=r.result==='loss'?Number($('losses').textContent)+1:$('losses').textContent;
    $('rounds').textContent=Number($('rounds').textContent)+1;
  }catch(e){
    status(e.message||'Match failed.');
  }finally{
    setBusy(false);
  }
}

document.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>botMove(b.dataset.move));