// 可种子化随机工具（便于复盘/测试）
export function hashStr(s){ let h=2166136261; for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619);} return h>>>0; }
export function mulberry32(a){ return function(){ a|=0;a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
let _rng = mulberry32(Date.now() & 0xffffffff);
export const RNG = {
  reseed(seed){ _rng = mulberry32(seed>>>0); },
  next(){ return _rng(); },
  int(min,max){ return Math.floor(_rng()*(max-min+1))+min; },
  pick(arr){ return arr[Math.floor(_rng()*arr.length)]; },
  shuffle(arr){ for(let i=arr.length-1;i>0;i--){ const j=Math.floor(_rng()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; } return arr; },
  weighted(list, wKey='w'){ let total=0; for(const it of list) total+=it[wKey]; let r=_rng()*total; for(const it of list){ r-=it[wKey]; if(r<=0) return it; } return list[list.length-1]; },
  chance(p){ return _rng()<p; }
};
