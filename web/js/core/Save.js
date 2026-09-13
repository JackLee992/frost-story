// 本地存档（对标竞品 Realm 本地库；预留云存档接口）
const KEY = 'froststory.save.v1';
const LOCALE_KEY = 'froststory.locale.v1';
export const Save = {
  locale(){
    try{ const explicit=localStorage.getItem(LOCALE_KEY); if(explicit) return explicit;
      const saved=JSON.parse(localStorage.getItem(KEY)||'null'); return saved?.settings?.language||navigator.language||'zh-CN'; }
    catch{ return 'zh-CN'; }
  },
  setLocale(locale){ try{ localStorage.setItem(LOCALE_KEY,locale); }catch{} },
  load(){
    try{ const raw = localStorage.getItem(KEY); if(!raw) return null; const d = JSON.parse(raw); if(!d || d.v!==1) return null; return d; }
    catch(e){ console.warn('save load failed', e); return null; }
  },
  save(state, debounceMs=400){
    clearTimeout(Save._t);
    Save._t = setTimeout(()=>{ try{ localStorage.setItem(KEY, JSON.stringify(state.serialize())); }catch(e){ console.warn('save failed',e); } }, debounceMs);
  },
  saveNow(state){ try{ localStorage.setItem(KEY, JSON.stringify(state.serialize())); }catch(e){} },
  wipe(){ localStorage.removeItem(KEY); }
};
