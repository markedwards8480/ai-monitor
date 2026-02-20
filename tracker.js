// ============================================================
// Mark Edwards Apparel — AI Usage Monitor (Tracking Script)
// Embed this in the product catalog to collect usage analytics
// ============================================================

(function() {
  'use strict';

  const MONITOR_CONFIG = {
    apiEndpoint: '/api/monitor/events',
    batchSize: 10,
    flushInterval: 30000,
    sessionTimeout: 30,
    debug: false
  };

  const SESSION_KEY = 'me_monitor_session';
  const USER_KEY = 'me_monitor_user';

  function generateId() { return 'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16)); }
  function getOrCreateSession() { let s; try { s = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch(e){} if(!s||(Date.now()-s.lastActivity>MONITOR_CONFIG.sessionTimeout*60000)) s = { id: generateId(), startedAt: Date.now(), lastActivity: Date.now(), pageViews: 0 }; s.lastActivity=Date.now(); s.pageViews++; try { sessionStorage.setItem(SESSION_KEY,JSON.stringify(s)); } catch(e){} return s; }
  function getOrCreateUser() { let u; try { u = JSON.parse(localStorage.getItem(USER_KEY)); } catch(e){} if(!u) u = { id: generateId(), firstSeen: Date.now(), totalSessions: 0, totalEvents: 0 }; u.totalSessions++; u.lastSeen=Date.now(); try { localStorage.setItem(USER_KEY,JSON.stringify(u)); } catch(e){} return u; }

  const session = getOrCreateSession();
  const user = getOrCreateUser();

  let eventQueue = [], isFlushScheduled = false;

  function trackEvent(cat, act, data={}) { eventQueue.push({ timestamp:Date.now(), sessionId:session.id, userId:user.id, page:window.location.pathname+window.location.search, category:cat, action:act, data, viewport:{width:window.innerWidth,height:window.innerHeight}, device:getDeviceType() }); user.totalEvents++; if(MONITOR_CONFIG.debug) console.log('[Monitor]',cat,act,data); if(eventQueue.length>=MONITOR_CONFIG.batchSize) flushEvents(); else if(!isFlushScheduled) { isFlushScheduled=true; setTimeout(()=>{flushEvents();isFlushScheduled=false;},MONITOR_CONFIG.flushInterval); } }
  function flushEvents() { if(!eventQueue.length) return; const b=[...eventQueue]; eventQueue=[]; fetch(MONITOR_CONFIG.apiEndpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({batch:b,sessionMeta:{sessionId:session.id,userId:user.id,userAgent:navigator.userAgent,screenResolution:screen.width+'x'+screen.height,language:navigator.language,referrer:document.referrer}}),keepalive:true}).catch(()=>{eventQueue=[...b,...eventQueue];}); }
  function getDeviceType() { const w=window.innerWidth; if(w<768) return 'mobile'; if(w<1024) return 'tablet'; return 'desktop'; }

  trackEvent('navigation','page_view',{url:window.location.href,title:document.title,referrer:document.referrer});
  window.MEMonitor={track:trackEvent,flush:flushEvents,getSession:()=>({...session}),getUser:()=>({...user}),config:MONITOR_CONFIG};
})();
