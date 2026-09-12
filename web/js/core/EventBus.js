// 轻量事件总线
export class EventBus {
  constructor(){ this.m = new Map(); }
  on(ev, fn){ if(!this.m.has(ev)) this.m.set(ev, new Set()); this.m.get(ev).add(fn); return ()=>this.off(ev,fn); }
  off(ev, fn){ this.m.get(ev)?.delete(fn); }
  emit(ev, payload){ this.m.get(ev)?.forEach(fn=>{ try{ fn(payload); }catch(e){ console.error('[event]',ev,e); } }); }
}
export const bus = new EventBus();
