import {auth,db} from './firebase.js';
import {onAuthStateChanged} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-auth.js';
import {ref,onValue} from 'https://www.gstatic.com/firebasejs/12.5.0/firebase-database.js';

const $=id=>document.getElementById(id);

onAuthStateChanged(auth,u=>{
  if(!u)return;
  onValue(ref(db,'playerLevels/'+u.uid),s=>{
    const v=s.val()||{level:1,xp:0};
    const level=v.level||1;
    const xp=v.xp||0;
    const xpNeeded=100+(level-1)*50;
    $('levelDisplay').textContent=level;
    $('xpDisplay').textContent=xp;
    $('xpNeeded').textContent=xpNeeded;
    $('xpBar').style.width=Math.min(100,(xp/xpNeeded)*100)+'%';
    $('dailyCap').textContent=35+(level-1);
  });
});