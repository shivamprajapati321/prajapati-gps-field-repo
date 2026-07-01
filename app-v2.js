"use strict";

// ═════════════════════════════════════════════════════════════════
// Prajapati GPS Field App v15
// FIXES: Camera 0.5x ultra-wide + GPS map stamp restored
//        + Strong PWA install + Aggressive auto-update
// ═════════════════════════════════════════════════════════════════

var APP_VERSION = 'v2.2.2';
var BUILD_DATE = '2026-07-01';

var CONFIG = {
  supabaseUrl: 'https://fpbktcgtspqsqpaytslv.supabase.co',
  supabaseKey: 'sb_publishable_JhObe56x_zETygpy6y8-DQ_qpQXIz_j',
  storageBucket: 'trial-photos',
  locationIqToken: 'pk.fde6fab706b3370a82c78ba286a896be',
  // OCR removed in v2 — sab manual entry + verifier confirm karega
  sessionTtlMs: 12 * 60 * 60 * 1000,
  swUpdateIntervalMs: 5 * 60 * 1000
};

var state = {
  member: null, campaign: null, assignment: null,
  memberOverride: null,
  todayPhotos: [], todayVehicles: [], todayCount: 0,
  slots: [], photos: {}, vehicleNumber: '',
  ownerName: '', contactNumber: '',                 // v2: manual entry fields
  sessionId: '', resumeMode: false, serverPhotoUrls: {},
  sessionCaptures: [],
  gps: { lat:null, lng:null, address:null, addressObj:null, accuracy:null, city:null }
};

function $(id){ return document.getElementById(id); }
function showScreen(id){
  document.querySelectorAll('.scr,.splash').forEach(function(s){ s.classList.remove('active'); s.style.display='none'; });
  var el = $(id); if (!el) return;
  if (el.classList.contains('splash')) el.style.display='flex';
  else { el.style.display='block'; el.classList.add('active'); }
  window.scrollTo(0,0);
  // realtime se assignment badla tha jab home pe nahi the → ab reload
  if (id === 'screen-home' && state && state._assignmentDirty){
    state._assignmentDirty = false;
    if (typeof loadAssignment === 'function') loadAssignment();
  }
}
function toast(msg, type){
  var t = $('toast'); t.textContent = msg;
  t.className = 'toast show ' + (type || '');
  setTimeout(function(){ t.className = 'toast'; }, 2800);
}
function loader(show, text){
  $('overlay-text').textContent = text || 'Working…';
  $('overlay').classList.toggle('show', !!show);
}
function todayStr(){
  var ist = new Date(new Date().getTime() + 5.5*60*60*1000);
  return ist.toISOString().split('T')[0];
}

function touchActivity(){ if (state.member) localStorage.setItem('pf_last_activity', String(Date.now())); }
function isSessionExpired(){
  var last = parseInt(localStorage.getItem('pf_last_activity') || '0');
  return last > 0 && (Date.now() - last) > CONFIG.sessionTtlMs;
}
function clearSessionStorage(){
  localStorage.removeItem('pf_member_phone');
  localStorage.removeItem('pf_last_activity');
  localStorage.removeItem('pf_session_captures');
  localStorage.removeItem('pf_session_captures_date');
}
function persistSessionCaptures(){
  try {
    localStorage.setItem('pf_session_captures', JSON.stringify(state.sessionCaptures));
    localStorage.setItem('pf_session_captures_date', todayStr());
  } catch(e){}
}

// ── RESUME STATE: beech mein band ho (lock/close/app kill) → wapas resume ──
// In-progress vehicle ka snapshot save: kaunse photo slots bhare, details, screen.
function persistResumeState(screen){
  try {
    // kaunse slots ki photo li (captured ya server)
    var doneKeys = [];
    state.slots.forEach(function(s){
      if (state.photos[s.key] || state.serverPhotoUrls[s.key]) doneKeys.push(s.key);
    });
    var snap = {
      date: todayStr(),
      sessionId: state.sessionId,
      screen: screen || 'capture',
      vehicleNumber: state.vehicleNumber || '',
      ownerName: state.ownerName || '',
      contactNumber: state.contactNumber || '',
      doneKeys: doneKeys,
      serverPhotoUrls: state.serverPhotoUrls || {},
      at: Date.now()
    };
    localStorage.setItem('pf_resume_state', JSON.stringify(snap));
  } catch(e){}
}
function clearResumeState(){
  try { localStorage.removeItem('pf_resume_state'); } catch(e){}
}
function getResumeState(){
  try {
    var raw = localStorage.getItem('pf_resume_state');
    if (!raw) return null;
    var snap = JSON.parse(raw);
    // sirf aaj ka + 6 ghante ke andar ka resume valid
    if (snap.date !== todayStr()) { clearResumeState(); return null; }
    if (Date.now() - (snap.at||0) > 6*3600*1000) { clearResumeState(); return null; }
    if (!snap.doneKeys || !snap.doneKeys.length) return null;  // koi photo hi nahi li
    return snap;
  } catch(e){ return null; }
}

function loadSessionCaptures(){
  try {
    var savedDate = localStorage.getItem('pf_session_captures_date');
    if (savedDate !== todayStr()){
      localStorage.removeItem('pf_session_captures');
      localStorage.removeItem('pf_session_captures_date');
      state.sessionCaptures = [];
      return;
    }
    var raw = localStorage.getItem('pf_session_captures');
    if (raw){ state.sessionCaptures = JSON.parse(raw) || []; }
  } catch(e){ state.sessionCaptures = []; }
}
function escapeHtml(s){
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; });
}
function slugify(s){ if (!s) return ''; return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60); }
function genSessionId(){ return 'S' + Date.now().toString(36) + Math.random().toString(36).slice(2,5).toUpperCase(); }
function fallbackVehicleId(){ var d = new Date(); return 'unk-' + String(d.getHours()).padStart(2,'0') + String(d.getMinutes()).padStart(2,'0') + String(d.getSeconds()).padStart(2,'0'); }
function getAngleName(slot){
  // Before photo — clear prefix taaki ZIP/storage mein group ho aur pehle aaye
  if (slot.pt === 'before'){
    if (slot.mode === 'hood') return '0-before-hood';
    if (slot.mode === 'back_panel') return '0-before-back-panel';
    return '0-before';
  }
  if (slot.mode === 'hood'){
    var labels = ['back','left','right','front','top'];
    return labels[slot.n - 1] || ('hood-' + slot.n);
  }
  if (slot.mode === 'back_panel'){
    return state.campaign.back_panel_photo_count > 1 ? ('back-panel-' + slot.n) : 'back-panel';
  }
  return 'photo-' + slot.n;
}

function api(path, options){
  options = options || {};
  options.headers = Object.assign({ 'apikey': CONFIG.supabaseKey, 'Authorization': 'Bearer ' + CONFIG.supabaseKey }, options.headers || {});
  if (options.body && typeof options.body !== 'string'){
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  return fetch(CONFIG.supabaseUrl + path, options).then(function(r){
    if (!r.ok) return r.text().then(function(t){ throw new Error('API '+r.status+': '+t); });
    if (r.status === 204) return null;
    return r.text().then(function(t){
      if (!t) return null;
      try { return JSON.parse(t); } catch(e){ return null; }
    });
  });
}

// ═══ IndexedDB queue ═══
var idb = {
  db: null,
  open: function(){
    return new Promise(function(res, rej){
      if (idb.db){ res(idb.db); return; }
      var req = indexedDB.open('prajapati-gps-v1', 2);
      req.onupgradeneeded = function(){
        var d = req.result;
        if (!d.objectStoreNames.contains('queue')){
          var s = d.createObjectStore('queue', { keyPath:'id', autoIncrement:true });
          s.createIndex('status', 'status');
        }
        if (!d.objectStoreNames.contains('config')){
          d.createObjectStore('config', { keyPath:'key' });
        }
      };
      req.onsuccess = function(){ idb.db = req.result; res(idb.db); };
      req.onerror = function(){ rej(req.error); };
    });
  },
  add: function(rec){ return idb.open().then(function(d){ return new Promise(function(res, rej){ var tx = d.transaction('queue', 'readwrite'); var r = tx.objectStore('queue').add(rec); r.onsuccess = function(){ res(r.result); }; r.onerror = function(){ rej(r.error); }; }); }); },
  update: function(id, ch){ return idb.open().then(function(d){ return new Promise(function(res, rej){ var tx = d.transaction('queue', 'readwrite'); var s = tx.objectStore('queue'); var g = s.get(id); g.onsuccess = function(){ var rec = g.result; if (!rec){ res(null); return; } Object.assign(rec, ch); var p = s.put(rec); p.onsuccess = function(){ res(rec); }; p.onerror = function(){ rej(p.error); }; }; g.onerror = function(){ rej(g.error); }; }); }); },
  remove: function(id){ return idb.open().then(function(d){ return new Promise(function(res, rej){ var tx = d.transaction('queue', 'readwrite'); var r = tx.objectStore('queue').delete(id); r.onsuccess = function(){ res(); }; r.onerror = function(){ rej(r.error); }; }); }); },
  getAll: function(){ return idb.open().then(function(d){ return new Promise(function(res, rej){ var tx = d.transaction('queue', 'readonly'); var r = tx.objectStore('queue').getAll(); r.onsuccess = function(){ res(r.result || []); }; r.onerror = function(){ rej(r.error); }; }); }); },
  getPending: function(){ return idb.getAll().then(function(rows){ return rows.filter(function(r){ return r.status === 'pending' || r.status === 'failed'; }); }); },
  setConfig: function(key, value){
    return idb.open().then(function(d){
      return new Promise(function(res, rej){
        var tx = d.transaction('config', 'readwrite');
        var r = tx.objectStore('config').put({ key: key, value: value });
        r.onsuccess = function(){ res(); };
        r.onerror = function(){ rej(r.error); };
      });
    });
  },
  getConfig: function(key){
    return idb.open().then(function(d){
      return new Promise(function(res, rej){
        var tx = d.transaction('config', 'readonly');
        var r = tx.objectStore('config').get(key);
        r.onsuccess = function(){ res(r.result ? r.result.value : null); };
        r.onerror = function(){ rej(r.error); };
      });
    });
  }
};

var queueRunning = false;

function updateSessionStatus(){
  var st = $('session-status'); if (!st) return;
  var dot = st.querySelector('.dot');
  var span = st.querySelector('span');
  if (!dot || !span) return;
  idb.getAll().then(function(rows){
    var pending = rows.filter(function(r){ return r.status === 'pending' || r.status === 'failed'; }).length;
    if (!navigator.onLine){ dot.className = 'dot offline'; span.textContent = 'Offline · '+pending+' queued'; }
    else if (queueRunning && pending > 0){ dot.className = 'dot uploading'; span.textContent = 'Uploading '+pending+'…'; }
    else if (pending > 0){ dot.className = 'dot uploading'; span.textContent = pending+' uploading'; }
    else { dot.className = 'dot idle'; span.textContent = 'All synced'; }
  });
}

function processQueue(){
  if (queueRunning || !navigator.onLine) return Promise.resolve();
  queueRunning = true;
  updateSessionStatus();
  return idb.getPending().then(function(items){
    // ⚡ SPEED: 3 photos ek saath upload (parallel) — sequential se ~3x fast.
    var CONCURRENCY = 3;
    var idx = 0;
    function uploadOne(item){
      return uploadQueueItem(item)
        .then(function(){ return idb.remove(item.id); })
        .then(function(){ updateSessionStatus(); })
        .catch(function(err){
          console.error('Queue item '+item.id+' failed:', err);
          return idb.update(item.id, { status:'failed', attempts:(item.attempts||0)+1, lastError:String(err) });
        });
    }
    function worker(){
      if (idx >= items.length) return Promise.resolve();
      var item = items[idx++];
      return uploadOne(item).then(worker);   // ek khatam → agla lo
    }
    // CONCURRENCY workers ek saath chalao
    var workers = [];
    for (var w = 0; w < Math.min(CONCURRENCY, items.length); w++) workers.push(worker());
    return Promise.all(workers);
  }).then(function(){ queueRunning = false; updateSessionStatus(); }).catch(function(){ queueRunning = false; updateSessionStatus(); });
}

function uploadQueueItem(item){
  var path = item.metadata.storage_path;
  var pathSegs = path.split('/').map(encodeURIComponent).join('/');
  var url = CONFIG.supabaseUrl + '/storage/v1/object/' + CONFIG.storageBucket + '/' + pathSegs;
  return fetch(url, {
    method: 'POST',
    headers: { 'apikey': CONFIG.supabaseKey, 'Authorization': 'Bearer ' + CONFIG.supabaseKey, 'Content-Type': 'image/jpeg', 'x-upsert': 'true' },
    body: item.blob
  }).then(function(r){
    if (!r.ok) return r.text().then(function(t){ throw new Error('Storage '+r.status+': '+t); });
    var publicUrl = CONFIG.supabaseUrl + '/storage/v1/object/public/' + CONFIG.storageBucket + '/' + pathSegs;
    var dbRow = Object.assign({}, item.metadata.dbRow, { public_url: publicUrl });
    return api('/rest/v1/trial_photos', { method:'POST', headers:{ 'Prefer':'return=minimal' }, body: dbRow });
  });
}

window.addEventListener('online', function(){ toast('Back online — uploading queued','success'); processQueue(); });
window.addEventListener('offline', function(){ toast('Offline — captures will queue','warn'); updateSessionStatus(); });
setInterval(function(){ if (navigator.onLine) processQueue(); }, 25000);

// ═══ AUTH ═══
// ═════════════════════════════════════════════════════════════════
// GPS PERMISSION — 5-LAYER STRATEGY (v15.4.3)
// Layer 1: Pre-check on login (catch issues early)
// Layer 2: Friendly Hinglish setup modal
// Layer 3: Smart auto-fallback to manual GPS (handled in handleGpsError)
// Layer 4: Admin dashboard reporting (reportGpsStatus)
// Layer 5: First-time onboarding wizard
// ═════════════════════════════════════════════════════════════════

// Layer 1: Check current permission state via Permissions API
function checkGpsPermissionState(){
  return new Promise(function(resolve){
    if (!navigator.permissions || !navigator.permissions.query){
      // Permissions API not available — assume prompt
      resolve('prompt');
      return;
    }
    navigator.permissions.query({ name: 'geolocation' }).then(function(result){
      console.log('[GPS v15.4.3] Permission state:', result.state);
      // Listen for changes
      result.onchange = function(){
        console.log('[GPS v15.4.3] Permission changed to:', result.state);
        if (result.state === 'granted'){
          hideGpsSetupModal();
          toast('✅ GPS permission granted!', 'success');
          reportGpsStatus('granted');
          if (gpsWatchId === null) watchGps();
        }
      };
      resolve(result.state); // 'granted' | 'denied' | 'prompt'
    }).catch(function(){ resolve('prompt'); });
  });
}

// Layer 2 + 6: Show GPS setup modal (state-aware Hinglish + step-by-step)
window.showGpsSetupModal = function(){
  var modal = $('gps-setup-modal');
  if (!modal) return;
  
  // Detect browser/OS for tailored instructions
  var ua = navigator.userAgent.toLowerCase();
  var hint = $('gps-modal-hint');
  if (/iphone|ipad|ipod/.test(ua)){
    hint.textContent = 'iPhone: Settings → Safari → Location → Allow';
  } else if (/android/.test(ua)){
    hint.textContent = '"Block Hai? Yahan Fix Karo" button daba detailed steps ke liye';
  } else {
    hint.textContent = 'Browser settings me location permission "Allow" karo';
  }
  
  // ⭐ v15.4.5: Show/hide manual GPS button based on campaign config
  var manualBtn = $('gps-manual-btn');
  if (manualBtn){
    manualBtn.style.display = hasCampaignAnchor() ? 'block' : 'none';
  }
  
  modal.classList.add('show');
  console.log('[GPS v15.4.5] Setup modal shown');
  
  // ⭐ v15.4.5: Detect if permission is permanently blocked, auto-suggest blocked recovery
  if (navigator.permissions && navigator.permissions.query){
    navigator.permissions.query({ name: 'geolocation' }).then(function(result){
      console.log('[GPS v15.4.5] Modal opened with state:', result.state);
      if (result.state === 'denied'){
        // Update modal to show blocked-specific guidance
        var title = $('gps-modal-title');
        var subtitle = $('gps-modal-subtitle');
        if (title) title.textContent = 'GPS Block Hai';
        if (subtitle) subtitle.textContent = 'Permission permanently block hai. "Block Hai? Yahan Fix Karo" daba — step-by-step guide milega.';
      }
    }).catch(function(){});
  }
};

window.hideGpsSetupModal = function(){
  var modal = $('gps-setup-modal');
  if (modal) modal.classList.remove('show');
};

// ⭐ v15.4.5 Layer 6: Smart permission request that handles all states
window.forceRequestGpsPermission = function(){
  console.log('[GPS v15.4.5] Force-requesting GPS permission');
  if (!navigator.geolocation){
    toast('GPS not supported on this device','error');
    return;
  }
  
  var btn = $('gps-allow-btn');
  if (btn){ btn.disabled = true; btn.textContent = '⏳ Permission check kar rahe…'; }
  loader(true, 'GPS permission maang rahe…');
  
  // Track timing — if call returns instantly with error, permission is likely BLOCKED
  var startedAt = Date.now();
  
  navigator.geolocation.getCurrentPosition(
    function(pos){
      // SUCCESS
      loader(false);
      if (btn){ btn.disabled = false; btn.textContent = '📍 GPS Allow Karo'; }
      setGpsFromPosition(pos);
      hideGpsSetupModal();
      toast('✅ GPS mil gaya! Ab kaam kar sakte ho', 'success');
      reportGpsStatus('granted');
      if (gpsWatchId === null && navigator.geolocation){
        gpsWatchId = navigator.geolocation.watchPosition(
          function(pos){ setGpsFromPosition(pos); },
          function(err){ handleGpsError(err); },
          { enableHighAccuracy:true, maximumAge:3000, timeout:20000 }
        );
      }
    },
    function(err){
      loader(false);
      if (btn){ btn.disabled = false; btn.textContent = '📍 GPS Allow Karo'; }
      
      var elapsedMs = Date.now() - startedAt;
      console.warn('[GPS v2] Permission failed:', err.code, 'elapsed:', elapsedMs + 'ms');
      
      if (err.code === 1){
        // PERMISSION_DENIED
        if (elapsedMs < 500){
          console.log('[GPS v2] Fast-fail — permission BLOCKED, showing recovery');
          toast('⚠️ GPS block hai — recovery steps follow karo', 'warn');
          showBlockedRecovery();
        } else {
          toast('Permission deny ki — phir try karo ya "Block Hai?" daba', 'error');
        }
        reportGpsStatus('denied');
      } else if (err.code === 2){
        toast('📡 Phone ka GPS service on karo (Quick settings se)', 'error');
        reportGpsStatus('unavailable');
      } else if (err.code === 3){
        toast('⏱️ GPS timeout — phir try karo', 'warn');
        reportGpsStatus('timeout');
      }
    },
    { enableHighAccuracy:false, maximumAge:60000, timeout:8000 }   // ⚡ fast first lock (cached OK)
  );
};

// Keep backward compat alias
window.retryGpsPermission = window.forceRequestGpsPermission;

// ⭐ Layer 6: Show "Block Hai" recovery modal with multi-path fix
window.showBlockedRecovery = function(){
  var setup = $('gps-setup-modal');
  var blocked = $('gps-blocked-modal');
  if (setup) setup.classList.remove('show');
  if (blocked){
    blocked.style.display = 'flex';
    blocked.classList.add('show');
  }
  console.log('[GPS v15.4.5] Blocked recovery modal shown');
};

window.hideBlockedRecovery = function(){
  var blocked = $('gps-blocked-modal');
  if (blocked){
    blocked.classList.remove('show');
    blocked.style.display = 'none';
  }
  // After user says "Fix Kar Liya", try permission again
  setTimeout(function(){
    showGpsSetupModal();
    setTimeout(forceRequestGpsPermission, 400);
  }, 300);
};

// ⭐ Layer 6: Nuclear Reset — clear all site data and reload
window.nuclearReset = function(){
  if (!confirm('Sab data clear ho jaayega aur app restart hoga. Kya aap confirm karte ho?\n\n(Captured photos jo upload nahi hue, woh lost ho sakte hain.)')) {
    return;
  }
  
  loader(true, 'Reset kar rahe… 5 sec lagega');
  console.log('[GPS v15.4.5] Nuclear reset initiated');
  
  var resetTasks = [];
  
  // 1. Clear all caches (Service Worker cache)
  if ('caches' in window){
    resetTasks.push(
      caches.keys().then(function(keys){
        return Promise.all(keys.map(function(key){
          console.log('[Reset] Deleting cache:', key);
          return caches.delete(key);
        }));
      })
    );
  }
  
  // 2. Unregister all service workers
  if ('serviceWorker' in navigator){
    resetTasks.push(
      navigator.serviceWorker.getRegistrations().then(function(regs){
        return Promise.all(regs.map(function(r){
          console.log('[Reset] Unregistering SW:', r.scope);
          return r.unregister();
        }));
      })
    );
  }
  
  // 3. Clear IndexedDB (don't delete the queue if photos pending)
  // Just clear localStorage + sessionStorage
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch(e){}
  
  Promise.all(resetTasks).then(function(){
    console.log('[GPS v15.4.5] Reset complete — reloading');
    setTimeout(function(){
      // Hard reload with cache bypass
      window.location.href = window.location.href.split('?')[0] + '?reset=' + Date.now();
    }, 800);
  }).catch(function(err){
    console.error('[Reset] Error:', err);
    setTimeout(function(){ window.location.reload(true); }, 800);
  });
};

// ⭐ Layer 6: Copy diagnostics for admin support
window.copyDiagnostics = function(){
  var diag = {
    version: APP_VERSION,
    build: BUILD_DATE,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    platform: navigator.platform || 'unknown',
    geolocationSupported: 'geolocation' in navigator,
    permissionsApiSupported: 'permissions' in navigator,
    online: navigator.onLine,
    member: state.member ? state.member.name + ' (' + state.member.phone + ')' : 'not logged in',
    campaign: state.campaign ? state.campaign.key : 'none',
    campaignHasAnchor: hasCampaignAnchor(),
    lastGpsStatus: gpsLastReportedStatus || 'unknown',
    standalone: window.matchMedia('(display-mode: standalone)').matches,
    url: window.location.href
  };
  
  // Try to get permission state
  if (navigator.permissions){
    navigator.permissions.query({ name: 'geolocation' }).then(function(result){
      diag.permissionState = result.state;
      var text = '🔧 MARS GPS Diagnostics\n' +
                 '────────────────────────────\n' +
                 Object.keys(diag).map(function(k){ return k + ': ' + diag[k]; }).join('\n') +
                 '\n────────────────────────────\n' +
                 'WhatsApp this to admin: 9922138138';
      copyToClipboardAndShare(text);
    }).catch(function(){
      copyToClipboardAndShare(JSON.stringify(diag, null, 2));
    });
  } else {
    copyToClipboardAndShare(JSON.stringify(diag, null, 2));
  }
};

function copyToClipboardAndShare(text){
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){
      toast('✅ Diagnostics copy hue! WhatsApp pe paste karo', 'success');
      // Also try Web Share API for direct share
      if (navigator.share){
        setTimeout(function(){
          navigator.share({
            title: 'GPS Issue Diagnostics',
            text: text
          }).catch(function(){});
        }, 500);
      }
    }).catch(function(){
      // Fallback: show in alert
      prompt('Copy karke admin ko bhejo:', text);
    });
  } else {
    prompt('Copy karke admin ko bhejo:', text);
  }
}

// Layer 3 trigger: User explicitly chooses manual fallback
window.tryManualFallback = function(){
  if (!hasCampaignAnchor()){
    toast('Is campaign me manual GPS configure nahi hai — admin se contact karo', 'warn');
    return;
  }
  enableManualFallback();
  hideGpsSetupModal();
  toast('✅ Manual GPS active (campaign anchor)', 'success');
  reportGpsStatus('denied_fallback_manual');
};

// Layer 4: Report GPS status to admin (best-effort, never blocks UI)
function reportGpsStatus(status){
  // Throttle: only report if status changed
  if (gpsLastReportedStatus === status) return;
  gpsLastReportedStatus = status;
  
  if (!state.member || !state.member.phone) return;
  
  try {
    api('/rest/v1/trial_team_members?phone=eq.' + state.member.phone, {
      method: 'PATCH',
      headers: { 'Prefer': 'return=minimal' },
      body: {
        gps_permission_status: status,
        gps_last_check_at: new Date().toISOString()
      }
    }).catch(function(err){
      // Silent fail — columns might not exist yet in DB
      console.warn('[GPS v15.4.3] Status report failed (run SQL migration):', err.message);
    });
  } catch(e){}
}

// Layer 5: First-time onboarding screen
window.showOnboardingScreen = function(){
  var screen = $('onboard-screen');
  if (!screen){
    // Fallback if HTML not deployed yet — proceed normally
    enterApp();
    return;
  }
  var firstName = state.member ? state.member.name.split(' ')[0] : '';
  $('onboard-title').textContent = 'Welcome' + (firstName ? ', ' + firstName : '') + '!';
  screen.classList.add('show');
};

window.onboardingAllowGps = function(){
  console.log('[GPS v15.4.3] Onboarding: requesting permission');
  var btn = $('onboard-allow-btn');
  if (btn){ btn.disabled = true; btn.textContent = 'GPS check kar rahe…'; }
  
  navigator.geolocation.getCurrentPosition(
    function(pos){
      // Granted!
      localStorage.setItem('pf_gps_onboarded', '1');
      setGpsFromPosition(pos);
      reportGpsStatus('granted');
      $('onboard-screen').classList.remove('show');
      enterApp();
      setTimeout(function(){ toast('✅ Setup complete — kaam shuru karo!', 'success'); }, 600);
    },
    function(err){
      // Denied or error
      if (btn){ btn.disabled = false; btn.textContent = '📍 GPS Permission Allow Karo'; }
      if (err.code === 1){
        localStorage.setItem('pf_gps_onboarded', '1');
        $('onboard-screen').classList.remove('show');
        enterApp();
        setTimeout(function(){ showGpsSetupModal(); }, 600);
        reportGpsStatus('denied');
      } else {
        toast('GPS error — phone ka GPS on hai?', 'error');
      }
    },
    { enableHighAccuracy:true, timeout:15000, maximumAge:0 }
  );
};

window.onboardingSkip = function(){
  localStorage.setItem('pf_gps_onboarded', '1');
  $('onboard-screen').classList.remove('show');
  enterApp();
  setTimeout(function(){
    toast('GPS later allow karna — capture time pe puchega', 'warn');
  }, 600);
};

// ═════════════════════════════════════════════════════════════════
// AUTH (continued)
// ═════════════════════════════════════════════════════════════════

function bootAuth(){
  var saved = localStorage.getItem('pf_member_phone');
  if (!saved){ showScreen('screen-login'); return; }
  if (isSessionExpired()){
    clearSessionStorage();
    showScreen('screen-login');
    setTimeout(function(){ toast('Session expired (12hr inactive) — login again','warn'); }, 400);
    return;
  }
  loadSessionCaptures();
  api('/rest/v1/trial_team_members?phone=eq.'+saved+'&active=eq.true&select=*')
    .then(function(rows){
      if (rows && rows.length){
        state.member = rows[0]; touchActivity();
        
        // ⭐ Layer 1: Auto-login pre-check (silent — show modal only if denied)
        checkGpsPermissionState().then(function(permState){
          enterApp();
          setTimeout(function(){
            var n = state.sessionCaptures.length || state.todayCount || 0;
            var firstName = state.member.name.split(' ')[0];
            if (n > 0) toast('Welcome back, ' + firstName + ' — ' + n + ' vehicles aaj', 'success');
            else toast('Welcome back, ' + firstName, 'success');
            // If denied at app start, prompt to fix
            if (permState === 'denied') {
              setTimeout(function(){ showGpsSetupModal(); }, 1500);
            }
          }, 800);
        });
      } else { clearSessionStorage(); showScreen('screen-login'); }
    }).catch(function(){ showScreen('screen-login'); });
}

$('btn-login').addEventListener('click', function(){
  var phone = $('inp-mobile').value.trim().replace(/\D/g,'');
  if (phone.length !== 10) return toast('10-digit mobile number daalo','error');
  loader(true, 'Logging in…');
  api('/rest/v1/trial_team_members?phone=eq.'+phone+'&active=eq.true&select=*')
    .then(function(rows){
      loader(false);
      if (!rows || !rows.length) return toast('Number registered nahi hai','error');
      state.member = rows[0];
      state.sessionCaptures = [];
      localStorage.setItem('pf_member_phone', phone);
      touchActivity(); persistSessionCaptures();
      
      // ⭐ Layer 1 + Layer 5: Check permission state BEFORE entering app
      var hasOnboarded = localStorage.getItem('pf_gps_onboarded') === '1';
      checkGpsPermissionState().then(function(permState){
        if (permState === 'granted') {
          // Already granted — straight to app
          localStorage.setItem('pf_gps_onboarded', '1');
          enterApp();
        } else if (permState === 'denied') {
          // Already denied — show setup modal AFTER entering app
          enterApp();
          setTimeout(function(){ showGpsSetupModal(); }, 600);
        } else if (!hasOnboarded) {
          // First-time user (prompt state, not onboarded) — show onboarding
          showOnboardingScreen();
        } else {
          // Returning user, prompt state — proceed normally
          enterApp();
        }
      });
    }).catch(function(){ loader(false); toast('Login error','error'); });
});

$('inp-mobile').addEventListener('keypress', function(e){ if (e.key === 'Enter') $('btn-login').click(); });

function logout(skipConfirm){
  if (!skipConfirm && !confirm('Logout?')) return;
  clearSessionStorage();
  if (typeof stopHomeAutoRefresh === 'function') stopHomeAutoRefresh();
  if (typeof stopRealtimeAssignments === 'function') stopRealtimeAssignments();
  state = { member:null, campaign:null, assignment:null, memberOverride:null, todayPhotos:[], todayVehicles:[], todayCount:0, slots:[], photos:{}, vehicleNumber:'', ownerName:'', contactNumber:'', sessionId:'', resumeMode:false, serverPhotoUrls:{}, sessionCaptures:[], gps:{} };
  showScreen('screen-login');
  $('inp-mobile').value = '';
}

setInterval(function(){
  if (state.member && isSessionExpired()){
    toast('Session expired — auto logging out','warn');
    setTimeout(function(){ logout(true); }, 1500);
  }
}, 5 * 60 * 1000);

document.addEventListener('visibilitychange', function(){
  if (!document.hidden && state.member){
    if (isSessionExpired()){
      toast('Session expired','warn');
      setTimeout(function(){ logout(true); }, 1200);
    } else {
      touchActivity();
      // app wapas foreground → realtime reconnect (agar toota tha) + fresh assignment
      if (!_rtSocket || _rtSocket.readyState !== 1){ startRealtimeAssignments(); }
      if ($('screen-home') && $('screen-home').classList.contains('active')){ loadAssignment(); }
      processQueue();  // pending photos resume upload
    }
  }
});

// ════════════════════════════════════════════════════════════════════
// ONE-TIME ALL PERMISSIONS — pehli baar app khulne pe camera+GPS EK SAATH maange
// taaki baar-baar "allow" na poochhe. localStorage flag se sirf first time.
// ════════════════════════════════════════════════════════════════════
function requestAllPermissions(){
  // already maang chuke? (first install/open ke baad skip)
  if (localStorage.getItem('pf_perms_asked_v2') === '1') return;

  // GPS permission state check — agar pehle se granted hai toh GPS dubara mat maango
  function askGps(){
    return new Promise(function(resolve){
      if (!navigator.geolocation){ resolve(); return; }
      navigator.geolocation.getCurrentPosition(
        function(){ resolve(); },
        function(){ resolve(); },   // denied/timeout — phir bhi aage badho
        { enableHighAccuracy:false, timeout:8000, maximumAge:60000 }
      );
    });
  }

  // Camera permission — ek halka getUserMedia, turant band (sirf permission lene ke liye)
  function askCamera(){
    return new Promise(function(resolve){
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia){ resolve(); return; }
      navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' }, audio:false })
        .then(function(stream){
          // permission mil gaya — stream turant band (camera band ho jaye)
          try { stream.getTracks().forEach(function(t){ t.stop(); }); } catch(e){}
          resolve();
        })
        .catch(function(){ resolve(); });  // denied — aage badho
    });
  }

  // dono ek ke baad ek (browser ek time ek hi prompt dikhata hai, par lagatar aayenge)
  askGps().then(askCamera).then(function(){
    localStorage.setItem('pf_perms_asked_v2', '1');
    console.log('[Field-v2] All permissions requested (one-time)');
  });
}

function enterApp(){
  showScreen('screen-home');
  if (!$('app-header')){
    var hdr = document.createElement('div');
    hdr.id = 'app-header'; hdr.className = 'header';
    hdr.innerHTML = '<div class="h-l"><div class="h-logo">M</div><div><h1>MARS GPS</h1><div class="sub">'+escapeHtml(state.member.name)+'</div></div></div><button class="lo-btn" onclick="logout(false)">Logout</button>';
    $('screen-home').insertBefore(hdr, $('home-content'));
  } else {
    var subEl = $('app-header').querySelector('.sub');
    if (subEl) subEl.textContent = state.member.name;
  }
  touchActivity();
  requestAllPermissions();   // ⭐ pehli baar — camera+GPS ek saath maango
  loadAssignment();
  processQueue();
  startHomeAutoRefresh();
  startRealtimeAssignments();   // ⚡ admin assign kare → turant update (bina refresh)
}

// ═════════════════════════════════════════════════════════════════
// REALTIME: admin campaign assign kare → team ko turant dikhe
// Supabase Realtime WebSocket se trial_daily_assignments pe listen.
// ═════════════════════════════════════════════════════════════════
var _rtSocket = null;
var _rtRef = 1;
var _rtHeartbeat = null;
var _rtReconnectTimer = null;
function startRealtimeAssignments(){
  if (!state.member || !state.member.phone) return;
  stopRealtimeAssignments();
  try {
    var wsUrl = CONFIG.supabaseUrl.replace('https://','wss://') + '/realtime/v1/websocket?apikey=' + CONFIG.supabaseKey + '&vsn=1.0.0';
    _rtSocket = new WebSocket(wsUrl);

    _rtSocket.onopen = function(){
      // subscribe to postgres changes on trial_daily_assignments for THIS member
      var joinMsg = {
        topic: 'realtime:public:trial_daily_assignments',
        event: 'phx_join',
        payload: {
          config: {
            postgres_changes: [
              { event: '*', schema: 'public', table: 'trial_daily_assignments', filter: 'member_phone=eq.' + state.member.phone }
            ]
          }
        },
        ref: String(_rtRef++)
      };
      _rtSocket.send(JSON.stringify(joinMsg));
      // heartbeat har 25s (connection alive rakhne ke liye)
      _rtHeartbeat = setInterval(function(){
        if (_rtSocket && _rtSocket.readyState === 1){
          _rtSocket.send(JSON.stringify({ topic:'phoenix', event:'heartbeat', payload:{}, ref:String(_rtRef++) }));
        }
      }, 25000);
    };

    _rtSocket.onmessage = function(e){
      try {
        var msg = JSON.parse(e.data);
        // postgres change aaya → assignment reload
        if (msg.event === 'postgres_changes' || (msg.payload && msg.payload.data && msg.payload.data.table === 'trial_daily_assignments')){
          console.log('[Realtime] Assignment change → reloading');
          if ($('screen-home') && $('screen-home').classList.contains('active')){
            loadAssignment();
          } else {
            // home pe nahi hai → flag rakho, home aane pe reload
            state._assignmentDirty = true;
          }
          toast('📋 Campaign update aaya','ok');
        }
      } catch(err){}
    };

    _rtSocket.onclose = function(){
      // auto-reconnect after 5s
      if (_rtReconnectTimer) clearTimeout(_rtReconnectTimer);
      _rtReconnectTimer = setTimeout(function(){
        if (state.member) startRealtimeAssignments();
      }, 5000);
    };
    _rtSocket.onerror = function(){ /* onclose handle karega */ };
  } catch(err){
    console.warn('[Realtime] setup failed (auto-refresh fallback active):', err);
  }
}
function stopRealtimeAssignments(){
  if (_rtHeartbeat){ clearInterval(_rtHeartbeat); _rtHeartbeat = null; }
  if (_rtReconnectTimer){ clearTimeout(_rtReconnectTimer); _rtReconnectTimer = null; }
  if (_rtSocket){ try { _rtSocket.close(); } catch(e){} _rtSocket = null; }
}

function loadAssignment(){
  loader(true, 'Loading…');
  var date = todayStr();
  api('/rest/v1/trial_daily_assignments?member_phone=eq.'+state.member.phone+'&assignment_date=eq.'+date+'&select=*')
    .then(function(rows){
      if (!rows || !rows.length){ state.assignment = null; state.campaign = null; state.memberOverride = null; renderHome(); loader(false); return null; }
      state.assignment = rows[0];
      var campaignKey = rows[0].campaign_key;
      // v15.5.1 SPEED: Fetch campaign + override IN PARALLEL (saves ~400ms vs sequential)
      // Photos fetch needs campaign data first (slot counts), so it stays after
      return Promise.all([
        api('/rest/v1/trial_campaigns?key=eq.'+encodeURIComponent(campaignKey)+'&select=*'),
        api('/rest/v1/trial_member_gps_overrides?member_phone=eq.'+encodeURIComponent(state.member.phone)+'&campaign_key=eq.'+encodeURIComponent(campaignKey)+'&active=eq.true&select=*').catch(function(e){ console.warn('[GPS Override] Fetch failed (using real GPS):', e); return []; })
      ]);
    })
    .then(function(results){
      if (!results) return;
      var campRows = results[0];
      var ovRows = results[1];
      if (campRows && campRows.length){
        state.campaign = campRows[0];
      }
      state.memberOverride = (ovRows && ovRows.length) ? ovRows[0] : null;
      if (state.memberOverride){
        console.log('[GPS Override] Active for member', state.member.phone, '→', state.memberOverride);
      }
      if (state.campaign) return loadTodayPhotos();
    })
    .then(function(){ renderHome(); loader(false); })
    .catch(function(err){ console.error(err); loader(false); toast('Load error','error'); });
}

function loadTodayPhotos(){
  var date = todayStr();
  var startUTC = new Date(date + 'T00:00:00+05:30').toISOString();
  var endUTC = new Date(date + 'T23:59:59+05:30').toISOString();
  return api('/rest/v1/trial_photos?member_phone=eq.'+state.member.phone+'&campaign_key=eq.'+state.campaign.key+'&captured_at=gte.'+startUTC+'&captured_at=lte.'+endUTC+'&rejected=eq.false&deleted_at=is.null&select=vehicle_number,mode,photo_type,photo_number,public_url,captured_at&order=captured_at.desc&limit=5000')
    .then(function(rows){
      state.todayPhotos = rows || [];
      var byVeh = {};
      state.todayPhotos.forEach(function(p){
        var k = p.vehicle_number || ('UNK_' + (p.captured_at||'').slice(0,16));
        if (!byVeh[k]){ byVeh[k] = { key: k, vehicle_number: p.vehicle_number || '', photos: [], firstAt: p.captured_at }; }
        byVeh[k].photos.push(p);
      });
      state.todayVehicles = Object.values(byVeh);
      var ec1 = expectedCounts();
      var hT = ec1.hood;
      var bT = ec1.back;
      state.todayCount = state.todayVehicles.filter(function(v){
        var hd = v.photos.filter(function(p){ return p.mode==='hood'; }).length;
        var bd = v.photos.filter(function(p){ return p.mode==='back_panel'; }).length;
        return hd >= hT && bd >= bT;
      }).length;
      var serverByKey = {};
      state.todayVehicles.forEach(function(v){ serverByKey[v.key] = v; });
      state.sessionCaptures = state.sessionCaptures.filter(function(sc){
        var sv = serverByKey[sc.key];
        if (!sv) return true;
        var serverHood = sv.photos.filter(function(p){return p.mode==='hood';}).length;
        var serverBack = sv.photos.filter(function(p){return p.mode==='back_panel';}).length;
        return serverHood < (sc.hood_count||0) || serverBack < (sc.back_count||0);
      });
      persistSessionCaptures();
    });
}

var homeRefreshTimer = null;
function startHomeAutoRefresh(){
  stopHomeAutoRefresh();
  homeRefreshTimer = setInterval(function(){
    if (!$('screen-home').classList.contains('active')) return;
    idb.getAll().then(function(rows){
      var pending = rows.filter(function(r){ return r.status === 'pending' || r.status === 'failed'; }).length;
      if (pending > 0 || state.sessionCaptures.length > 0){ loadAssignment(); }
      else { stopHomeAutoRefresh(); }
    });
  }, 8000);
}
function stopHomeAutoRefresh(){ if (homeRefreshTimer){ clearInterval(homeRefreshTimer); homeRefreshTimer = null; } }

function renderHome(){
  var html = '';
  if (!state.assignment || !state.campaign){
    html += '<div class="card" style="border-color:var(--wn);background:#fef9e7"><h3 style="color:#a06000">⚠ No campaign assigned</h3><div class="sub">Aaj admin ne tumhe koi campaign assign nahi kiya.</div><button class="btn btn-g" onclick="loadAssignment()">↻ Refresh</button></div>';
    $('home-content').innerHTML = html;
    return;
  }
  var c = state.campaign;
  var hT = c.hood_photo_count || 0;
  var bT = c.back_panel_photo_count || 0;

  // ── RESUME BANNER: beech mein chhoda vehicle → wapas ──
  var resume = getResumeState();
  if (resume){
    var doneN = resume.doneKeys.length;
    var vlabel = resume.vehicleNumber ? escapeHtml(resume.vehicleNumber) : 'Vehicle (details pending)';
    html += '<div class="card" style="border-color:var(--ac);background:#eafcff">'+
      '<h3 style="color:#0891b2">⏸️ Adhura vehicle</h3>'+
      '<div class="sub">'+vlabel+' · '+doneN+' photos li thi · beech mein ruk gaya</div>'+
      '<div style="display:flex;gap:8px;margin-top:10px">'+
      '<button class="btn" onclick="resumeVehicle()" style="flex:1">▶️ Resume karo</button>'+
      '<button class="btn btn-g" onclick="discardResume()" style="flex:0 0 auto;padding:10px 14px">🗑️</button>'+
      '</div></div>';
  }

  var ecH = expectedCounts();   // before-aware: completion check ke liye
  var needH = ecH.hood, needB = ecH.back;
  var serverKeys = {};
  state.todayVehicles.forEach(function(v){ serverKeys[v.key] = true; });
  var mergedVehicles = state.todayVehicles.slice();
  state.sessionCaptures.forEach(function(sc){
    if (!serverKeys[sc.key]){
      var pseudoPhotos = [];
      for (var i=0; i<sc.hood_count; i++) pseudoPhotos.push({mode:'hood', photo_number:i+1, _local:true});
      for (var j=0; j<sc.back_count; j++) pseudoPhotos.push({mode:'back_panel', photo_number:j+1, _local:true});
      mergedVehicles.push({ key: sc.key, vehicle_number: sc.vehicle_number, photos: pseudoPhotos, firstAt: sc.captured_at, _localOnly: true });
    }
  });
  var vehCount = mergedVehicles.length;
  var completeCount = mergedVehicles.filter(function(v){
    var hd = v.photos.filter(function(p){return p.mode==='hood';}).length;
    var bd = v.photos.filter(function(p){return p.mode==='back_panel';}).length;
    return hd >= needH && bd >= needB;
  }).length;
  html += '<div class="hero"><div class="lbl">Today\'s Campaign</div><h2>'+escapeHtml(c.name)+'</h2><div class="meta">'+(c.default_city?escapeHtml(c.default_city):'')+'</div><div class="progress"><div><strong>'+completeCount+'</strong>Complete</div><div><strong>'+vehCount+'</strong>Started</div><div><strong>'+(c.target_count||'∞')+'</strong>Target</div></div></div>';
  var modeLine = '';
  var bf = !!c.before_photo;
  if (hT > 0 && bT > 0) modeLine = bf ? '6 photos (Hood: 1 before+3 after, Back: 1 before+1 final)' : '4 photos per rickshaw (3 hood + 1 back panel)';
  else if (hT > 0) modeLine = bf ? (needH + ' hood photos (1 BEFORE + ' + hT + ' after)') : (hT + ' hood photos per rickshaw (back, left, right)');
  else if (bT > 0) modeLine = bf ? (needB + ' back panel photos (1 BEFORE + 1 final)') : (bT + ' back panel photo per rickshaw');
  else modeLine = 'No media type configured';
  html += '<div class="card"><h3>Capture vehicles</h3><div class="sub">'+modeLine+' · vehicle details + photos</div><button class="btn" '+((hT+bT)===0?'disabled':'')+' onclick="startCapture()">🛺 Add Vehicle</button></div>';
  html += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0">Aaj ke vehicles ('+vehCount+')</h3><button class="btn btn-g btn-sm" onclick="loadAssignment()" style="padding:5px 12px;font-size:11px">↻ Refresh</button></div>';
  if (!vehCount){ html += '<p style="color:var(--mu);font-size:12px;text-align:center;padding:18px 0">No vehicles captured yet today</p>'; }
  else {
    html += mergedVehicles.map(function(v){
      var hd = v.photos.filter(function(p){ return p.mode==='hood'; }).length;
      var bd = v.photos.filter(function(p){ return p.mode==='back_panel'; }).length;
      var complete = hd >= needH && bd >= needB;
      var statusCls = complete ? 'complete' : 'partial';
      var statusTxt = complete ? 'complete' : 'partial';
      var time = v.firstAt ? new Date(v.firstAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}) : '';
      var actionBtn = complete ? '' : '<button class="btn btn-w btn-sm" onclick="continueVehicle(\''+escapeHtml(v.key)+'\')" style="padding:6px 12px;font-size:11px">Continue →</button>';
      var details = '';
      if (hT > 0) details += 'Hood '+hd+'/'+hT;
      if (bT > 0) details += (details?' · ':'')+'Back '+bd+'/'+bT;
      var label = v.vehicle_number || '— (plate not detected)';
      // 🔒 PRIVACY: field app list mein party ka name/contact NAHI dikhega.
      //    Worker submit ke waqt bharta hai, par list mein sirf vehicle + photos + count.
      var photoThumbs = (v.photos||[]).filter(function(p){return p.public_url;}).slice(0,6).map(function(p){
        return '<img src="'+p.public_url+'" class="vthumb" onclick="event.stopPropagation();window.open(\''+p.public_url+'\',\'_blank\')">';
      }).join('');
      var expandId = 'vd-'+escapeHtml(v.key).replace(/[^a-zA-Z0-9]/g,'');
      return '<div class="vrow" onclick="toggleVehicleDetail(\''+expandId+'\')" style="cursor:pointer">'+
        '<div style="display:flex;justify-content:space-between;align-items:center;width:100%">'+
          '<div class="vi"><div class="num">'+escapeHtml(label)+'</div><div class="det">'+time+' · '+details+'</div></div>'+
          '<div class="va"><span class="pill '+statusCls+'">'+statusTxt+'</span>'+actionBtn+'</div>'+
        '</div>'+
        '<div class="vdetail" id="'+expandId+'" style="display:none">'+
          (photoThumbs ? '<div class="vthumbs">'+photoThumbs+'</div>' : '<div class="vdetail-info" style="color:var(--mu)">Photos loading…</div>')+
        '</div>'+
      '</div>';
    }).join('');
  }
  html += '</div>';
  html += '<div style="text-align:center;font-size:9px;color:#bbb;margin-top:20px;padding:10px;opacity:.6">'+APP_VERSION+' · '+BUILD_DATE+'</div>';
  $('home-content').innerHTML = html;
}

// ═══ GPS (v15.4.3 — 5-layer permission strategy) ═══
var gpsWatchId = null;
var gpsLastReportedStatus = null;

function watchGps(){
  if (isManualMode()){
    applyManualGps();
    $('gps-strip').className = 'gps';
    $('gps-strip').innerHTML = '<div class="live"></div><span>📍 Manual GPS · '+state.gps.lat.toFixed(5)+', '+state.gps.lng.toFixed(5)+' · anchor ±'+(state.campaign.gps_radius_m||50)+'m</span>';
    reportGpsStatus('manual_active');
    return;
  }
  if (gpsWatchId) return;
  if (!navigator.geolocation){
    $('gps-strip').className = 'gps warn';
    $('gps-strip').innerHTML = '<div class="live"></div><span>GPS not supported on this device</span>';
    reportGpsStatus('not_supported');
    return;
  }
  // ⚡ TWO-STAGE GPS (fast lock): pehle cached/network location turant lo
  // (maximumAge allow → instant agar phone ke paas recent location hai),
  // phir watchPosition se high-accuracy refine background mein.
  navigator.geolocation.getCurrentPosition(
    function(pos){ setGpsFromPosition(pos); reportGpsStatus('granted'); },
    function(err){
      // Stage 1 fail (no cached) → turant high-accuracy try, taaki fresh mile
      navigator.geolocation.getCurrentPosition(
        function(pos){ setGpsFromPosition(pos); reportGpsStatus('granted'); },
        function(err2){ handleGpsError(err2); },
        { enableHighAccuracy:true, maximumAge:0, timeout:12000 }
      );
    },
    { enableHighAccuracy:false, maximumAge:60000, timeout:4000 }   // Stage 1: fast, cached OK
  );
  // Background refine — accuracy badhata rahega bina worker ko rok ke
  gpsWatchId = navigator.geolocation.watchPosition(
    function(pos){ setGpsFromPosition(pos); },
    function(err){ handleGpsError(err); },
    { enableHighAccuracy:true, maximumAge:3000, timeout:20000 }
  );
}

// ⭐ Layer 3: Smart GPS error handler with auto-fallback
function handleGpsError(err){
  console.warn('[GPS v15.4.3] Error:', err.code, err.message);
  
  // PERMISSION_DENIED = 1, POSITION_UNAVAILABLE = 2, TIMEOUT = 3
  if (err.code === 1){
    // Permission denied — try auto-fallback to manual GPS if campaign supports it
    if (hasCampaignAnchor()){
      console.log('[GPS v15.4.3] Permission denied — auto-fallback to campaign anchor GPS');
      enableManualFallback();
      toast('📍 Manual GPS mode (campaign anchor)', 'warn');
      reportGpsStatus('denied_fallback_manual');
      return;
    }
    // No fallback possible — show setup modal
    $('gps-strip').className = 'gps warn';
    $('gps-strip').innerHTML = '<div class="live"></div><span>⚠️ GPS permission denied — tap to fix</span>';
    $('gps-strip').onclick = function(){ showGpsSetupModal(); };
    showGpsSetupModal();
    reportGpsStatus('denied');
  } else if (err.code === 2){
    // Position unavailable (GPS off on phone)
    $('gps-strip').className = 'gps warn';
    $('gps-strip').innerHTML = '<div class="live"></div><span>📡 Phone ka GPS on karo</span>';
    reportGpsStatus('unavailable');
  } else if (err.code === 3){
    // Timeout — retry silently
    $('gps-strip').className = 'gps warn';
    $('gps-strip').innerHTML = '<div class="live"></div><span>⏱️ GPS lock ho raha hai…</span>';
    reportGpsStatus('timeout');
  }
}

function hasCampaignAnchor(){
  // v15.5: per-member override OR campaign anchor counts as available anchor for fallback
  var ov = getActiveMemberOverride && getActiveMemberOverride();
  if (ov && ov.anchor_lat != null && ov.anchor_lng != null) return true;
  return !!(state.campaign && state.campaign.anchor_lat != null && state.campaign.anchor_lng != null);
}

function enableManualFallback(){
  if (!hasCampaignAnchor()) return false;
  // Treat as manual mode temporarily for this session
  state._manualFallback = true;
  applyManualGps();
  // v15.5: Show override badge if it's a per-member override
  var ov = getActiveMemberOverride();
  var src = ov || state.campaign;
  var label = ov ? '👤 Member-specific manual GPS' : '📍 Manual GPS (fallback)';
  $('gps-strip').className = 'gps';
  $('gps-strip').innerHTML = '<div class="live"></div><span>'+label+' · ±'+(src.gps_radius_m||50)+'m</span>';
  return true;
}

// Override isManualMode to also include fallback
var _originalIsManualMode = function(){
  return !!(state.campaign && state.campaign.manual_gps_enabled && state.campaign.anchor_lat != null && state.campaign.anchor_lng != null);
};

function setGpsFromPosition(pos){
  // v15.5: If per-member override is active for today, IGNORE real GPS and use manual anchor
  if (getActiveMemberOverride()){
    applyManualGps();
    var ov = getActiveMemberOverride();
    $('gps-strip').className = 'gps';
    $('gps-strip').innerHTML = '<div class="live"></div><span>👤 Member-specific manual · '+ (ov.anchor_address ? (ov.anchor_address.length > 40 ? ov.anchor_address.slice(0,40)+'…' : ov.anchor_address) : 'anchor set') +' · ±'+(ov.gps_radius_m||50)+'m</span>';
    return;
  }
  state.gps.lat = pos.coords.latitude;
  state.gps.lng = pos.coords.longitude;
  state.gps.accuracy = pos.coords.accuracy;
  state.gps._timestamp = Date.now();
  state.gps._isMemberOverride = false;
  $('gps-strip').className = 'gps';
  $('gps-strip').innerHTML = '<div class="live"></div><span>GPS locked · '+pos.coords.latitude.toFixed(5)+', '+pos.coords.longitude.toFixed(5)+' · ±'+Math.round(pos.coords.accuracy)+'m</span>';
  if (!state.gps.address || hasMovedSignificantly(pos.coords)){
    fetchReverseGeocode(pos.coords.latitude, pos.coords.longitude);
  }
}

function ensureFreshGps(){
  return new Promise(function(resolve){
    if (isManualMode()){ resolve(true); return; }
    if (!navigator.geolocation){ resolve(false); return; }
    // ⚡ SPEED: agar watchPosition se GPS already recent hai (≤8 sec purana),
    // dobara wait mat karo — turant use karo. Har photo pe 5s bachta hai.
    var last = state.gps._timestamp || 0;
    if (state.gps.lat != null && (Date.now() - last) < 8000){
      resolve(true); return;
    }
    var done = false;
    var timer = setTimeout(function(){ if (!done){ done = true; resolve(state.gps.lat != null); } }, 4000);
    navigator.geolocation.getCurrentPosition(function(pos){
      if (done) return; done = true; clearTimeout(timer);
      setGpsFromPosition(pos);
      resolve(true);
    }, function(){
      if (done) return; done = true; clearTimeout(timer);
      resolve(state.gps.lat != null);
    }, { enableHighAccuracy:true, maximumAge:4000, timeout:4000 });
  });
}

function hasMovedSignificantly(coords){
  var last = state.gps._lastGeocodeAt;
  if (!last) return true;
  var dLat = (coords.latitude - last.lat) * 111000;
  var dLng = (coords.longitude - last.lng) * 111000 * Math.cos(last.lat * Math.PI / 180);
  return Math.sqrt(dLat*dLat + dLng*dLng) > 80;
}

function fetchReverseGeocode(lat, lng){
  state.gps._lastGeocodeAt = { lat: lat, lng: lng };
  var url = 'https://us1.locationiq.com/v1/reverse?key='+CONFIG.locationIqToken+'&lat='+lat+'&lon='+lng+'&format=json&addressdetails=1';
  fetch(url).then(function(r){ return r.json(); }).then(function(d){
    state.gps.address = d.display_name;
    state.gps.addressObj = d.address || {};
    state.gps.city = (d.address && (d.address.city || d.address.town || d.address.village || d.address.suburb)) || '';
  }).catch(function(){
    fetch('https://nominatim.openstreetmap.org/reverse?format=json&lat='+lat+'&lon='+lng+'&zoom=18&addressdetails=1')
      .then(function(r){ return r.json(); }).then(function(d){
        state.gps.address = d.display_name;
        state.gps.addressObj = d.address || {};
        state.gps.city = (d.address && (d.address.city || d.address.town || d.address.village || d.address.suburb)) || '';
      }).catch(function(){});
  });
}

function stopGps(){ if (gpsWatchId !== null){ navigator.geolocation.clearWatch(gpsWatchId); gpsWatchId = null; } }

// v15.5: Get active per-member override (returns null if expired/inactive/missing)
function getActiveMemberOverride(){
  var ov = state.memberOverride;
  if (!ov) return null;
  if (ov.active === false) return null;
  if (ov.anchor_lat == null || ov.anchor_lng == null) return null;
  // Check date validity (treat null/missing as always valid)
  var today = todayStr();
  if (ov.valid_from && today < ov.valid_from) return null;
  if (ov.valid_to && today > ov.valid_to) return null;
  return ov;
}

function isManualMode(){
  // v15.5 PRIORITY 1: Per-member override (today within valid range)
  if (getActiveMemberOverride()) return true;
  // v15.4.3: Include fallback mode (when permission denied but campaign has anchor)
  if (state._manualFallback && hasCampaignAnchor()) return true;
  // LEGACY: campaign-wide manual GPS (only if NO per-member overrides exist anywhere on this campaign)
  // To respect strict per-member-only mode, set campaign.manual_gps_enabled=false on campaigns using overrides.
  return !!(state.campaign && state.campaign.manual_gps_enabled && state.campaign.anchor_lat != null && state.campaign.anchor_lng != null);
}

function applyManualGps(){
  if (!isManualMode()) return false;
  // v15.5 PRIORITY: Use per-member override if active, else fall back to campaign settings
  var override = getActiveMemberOverride();
  var src = override || state.campaign;
  var anchorLat = parseFloat(src.anchor_lat);
  var anchorLng = parseFloat(src.anchor_lng);
  var radiusM = parseInt(src.gps_radius_m) || 50;
  var radiusDeg = radiusM / 111320;
  var lngScale = 1 / Math.cos(anchorLat * Math.PI / 180);
  var angle = Math.random() * 2 * Math.PI;
  var dist = Math.sqrt(Math.random()) * radiusDeg;
  state.gps.lat = anchorLat + dist * Math.cos(angle);
  state.gps.lng = anchorLng + dist * Math.sin(angle) * lngScale;
  state.gps.accuracy = Math.max(8, Math.round(radiusM / 5));
  state.gps._timestamp = Date.now();
  state.gps._isManual = true;
  state.gps._isMemberOverride = !!override;  // tag for UI/debugging
  if (!state.gps.address){
    if (src.anchor_address) state.gps.address = src.anchor_address;
    fetchReverseGeocode(anchorLat, anchorLng);
  }
  return true;
}

// ═══ CAPTURE FLOW ═══
// Expected photo counts — before_photo ON pe har mode mein +1 (Before slot)
// Returns {hood, back} = kitne photos chahiye complete hone ke liye
function expectedCounts(){
  var hT = state.campaign.hood_photo_count || 0;
  var bT = state.campaign.back_panel_photo_count || 0;
  if (state.campaign.before_photo){
    if (hT > 0) hT = hT + 1;   // 3 after + 1 before = 4
    if (bT > 0) bT = bT + 1;   // 1 final + 1 before = 2
  }
  return { hood: hT, back: bT };
}

function buildSlotList(){
  var slots = [];
  var hT = state.campaign.hood_photo_count || 0;
  var bT = state.campaign.back_panel_photo_count || 0;
  var beforeOn = !!state.campaign.before_photo;
  var hoodLabels = ['Back', 'Left', 'Right', 'Front', 'Top'];

  // HOOD: agar before ON → pehle 1 Before slot, phir After slots
  if (hT > 0){
    if (beforeOn){
      slots.push({ key: 'hood_before', mode: 'hood', n: 0, pt: 'before', label: 'BEFORE — Hood (khaali vehicle)' });
    }
    for (var i = 1; i <= hT; i++){
      slots.push({ key: 'hood_'+i, mode: 'hood', n: i, pt: 'after', label: (beforeOn ? 'AFTER — ' : 'Hood ') + (hoodLabels[i-1] || i) });
    }
  }

  // BACK PANEL: agar before ON → pehle 1 Before, phir Final
  if (bT > 0){
    if (beforeOn){
      slots.push({ key: 'back_panel_before', mode: 'back_panel', n: 0, pt: 'before', label: 'BEFORE — Back Panel' });
    }
    for (var j = 1; j <= bT; j++){
      slots.push({ key: 'back_panel_'+j, mode: 'back_panel', n: j, pt: 'after', label: beforeOn ? 'AFTER — Back Panel' : (bT === 1 ? 'Back Panel' : 'Back Panel ' + j) });
    }
  }
  return slots;
}

window.startCapture = function(){
  if (!state.campaign) return toast('No campaign assigned','error');
  // v2 NAYA FLOW: PHOTOS PEHLE (dono mode) → saari photo complete → phir details.
  //   full_entry: photos ke baad name/contact/vehicle maangega.
  //   photo_only: photos ke baad seedha submit (details nahi).
  var afterSetup = function(){
    resetSession(false);
    enterCaptureScreen();   // hamesha seedha camera — photos pehle
  };
  if (fsApiSupported()){
    idb.getConfig('photo_dir_handle').then(function(existing){
      if (existing){
        ensurePhotoFolder().then(afterSetup);
      } else {
        if (confirm('Ek baar ka setup:\n\nPhotos phone gallery mein bhi save karne ke liye ek folder choose karo (Pictures recommend).\n\nProceed?')){
          pickPhotoFolder().then(afterSetup);
        } else { _photoFolderState = 'denied'; afterSetup(); }
      }
    });
  } else { afterSetup(); }
};

// v2: worker ka entry mode — 'full_entry' (type kare) ya 'photo_only' (sirf photo, ANPAD)
function workerEntryMode(){
  var m = state.member && state.member.field_entry_mode;
  return (m === 'full_entry') ? 'full_entry' : 'photo_only';  // default photo_only = safe
}

// ═══════════════════════════════════════════════════════════════
// v2: VEHICLE ENTRY SCREEN (owner name + contact + number + duplicate check)
// ═══════════════════════════════════════════════════════════════
function adminFlags(){
  var c = state.campaign || {};
  // default true agar column missing (defensive)
  var reqName = (c.require_owner_name !== false);
  var reqContact = (c.require_owner_contact !== false);
  var reqNumber = (c.require_vehicle_number !== false);
  var blockDup = (c.block_duplicate_vehicle !== false);
  return { reqName: reqName, reqContact: reqContact, reqNumber: reqNumber, blockDup: blockDup };
}

function cleanVehicleNumber(raw){
  // SIRF space hatao + uppercase. Koi format/length control NAHI.
  return String(raw || '').toUpperCase().replace(/\s+/g, '');
}

// NAYA: Details screen — photos ke BAAD dikhta (name/contact/vehicle) → submit
function enterDetailsScreen(){
  var f = adminFlags();
  var html = '';
  html += '<div class="ve-wrap">';
  html += '<div class="ve-title">✅ Photos ho gayi — ab details</div>';
  html += '<div class="ve-sub">Vehicle ki details bharo, phir submit · verifier baad mein confirm karega</div>';

  // photo count badge (kitni photos li)
  var pc = Object.keys(state.photos).length + Object.keys(state.serverPhotoUrls).length;
  html += '<div class="ve-photobadge">📸 '+pc+' photos ready</div>';

  if (f.reqName){
    html += '<div class="ve-field"><label>👤 Vehicle Owner Name</label>'+
            '<input id="ve-name" class="ve-inp" placeholder="Owner ka naam" autocomplete="off" value="'+escapeHtml(state.ownerName||'')+'" oninput="veOnInput()"></div>';
  }
  if (f.reqContact){
    html += '<div class="ve-field"><label>📞 Owner Contact</label>'+
            '<input id="ve-contact" class="ve-inp" inputmode="numeric" maxlength="10" placeholder="10 digit number" autocomplete="off" value="'+escapeHtml(state.contactNumber||'')+'" oninput="veCleanContact(this);veOnInput()">'+
            '<div class="ve-hint" id="ve-contact-hint">10 digit lock</div></div>';
  }
  if (f.reqNumber){
    html += '<div class="ve-field"><label>🛺 Vehicle Number</label>'+
            '<input id="ve-num" class="ve-inp ve-mono" maxlength="14" placeholder="MH12AU1234" autocomplete="off" value="'+escapeHtml(state.vehicleNumber||'')+'" oninput="veCleanNum(this);veOnInput()">'+
            '<div class="ve-hint" id="ve-num-hint">Space hatega + UPPERCASE</div></div>';
  }

  html += '<div class="ve-dup" id="ve-dup" style="display:none"></div>';

  html += '<div class="ve-actions">';
  html += '<button class="btn btn-g" onclick="backToCamera()">← Photos</button>';
  html += '<button class="btn btn-primary" id="ve-next" onclick="detailsSubmit()" disabled>✅ Submit Vehicle</button>';
  html += '</div>';
  html += '</div>';

  var box = $('entry-content');
  if (box){ box.innerHTML = html; }
  showScreen('screen-entry');
  // persist resume state — details screen tak pahunche
  persistResumeState('details');
  setTimeout(function(){
    veOnInput();  // agar values already hai (resume) toh button enable
    var el = $('ve-name') || $('ve-contact') || $('ve-num'); if (el) el.focus();
  }, 100);
}

// Details submit — validate → save vehicle
window.detailsSubmit = function(){
  state.ownerName = $('ve-name') ? $('ve-name').value.trim() : '';
  state.contactNumber = $('ve-contact') ? $('ve-contact').value.trim() : '';
  state.vehicleNumber = $('ve-num') ? cleanVehicleNumber($('ve-num').value) : '';
  // details required — validate
  var f = adminFlags();
  if (f.reqName && !state.ownerName) return toast('Owner name chahiye','error');
  if (f.reqContact && (!state.contactNumber || state.contactNumber.length !== 10)) return toast('10 digit contact chahiye','error');
  if (f.reqNumber && !state.vehicleNumber) return toast('Vehicle number chahiye','error');
  clearResumeState();
  finishVehicleSession();
};

// Photos pe wapas (details se back)
window.backToCamera = function(){
  enterCaptureScreen();
};

// NOTE: purana enterEntryScreen (details-first) HATA diya — ab photos-first flow.
// Details ke liye enterDetailsScreen use hota hai (photos ke BAAD).

window.cancelEntry = function(){
  showScreen('screen-home');
  loadAssignment();
};

window.veCleanContact = function(el){
  el.value = String(el.value || '').replace(/[^0-9]/g, '').slice(0,10);
};

window.veCleanNum = function(el){
  el.value = cleanVehicleNumber(el.value);
};

var _veDupTimer = null;
window.veOnInput = function(){
  var f = adminFlags();
  var name = $('ve-name') ? $('ve-name').value.trim() : '';
  var contact = $('ve-contact') ? $('ve-contact').value.trim() : '';
  var num = $('ve-num') ? $('ve-num').value.trim() : '';

  var ready = true;
  if (f.reqName && !name) ready = false;
  if (f.reqContact && contact.length !== 10) ready = false;
  if (f.reqNumber && num.length === 0) ready = false;

  var nextBtn = $('ve-next');
  if (nextBtn) nextBtn.disabled = !ready;

  // duplicate check (debounced) — sirf jab number ho aur blockDup ON ho
  if (f.reqNumber && f.blockDup && num.length >= 3){
    if (_veDupTimer) clearTimeout(_veDupTimer);
    _veDupTimer = setTimeout(function(){ checkDuplicate(num); }, 350);
  } else {
    var dupBox = $('ve-dup'); if (dupBox) dupBox.style.display = 'none';
  }
};

function checkDuplicate(num){
  if (!state.campaign) return;
  // campaign complete ho gayi to duplicate block nahi (woh vehicle dobara allowed)
  if (state.campaign.completed === true){ var d=$('ve-dup'); if(d) d.style.display='none'; return; }
  var ck = encodeURIComponent(state.campaign.key);
  var vn = encodeURIComponent(num.toUpperCase());
  api('/rest/v1/v_campaign_vehicle_done?campaign_key=eq.'+ck+'&vehicle_number=eq.'+vn+'&select=*')
    .then(function(rows){
      var dupBox = $('ve-dup');
      if (rows && rows.length && rows[0].photo_count > 0){
        var r = rows[0];
        var html = '<div class="ve-dup-head">⛔ Already branded — is campaign mein</div>'+
          '<div class="ve-dup-body">Yeh vehicle is campaign mein pehle se branded hai ('+r.photo_count+' photos). Campaign complete hone tak dobara accept nahi hoga.</div>';
        // show their photos
        html += '<div class="ve-dup-pics" id="ve-dup-pics">Loading photos…</div>';
        if (dupBox){ dupBox.innerHTML = html; dupBox.style.display = 'block'; }
        loadDuplicatePhotos(num);
        var nextBtn = $('ve-next'); if (nextBtn) nextBtn.disabled = true;  // BLOCK
      } else {
        if (dupBox) dupBox.style.display = 'none';
      }
    }).catch(function(e){ console.warn('[dupcheck] failed (non-fatal):', e); });
}

function loadDuplicatePhotos(num){
  var ck = encodeURIComponent(state.campaign.key);
  var vn = encodeURIComponent(num.toUpperCase());
  api('/rest/v1/trial_photos?campaign_key=eq.'+ck+'&vehicle_number=eq.'+vn+'&deleted_at=is.null&rejected=eq.false&select=public_url,mode,photo_type&order=captured_at.asc&limit=6')
    .then(function(rows){
      var box = $('ve-dup-pics'); if (!box) return;
      if (!rows || !rows.length){ box.innerHTML = ''; return; }
      box.innerHTML = rows.map(function(p){
        return '<a href="'+p.public_url+'" target="_blank" class="ve-dup-pic" style="background-image:url('+p.public_url+')"><span>'+escapeHtml(p.mode||'')+'</span></a>';
      }).join('');
    }).catch(function(){});
}

// NOTE: purana entryNext (details-first ka button handler) HATA diya — photos-first flow.

// Adhura vehicle wapas resume karo
window.resumeVehicle = function(){
  var snap = getResumeState();
  if (!snap) { toast('Resume data nahi mila','error'); renderHome(); return; }
  var go = function(){
    resetSession(true);
    state.sessionId = snap.sessionId || state.sessionId;
    state.vehicleNumber = snap.vehicleNumber || '';
    state.ownerName = snap.ownerName || '';
    state.contactNumber = snap.contactNumber || '';
    state.serverPhotoUrls = snap.serverPhotoUrls || {};
    var allFilled = state.slots.every(function(s){ return state.serverPhotoUrls[s.key]; });
    if (snap.screen === 'details' && allFilled){ enterDetailsScreen(); }
    else { enterCaptureScreen(); }
    processQueue();
  };
  if (fsApiSupported()){
    idb.getConfig('photo_dir_handle').then(function(existing){
      if (existing){ ensurePhotoFolder().then(go).catch(go); } else { go(); }
    }).catch(go);
  } else { go(); }
};

window.discardResume = function(){
  if (!confirm('Adhura vehicle discard karein? Jo photos li thi woh server pe rahengi par yeh session hata denge.')) return;
  clearResumeState();
  renderHome();
  toast('Discard ho gaya','ok');
};

// List mein vehicle pe click → details + photos expand/collapse
window.toggleVehicleDetail = function(id){
  var el = document.getElementById(id);
  if (!el) return;
  el.style.display = (el.style.display === 'block') ? 'none' : 'block';
};

window.continueVehicle = function(key){
  var veh = state.todayVehicles.find(function(v){ return v.key === key; });
  if (!veh) return toast('Vehicle not found','error');
  resetSession(true);
  state.vehicleNumber = veh.vehicle_number;
  state.ownerName = veh.owner_name || '';
  state.contactNumber = veh.contact_number || '';
  veh.photos.forEach(function(p){
    var k = (p.photo_type === 'before') ? (p.mode + '_before') : (p.mode + '_' + p.photo_number);
    state.serverPhotoUrls[k] = p.public_url;
  });
  enterCaptureScreen();
};

function resetSession(isResume){
  state.slots = buildSlotList();
  state.photos = {};
  state.vehicleNumber = '';
  state.ownerName = '';
  state.contactNumber = '';
  state.sessionId = genSessionId();
  state.resumeMode = !!isResume;
  if (!isResume) state.serverPhotoUrls = {};
}

function enterCaptureScreen(){
  var ob = $('ocr-banner'); if (ob) ob.style.display = 'none';
  // v2: show entered vehicle number on capture screen header
  var vh = $('capture-vehicle');
  if (vh){
    var parts = [];
    if (state.vehicleNumber) parts.push('🛺 ' + escapeHtml(state.vehicleNumber));
    if (state.ownerName) parts.push('👤 ' + escapeHtml(state.ownerName));
    vh.innerHTML = parts.join(' · ') || 'Vehicle';
    vh.style.display = parts.length ? 'block' : 'none';
  }
  $('session-count').textContent = state.todayCount;
  renderPhotoGrid();
  showScreen('screen-capture');
  $('capture-actions').style.display = 'flex';
  watchGps();
  updateSessionStatus();
}

function getNextSlotKey(){
  for (var i = 0; i < state.slots.length; i++){
    var s = state.slots[i];
    if (!state.photos[s.key] && !state.serverPhotoUrls[s.key]) return s.key;
  }
  return null;
}

function renderPhotoGrid(){
  if (!state.slots.length){ $('photo-grid-wrap').innerHTML = ''; return; }
  var nextKey = getNextSlotKey();
  var html = state.slots.map(function(s){
    var photo = state.photos[s.key];
    var serverUrl = state.serverPhotoUrls[s.key];
    var cls = 'slot';
    var content;
    if (photo){
      cls += ' done';
      content = '<div class="badge">'+escapeHtml(s.label)+'</div><div class="check">✓</div><img src="'+photo.previewUrl+'" alt="">';
    } else if (serverUrl){
      cls += ' done locked';
      content = '<div class="badge">'+escapeHtml(s.label)+'</div><div class="check">✓</div><img src="'+escapeHtml(serverUrl)+'" alt="" loading="lazy">';
    } else {
      if (s.key === nextKey) cls += ' next';
      content = '<div class="badge">'+escapeHtml(s.label)+'</div><div style="font-size:30px;margin-bottom:6px">📷</div><div>Tap to capture</div>';
    }
    var click = (photo || serverUrl) ? '' : 'onclick="capturePhoto(\''+s.key+'\')"';
    return '<div class="'+cls+'" '+click+'>'+content+'</div>';
  }).join('');
  var gridCls = state.slots.length === 1 ? 'grid single' : 'grid';
  $('photo-grid-wrap').innerHTML = '<div class="'+gridCls+'">'+html+'</div>';
}

window.capturePhoto = function(key){
  if (isManualMode()){
    applyManualGps(); touchActivity();
    state._capturingKey = key;
    openInAppCamera(key);
    return;
  }
  if (state.gps.lat == null || state.gps.lng == null){
    toast('GPS lock ho raha hai — 3 sec wait karo', 'warn');
    if (navigator.geolocation){
      navigator.geolocation.getCurrentPosition(function(pos){
        state.gps.lat = pos.coords.latitude;
        state.gps.lng = pos.coords.longitude;
        state.gps.accuracy = pos.coords.accuracy;
        if (!state.gps.address) fetchReverseGeocode(pos.coords.latitude, pos.coords.longitude);
        toast('GPS lock! Photo le sakte ho ab', 'success');
      }, function(){ toast('GPS error — phone GPS on hai?', 'error'); }, { enableHighAccuracy:true, maximumAge:5000, timeout:10000 });
    }
    return;
  }
  touchActivity();
  state._capturingKey = key;
  openInAppCamera(key);
};

// ═══ IN-APP CAMERA ═══
var camStream = null;
var camStampTimer = null;
var camZoomState = {
  videoTrack: null, capabilities: null,
  currentZoom: 0.0, maxZoom: 4.0, minZoom: 0.0, stepZoom: 0.1,
  initialPinchDistance: 0, initialZoom: 0.0,
  isPinching: false, zoomHideTimer: null,
  torchOn: false, torchSupported: false
};

// ⭐ v15.4.6: Auto-flash — ambient brightness detect karke torch on/off
// Video frame ka average brightness sample karta hai (0-255)
function sampleBrightness(video){
  try {
    var c = document.createElement('canvas');
    var w = 64, h = 48;  // chhota sample = fast
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    ctx.drawImage(video, 0, 0, w, h);
    var data = ctx.getImageData(0, 0, w, h).data;
    var sum = 0, n = 0;
    for (var i = 0; i < data.length; i += 4){
      // luminance approx (0.3R + 0.59G + 0.11B)
      sum += (data[i]*0.3 + data[i+1]*0.59 + data[i+2]*0.11);
      n++;
    }
    return n ? (sum / n) : 255;
  } catch(e){ console.warn('[FLASH] brightness sample failed:', e); return 255; }
}

function setTorch(on){
  var track = camZoomState.videoTrack;
  if (!track || !camZoomState.torchSupported) return Promise.resolve(false);
  return track.applyConstraints({ advanced: [{ torch: !!on }] })
    .then(function(){
      camZoomState.torchOn = !!on;
      console.log('[FLASH] torch', on ? 'ON' : 'OFF');
      var btn = document.getElementById('cam-flash-btn');
      if (btn) btn.classList.toggle('on', !!on);
      return true;
    })
    .catch(function(e){ console.warn('[FLASH] torch apply failed:', e); return false; });
}

// Auto-detect: andhera ho to torch on. BRIGHTNESS_THRESHOLD se kam = dark
function autoFlashCheck(video){
  if (!camZoomState.torchSupported) return;
  var brightness = sampleBrightness(video);
  console.log('[FLASH] ambient brightness:', Math.round(brightness));
  var DARK_THRESHOLD = 60;  // 0-255 scale; 60 se neeche = andhera
  if (brightness < DARK_THRESHOLD && !camZoomState.torchOn){
    setTorch(true);
    var btn = document.getElementById('cam-flash-btn');
    if (btn) btn.classList.add('auto');
  }
}

// ⭐ v15.4: Find and open ULTRA-WIDE rear camera (proper 0.5x equivalent)
//          Enhanced multi-strategy detection
// ⭐ v15.4.6: Permission fix — agar labels already available (permission pehle mila),
//             to extra getUserMedia pre-warm SKIP karo (double prompt avoid)
var _cachedCameraList = null;
function findUltraWideCamera() {
  return new Promise(function(resolve) {
    function pickFrom(devices){
      var cameras = devices.filter(function(d) { return d.kind === 'videoinput'; });
      _cachedCameraList = cameras;
      console.log('[CAM v15.4.6] Found', cameras.length, 'cameras');
      cameras.forEach(function(c, i) { console.log('  [' + i + ']', c.label || '(no label)'); });

      // PRIORITY 1: Explicit ultra-wide labels
      var ultraWide = cameras.find(function(c) {
        var lbl = (c.label || '').toLowerCase();
        var isRear = lbl.indexOf('back') >= 0 || lbl.indexOf('rear') >= 0;
        var isUltra = lbl.indexOf('ultra') >= 0 || lbl.indexOf('ultrawide') >= 0 ||
                      lbl.indexOf('ultra wide') >= 0 || lbl.indexOf('ultra-wide') >= 0 ||
                      lbl.indexOf('0.5') >= 0 || lbl.indexOf('0.6') >= 0;
        return isRear && isUltra;
      });
      if (ultraWide) {
        console.log('[CAM v15.4.6] ✅ ULTRA-WIDE FOUND:', ultraWide.label);
        resolve({ deviceId: ultraWide.deviceId, isUltraWide: true });
        return;
      }
      // PRIORITY 2: Wide rear
      var anyWide = cameras.find(function(c) {
        var lbl = (c.label || '').toLowerCase();
        return (lbl.indexOf('back') >= 0 || lbl.indexOf('rear') >= 0) && lbl.indexOf('wide') >= 0;
      });
      if (anyWide) {
        console.log('[CAM v15.4.6] ✅ WIDE rear found:', anyWide.label);
        resolve({ deviceId: anyWide.deviceId, isUltraWide: true });
        return;
      }
      // PRIORITY 3: Camera[2] on multi-cam phones (usually ultra-wide)
      if (cameras.length >= 3) {
        console.log('[CAM v15.4.6] Trying camera[2] as potential ultra-wide:', cameras[2].label);
        resolve({ deviceId: cameras[2].deviceId, isUltraWide: false, tryZoomMin: true });
        return;
      }
      // PRIORITY 4: Default rear
      var anyRear = cameras.find(function(c) {
        var lbl = (c.label || '').toLowerCase();
        return lbl.indexOf('back') >= 0 || lbl.indexOf('rear') >= 0;
      });
      if (anyRear) {
        console.log('[CAM v15.4.6] ⚠️ Using main rear:', anyRear.label);
        resolve({ deviceId: anyRear.deviceId, isUltraWide: false, tryZoomMin: true });
        return;
      }
      console.log('[CAM v15.4.6] ⚠️ No specific camera, fallback to facingMode');
      resolve(null);
    }

    // Pehle bina permission maange enumerate karo
    navigator.mediaDevices.enumerateDevices().then(function(devices){
      var cams = devices.filter(function(d){ return d.kind === 'videoinput'; });
      var hasLabels = cams.length > 0 && cams.some(function(c){ return c.label && c.label.length > 0; });
      if (hasLabels){
        // ✅ Permission pehle mila — labels available, extra getUserMedia SKIP (no double prompt)
        console.log('[CAM v15.4.6] Labels available — skipping pre-warm (no re-prompt)');
        pickFrom(devices);
      } else {
        // Pehli baar — permission ke liye ek pre-warm getUserMedia (labels paane ke liye)
        console.log('[CAM v15.4.6] No labels — pre-warm getUserMedia for permission');
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
          .then(function(tempStream) {
            tempStream.getTracks().forEach(function(t) { try { t.stop(); } catch(e){} });
            return navigator.mediaDevices.enumerateDevices();
          })
          .then(pickFrom)
          .catch(function(err) {
            console.warn('[CAM v15.4.6] Detection error:', err);
            resolve(null);
          });
      }
    }).catch(function(err){
      console.warn('[CAM v15.4.6] enumerate error:', err);
      resolve(null);
    });
  });
}

function openInAppCamera(key){
  var slot = state.slots.find(function(s){ return s.key === key; });
  $('cam-slot-label').textContent = slot ? slot.label : 'Capture';
  $('cam-modal').classList.add('show');
  $('cam-shutter').disabled = true;

  updateCamStampPreview();
  camStampTimer = setInterval(updateCamStampPreview, 1500);

  findUltraWideCamera().then(function(camChoice) {
    var constraints;
    if (camChoice && camChoice.deviceId) {
      constraints = {
        video: {
          deviceId: { exact: camChoice.deviceId },
          width: { ideal: 1920, max: 4096 },
          height: { ideal: 1440, max: 3072 },
          focusMode: { ideal: 'continuous' },
          whiteBalanceMode: { ideal: 'continuous' }
        },
        audio: false
      };
      console.log('[CAM v15.4] Opening device:', camChoice.deviceId.substring(0,12), camChoice.isUltraWide ? '(ULTRA-WIDE)' : '(rear, will try zoom min)');
    } else {
      constraints = {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920, max: 4096 },
          height: { ideal: 1440, max: 3072 }
        },
        audio: false
      };
      console.log('[CAM v15.4] Opening default rear (no deviceId)');
    }
    return navigator.mediaDevices.getUserMedia(constraints).then(function(stream) {
      return { stream: stream, camChoice: camChoice };
    });
  }).then(function(result) {
    var stream = result.stream;
    var camChoice = result.camChoice;
    camStream = stream;
    var v = $('cam-feed');
    v.srcObject = stream;
    v.onloadedmetadata = function(){
      v.play();
      $('cam-shutter').disabled = false;
      
      // ⭐ v15.4 FIX: ALWAYS try to set zoom to MIN (widest), regardless of camera
      var track = stream.getVideoTracks()[0];
      if (track && track.getCapabilities) {
        try {
          var caps = track.getCapabilities();
          console.log('[CAM v15.4] Track capabilities:', caps.zoom ? JSON.stringify(caps.zoom) : 'no zoom');
          if (caps.zoom) {
            // Always force minimum zoom (widest possible view)
            var targetZoom = caps.zoom.min;
            track.applyConstraints({ advanced: [{ zoom: targetZoom }] })
              .then(function() {
                camZoomState.currentZoom = targetZoom;
                camZoomState.minZoom = caps.zoom.min;
                camZoomState.maxZoom = caps.zoom.max || 4.0;
                camZoomState.stepZoom = caps.zoom.step || 0.1;
                console.log('[CAM v15.4] ✅ Zoom forced to min:', targetZoom + 'x (widest)');
                updateZoomIndicator(targetZoom);
              })
              .catch(function(e) { console.warn('[CAM v15.4] Zoom apply failed:', e); });
          } else {
            console.log('[CAM v15.4] No zoom capability — using camera default FOV');
          }
        } catch (e) { console.warn('[CAM v15.4] Cap check failed:', e); }
      }
      
      setupPinchToZoom(stream);

      // ⭐ v15.4.6: Torch capability detect + auto-flash (andhera ho to on)
      try {
        var fTrack = stream.getVideoTracks()[0];
        camZoomState.videoTrack = fTrack;
        var fCaps = (fTrack && fTrack.getCapabilities) ? fTrack.getCapabilities() : null;
        camZoomState.torchSupported = !!(fCaps && fCaps.torch);
        var flashBtn = document.getElementById('cam-flash-btn');
        if (flashBtn){ flashBtn.style.display = camZoomState.torchSupported ? 'flex' : 'none'; flashBtn.classList.remove('on','auto'); }
        camZoomState.torchOn = false;
        if (camZoomState.torchSupported){
          // Thoda wait — camera auto-exposure settle hone do, phir brightness check
          setTimeout(function(){ autoFlashCheck(v); }, 900);
        } else {
          console.log('[FLASH] torch not supported on this camera');
        }
      } catch(e){ console.warn('[FLASH] setup failed:', e); }
    };
  }).catch(function(err){
    console.error('Camera open failed:', err);
    if (err.name === 'OverconstrainedError' || err.name === 'NotReadableError') {
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        .then(function(stream){
          camStream = stream;
          var v = $('cam-feed'); v.srcObject = stream;
          v.onloadedmetadata = function(){
            v.play(); $('cam-shutter').disabled = false;
            // Try zoom min on fallback stream too
            var track = stream.getVideoTracks()[0];
            if (track && track.getCapabilities) {
              try {
                var caps = track.getCapabilities();
                if (caps.zoom) {
                  track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] })
                    .then(function() { console.log('[CAM v15.4 fallback] Zoom set to min:', caps.zoom.min); })
                    .catch(function(){});
                }
              } catch(e){}
            }
            setupPinchToZoom(stream);
          };
        }).catch(function(){
          toast('Camera permission denied — falling back', 'error');
          closeInAppCamera(); $('cam-input').click();
        });
    } else {
      toast('Camera permission denied — falling back', 'error');
      closeInAppCamera(); $('cam-input').click();
    }
  });
}

function setupPinchToZoom(stream) {
  try {
    var track = stream.getVideoTracks()[0];
    if (!track) return;
    camZoomState.videoTrack = track;
    var capabilities = track.getCapabilities ? track.getCapabilities() : null;
    if (capabilities && capabilities.zoom) {
      camZoomState.capabilities = capabilities;
    } else {
      camZoomState.capabilities = null;
      camZoomState.minZoom = 1.0; camZoomState.maxZoom = 4.0;
      camZoomState.currentZoom = 1.0;
    }
    var video = $('cam-feed');
    video.addEventListener('touchstart', onPinchStart, { passive: false });
    video.addEventListener('touchmove', onPinchMove, { passive: false });
    video.addEventListener('touchend', onPinchEnd, { passive: false });
  } catch (e) {}
}

function getPinchDistance(touches) {
  var dx = touches[0].clientX - touches[1].clientX;
  var dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function onPinchStart(e) {
  if (e.touches.length !== 2) return;
  e.preventDefault();
  camZoomState.isPinching = true;
  camZoomState.initialPinchDistance = getPinchDistance(e.touches);
  camZoomState.initialZoom = camZoomState.currentZoom;
  showZoomIndicator();
}

function onPinchMove(e) {
  if (!camZoomState.isPinching || e.touches.length !== 2) return;
  e.preventDefault();
  var currentDistance = getPinchDistance(e.touches);
  var scale = currentDistance / camZoomState.initialPinchDistance;
  var newZoom = camZoomState.initialZoom * scale;
  newZoom = Math.max(camZoomState.minZoom, Math.min(camZoomState.maxZoom, newZoom));
  newZoom = Math.round(newZoom / camZoomState.stepZoom) * camZoomState.stepZoom;
  applyZoom(newZoom);
}

function onPinchEnd(e) {
  if (e.touches.length < 2) {
    camZoomState.isPinching = false;
    if (camZoomState.zoomHideTimer) clearTimeout(camZoomState.zoomHideTimer);
    camZoomState.zoomHideTimer = setTimeout(hideZoomIndicator, 1500);
  }
}

function applyZoom(zoomLevel) {
  camZoomState.currentZoom = zoomLevel;
  if (camZoomState.capabilities && camZoomState.videoTrack) {
    camZoomState.videoTrack.applyConstraints({ advanced: [{ zoom: zoomLevel }] })
      .catch(function() { applyCssDigitalZoom(zoomLevel); });
  } else {
    applyCssDigitalZoom(zoomLevel);
  }
  updateZoomIndicator(zoomLevel);
}

function applyCssDigitalZoom(zoomLevel) {
  var video = $('cam-feed');
  video.style.transform = 'scale(' + zoomLevel + ')';
  video.style.transformOrigin = 'center center';
}

function showZoomIndicator() { var ind = $('cam-zoom-indicator'); if (ind) ind.classList.add('show'); }
function hideZoomIndicator() { var ind = $('cam-zoom-indicator'); if (ind) ind.classList.remove('show'); }
function updateZoomIndicator(zoomLevel) {
  var ind = $('cam-zoom-indicator');
  if (ind) ind.textContent = zoomLevel.toFixed(1) + 'x';
  if (camZoomState.zoomHideTimer) clearTimeout(camZoomState.zoomHideTimer);
  camZoomState.zoomHideTimer = setTimeout(hideZoomIndicator, 1500);
}

function updateCamStampPreview(){
  var chip = $('cam-gps-chip');
  var chipTxt = $('cam-gps-txt');
  if (isManualMode()){
    chip.className = 'cam-gps';
    chipTxt.textContent = 'Manual ±'+(state.campaign.gps_radius_m||50)+'m';
  } else if (state.gps.lat != null && state.gps.lng != null){
    chip.className = 'cam-gps';
    chipTxt.textContent = '±' + Math.round(state.gps.accuracy || 0) + 'm';
  } else {
    chip.className = 'cam-gps warn';
    chipTxt.textContent = 'Locating…';
  }
  var a = state.gps.addressObj || {};
  var city = a.city || a.town || a.village || a.suburb || a.county || '—';
  var stateName = a.state || '';
  var country = a.country || 'India';
  var cityLine = [city, stateName, country].filter(Boolean).join(', ');
  $('cam-stamp-city').innerHTML = escapeHtml(cityLine) + ' <span class="flag"></span>';
  var addr = state.gps.address || 'Getting address…';
  if (a.postcode && addr.indexOf(a.postcode) === -1) addr += ', ' + a.postcode;
  $('cam-stamp-addr').textContent = addr;
  var lat = state.gps.lat ? state.gps.lat.toFixed(6) : '—';
  var lng = state.gps.lng ? state.gps.lng.toFixed(6) : '—';
  $('cam-stamp-latlng').textContent = 'Lat ' + lat + '°  Long ' + lng + '°';
  var now = new Date();
  var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  var dayName = days[now.getDay()];
  var dd = String(now.getDate()).padStart(2,'0');
  var mm = String(now.getMonth()+1).padStart(2,'0');
  var yyyy = now.getFullYear();
  var hh = now.getHours();
  var min = String(now.getMinutes()).padStart(2,'0');
  var ampm = hh >= 12 ? 'PM' : 'AM';
  hh = ((hh + 11) % 12) + 1;
  $('cam-stamp-dt').textContent = dayName + ', ' + dd + '/' + mm + '/' + yyyy + ' ' + String(hh).padStart(2,'0') + ':' + min + ' ' + ampm;
}

// ⭐ v15.4.6: Manual flash toggle (auto ke saath — worker khud control kar sake)
window.toggleFlash = function(){
  if (!camZoomState.torchSupported){ toast('Is camera mein flash nahi hai','warn'); return; }
  var btn = document.getElementById('cam-flash-btn');
  if (btn) btn.classList.remove('auto');
  setTorch(!camZoomState.torchOn);
};

function captureFromInAppCamera(){
  var v = $('cam-feed');
  if (!v.videoWidth || !v.videoHeight){ toast('Camera not ready','warn'); return; }
  $('cam-shutter').disabled = true;
  var canvas = document.createElement('canvas');
  canvas.width = v.videoWidth;
  canvas.height = v.videoHeight;
  canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
  canvas.toBlob(function(blob){
    if (!blob){ toast('Capture failed','error'); $('cam-shutter').disabled = false; return; }
    var capturedFile = new File([blob], 'capture-'+Date.now()+'.jpg', { type: 'image/jpeg' });
    closeInAppCamera();
    processCapturedFile(capturedFile);
  }, 'image/jpeg', 0.92);
}

function closeInAppCamera(){
  $('cam-modal').classList.remove('show');
  // ⭐ v15.4.6: Torch OFF before stopping stream (cleanup)
  if (camStream && camZoomState.torchOn){
    try {
      var tt = camStream.getVideoTracks()[0];
      if (tt) tt.applyConstraints({ advanced: [{ torch: false }] }).catch(function(){});
    } catch(e){}
    camZoomState.torchOn = false;
  }
  if (camStream){
    camStream.getTracks().forEach(function(t){ try{ t.stop(); } catch(e){} });
    camStream = null;
  }
  if (camStampTimer){ clearInterval(camStampTimer); camStampTimer = null; }
  var v = $('cam-feed');
  if (v.srcObject){ v.srcObject = null; }
  if (v) {
    v.style.transform = '';
    v.removeEventListener('touchstart', onPinchStart);
    v.removeEventListener('touchmove', onPinchMove);
    v.removeEventListener('touchend', onPinchEnd);
  }
  camZoomState.videoTrack = null;
  camZoomState.currentZoom = 0.0;
  hideZoomIndicator();
  if (camZoomState.zoomHideTimer) { clearTimeout(camZoomState.zoomHideTimer); camZoomState.zoomHideTimer = null; }
}

function processCapturedFile(file){
  var key = state._capturingKey;
  loader(true, 'Fresh GPS lock…');
  ensureFreshGps().then(function(){
    loader(true, 'Stamping GPS…');
    return stampGps(file);
  }).then(function(stamped){
    loader(false);
    state.photos[key] = { blob: stamped.blob, previewUrl: URL.createObjectURL(stamped.blob), originalBlob: file, _queued: false };
    renderPhotoGrid();
    saveToGallery(stamped.blob, key);
    // v2: OCR removed — vehicle number already entered on entry screen
    queuePhotoWhenReady(key);
    persistResumeState('capture');   // har photo ke baad resume snapshot save
    var allFilled = state.slots.every(function(s){ return state.photos[s.key] || state.serverPhotoUrls[s.key]; });
    if (allFilled){ setTimeout(afterPhotosComplete, 600); }
  }).catch(function(err){ loader(false); console.error(err); toast('Stamp error','error'); });
}

// NAYA FLOW: saari photos ho gayi → ab details maango (full_entry) ya seedha save (photo_only)
function afterPhotosComplete(){
  if (workerEntryMode() === 'full_entry'){
    enterDetailsScreen();   // photos complete — ab name/contact/vehicle
  } else {
    finishVehicleSession(); // photo_only — seedha save
  }
}

window.endSession = function(){
  if (Object.keys(state.photos).length > 0){
    if (!confirm('End session? Pending photos queue mein chale jayenge.')) return;
    Object.keys(state.photos).forEach(function(k){ if (!state.photos[k]._queued) queuePhoto(k); });
    stopGps();
    $('capture-actions').style.display = 'none';
    showScreen('screen-home');
    loadAssignment();
    startHomeAutoRefresh();
    return;
  }
  stopGps();
  $('capture-actions').style.display = 'none';
  showScreen('screen-home');
  loadAssignment();
  startHomeAutoRefresh();
};

$('cam-input').addEventListener('change', function(e){
  var file = e.target.files[0];
  if (!file) return;
  processCapturedFile(file);
  e.target.value = '';
});

// v2: runPlateOcr() and waitForOcr() removed — OCR no longer used.

// ═════════════════════════════════════════════════════════════════
// GPS STAMP v15.4 — FIX: All text fits, NO CUTOFF on right side
//   - Reserves 12px right padding (text never reaches edge)
//   - Wraps city/state intelligently if doesn't fit one line
//   - Reduces font size if needed instead of cutting
//   - Truncates with "..." only as last resort
// ═════════════════════════════════════════════════════════════════
function stampGps(file){
  return fileToImage(file).then(function(img){
    var canvas = document.createElement('canvas');
    var maxW = 1600;
    var scale = img.width > maxW ? maxW/img.width : 1;
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    var ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    var W = canvas.width, H = canvas.height;
    
    var oH = Math.round(H * 0.19);
    var oY = H - oH;
    var pad = Math.round(oH * 0.08);
    var mS = oH - 2*pad;
    
    // ⭐ v15.4 FIX: Right-side safety margin so text NEVER touches edge
    var rightSafety = Math.round(pad * 1.2);

    // Dark overlay
    ctx.fillStyle = 'rgba(13, 17, 33, 0.95)';
    ctx.fillRect(0, oY, W, oH);
    
    // Gold accent top border
    ctx.fillStyle = 'rgba(255, 184, 0, 0.5)';
    ctx.fillRect(0, oY, W, 2);

    // ━━━━━━━━━━━ MAP GRAPHIC (Google Maps style) ━━━━━━━━━━━
    var mX = pad, mY = oY + pad;
    
    ctx.fillStyle = '#F5F2E8';
    ctx.fillRect(mX, mY, mS, mS);
    
    ctx.fillStyle = '#C8E6C9';
    ctx.beginPath();
    ctx.ellipse(mX + mS * 0.75, mY + mS * 0.20, mS * 0.22, mS * 0.18, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#E5E2D9';
    ctx.fillRect(mX + Math.round(mS*0.05), mY + Math.round(mS*0.05), Math.round(mS*0.32), Math.round(mS*0.30));
    ctx.fillStyle = '#DDD9CE';
    ctx.fillRect(mX + Math.round(mS*0.55), mY + Math.round(mS*0.55), Math.round(mS*0.40), Math.round(mS*0.32));
    ctx.fillStyle = '#E0DDD3';
    ctx.fillRect(mX + Math.round(mS*0.05), mY + Math.round(mS*0.55), Math.round(mS*0.30), Math.round(mS*0.32));
    
    ctx.strokeStyle = '#D0CDC2';
    ctx.lineWidth = 1;
    ctx.strokeRect(mX + Math.round(mS*0.05), mY + Math.round(mS*0.05), Math.round(mS*0.32), Math.round(mS*0.30));
    ctx.strokeRect(mX + Math.round(mS*0.55), mY + Math.round(mS*0.55), Math.round(mS*0.40), Math.round(mS*0.32));
    
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(mX, mY + Math.round(mS*0.40), mS, Math.round(mS*0.10));
    ctx.fillRect(mX + Math.round(mS*0.42), mY, Math.round(mS*0.10), mS);
    
    ctx.strokeStyle = '#E8E5D8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(mX, mY + Math.round(mS*0.40)); ctx.lineTo(mX + mS, mY + Math.round(mS*0.40));
    ctx.moveTo(mX, mY + Math.round(mS*0.50)); ctx.lineTo(mX + mS, mY + Math.round(mS*0.50));
    ctx.stroke();
    
    ctx.fillStyle = '#A5D4E8';
    ctx.beginPath();
    ctx.moveTo(mX, mY + Math.round(mS*0.92));
    ctx.bezierCurveTo(mX + mS*0.3, mY + mS*0.90, mX + mS*0.7, mY + mS*0.94, mX + mS, mY + Math.round(mS*0.91));
    ctx.lineTo(mX + mS, mY + mS); ctx.lineTo(mX, mY + mS); ctx.closePath();
    ctx.fill();
    
    // Red pin
    var pCX = mX + mS/2;
    var pCY = mY + mS*0.42;
    var pR = mS*0.14;
    
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath();
    ctx.ellipse(pCX, pCY + pR*1.85, pR*0.75, pR*0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#EA4335';
    ctx.beginPath();
    ctx.arc(pCX, pCY, pR, Math.PI * 1.1, Math.PI * 1.9);
    ctx.lineTo(pCX, pCY + pR * 2.15);
    ctx.closePath();
    ctx.fill();
    
    ctx.strokeStyle = '#C5221F';
    ctx.lineWidth = pR * 0.08;
    ctx.beginPath();
    ctx.arc(pCX, pCY, pR * 0.92, Math.PI, 0);
    ctx.stroke();
    
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(pCX, pCY, pR * 0.42, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#5F6368';
    ctx.font = '700 ' + Math.round(mS*0.12) + 'px Arial, sans-serif';
    ctx.fillText('Google', mX + Math.round(mS*0.04), mY + mS - Math.round(mS*0.05));

    // ━━━━━━━━━━━ TEXT PANEL — v15.4 WIDTH-AWARE ━━━━━━━━━━━
    var tX = mX + mS + Math.round(pad * 1.5);
    // ⭐ v15.4 FIX: Subtract right safety from available width
    var tW = W - tX - rightSafety;

    // Build all the strings
    var now = new Date();
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var dayName = days[now.getDay()];
    var dd = String(now.getDate()).padStart(2,'0');
    var mm = String(now.getMonth()+1).padStart(2,'0');
    var yyyy = now.getFullYear();
    var hh = now.getHours();
    var min = String(now.getMinutes()).padStart(2,'0');
    var ampm = hh >= 12 ? 'PM' : 'AM';
    hh = ((hh + 11) % 12) + 1;
    var dateStr = dayName + ', ' + dd + '/' + mm + '/' + yyyy + ' ' + String(hh).padStart(2,'0') + ':' + min + ' ' + ampm + ' GMT+5:30';

    var lat = state.gps.lat ? state.gps.lat.toFixed(6) : '—';
    var lng = state.gps.lng ? state.gps.lng.toFixed(6) : '—';

    var a = state.gps.addressObj || {};
    var city = a.city || a.town || a.village || a.suburb || a.county || '';
    var stateName = a.state || '';
    var country = a.country || 'India';
    var cityLine = [city, stateName, country].filter(Boolean).join(', ') || '—';
    var addrText = state.gps.address || '';
    if (a.postcode && addrText.indexOf(a.postcode) === -1) addrText += ', ' + a.postcode;

    var cy = oY + pad + Math.round(oH*0.14);

    // ━━━ Helper: Truncate text with ellipsis if too wide ━━━
    function fitText(text, maxWidth, fontStr){
      ctx.font = fontStr;
      if (ctx.measureText(text).width <= maxWidth) return text;
      var truncated = text;
      while (truncated.length > 1 && ctx.measureText(truncated + '…').width > maxWidth){
        truncated = truncated.slice(0, -1);
      }
      return truncated + '…';
    }

    // ━━━ 1. City line (with flag — FIX: reserve flag space first) ━━━
    var flagW = Math.round(oH*0.16);
    var flagSpaceNeeded = flagW + Math.round(oH*0.10); // flag + gap
    
    // Available width for city text (minus flag space)
    var cityMaxW = tW - flagSpaceNeeded;
    var cityFontSize = Math.round(oH*0.14);
    var cityFontStr = '700 ' + cityFontSize + 'px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    
    // Try fitting cityLine. If too long, reduce font size, then truncate as last resort.
    ctx.font = cityFontStr;
    var cityFitted = cityLine;
    if (ctx.measureText(cityLine).width > cityMaxW){
      // Try smaller font
      var smallerSize = Math.round(oH*0.12);
      cityFontStr = '700 ' + smallerSize + 'px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
      ctx.font = cityFontStr;
      cityFontSize = smallerSize;
      if (ctx.measureText(cityLine).width > cityMaxW){
        // Still too long — truncate
        cityFitted = fitText(cityLine, cityMaxW, cityFontStr);
      }
    }
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = cityFontStr;
    ctx.fillText(cityFitted, tX, cy);
    
    // India flag (after city text)
    var cityW = ctx.measureText(cityFitted).width;
    var flagX = tX + cityW + Math.round(oH*0.08);
    var flagY = cy - Math.round(cityFontSize * 0.78);
    var flagH = Math.round(flagW*0.66);
    
    // Only draw flag if it fits within safe zone
    if (flagX + flagW <= W - rightSafety){
      ctx.fillStyle = '#FF9933'; 
      ctx.fillRect(flagX, flagY, flagW, Math.round(flagH/3));
      ctx.fillStyle = '#FFFFFF'; 
      ctx.fillRect(flagX, flagY + Math.round(flagH/3), flagW, Math.round(flagH/3));
      ctx.fillStyle = '#138808'; 
      ctx.fillRect(flagX, flagY + Math.round(2*flagH/3), flagW, flagH - Math.round(2*flagH/3));
      ctx.strokeStyle = '#000080';
      ctx.lineWidth = Math.max(1, Math.round(flagH * 0.05));
      ctx.beginPath();
      ctx.arc(flagX + flagW/2, flagY + flagH/2, flagH * 0.20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(0,0,0,0.2)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(flagX, flagY, flagW, flagH);
    }

    cy += Math.round(oH*0.17);

    // ━━━ 2. Address — multi-line with proper wrapping ━━━
    var addrFontSize = Math.round(oH*0.095);
    var addrFontStr = '400 ' + addrFontSize + 'px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    ctx.fillStyle = '#E8EAED';
    ctx.font = addrFontStr;
    
    // Smart word wrapping — split by comma and space
    var words = addrText.split(/[, ]+/).filter(Boolean);
    var lines = [], cur = '';
    for (var i = 0; i < words.length; i++){
      var w = words[i];
      var test = cur ? cur + ', ' + w : w;
      if (ctx.measureText(test).width > tW && cur){
        lines.push(cur);
        cur = w;
        if (lines.length >= 2){
          // Already have 2 lines — put rest in line 2
          cur = words.slice(i).join(', ');
          break;
        }
      } else { 
        cur = test; 
      }
    }
    if (cur && lines.length < 2) lines.push(cur);
    while (lines.length < 2) lines.push('');
    
    // Ensure line 2 fits — if too long, truncate
    if (lines[1] && ctx.measureText(lines[1]).width > tW){
      lines[1] = fitText(lines[1], tW, addrFontStr);
    }
    if (lines[0] && ctx.measureText(lines[0]).width > tW){
      lines[0] = fitText(lines[0], tW, addrFontStr);
    }
    
    for (var j = 0; j < lines.length; j++){
      if (lines[j]) ctx.fillText(lines[j], tX, cy);
      cy += Math.round(oH*0.12);
    }
    
    // ━━━ 3. Lat/Long (monospace) — FIX: ensure fits ━━━
    var coordFontSize = Math.round(oH*0.095);
    var coordFontStr = '500 ' + coordFontSize + 'px "JetBrains Mono", "SF Mono", Consolas, monospace';
    var coordText = 'Lat ' + lat + '°  Long ' + lng + '°';
    var coordFitted = fitText(coordText, tW, coordFontStr);
    
    ctx.fillStyle = '#FFFFFF';
    ctx.font = coordFontStr;
    ctx.fillText(coordFitted, tX, cy);
    cy += Math.round(oH*0.12);
    
    // ━━━ 4. Date/Time — FIX: ensure fits ━━━
    var dtFontSize = Math.round(oH*0.085);
    var dtFontStr = '400 ' + dtFontSize + 'px -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    var dtFitted = fitText(dateStr, tW, dtFontStr);
    
    ctx.fillStyle = '#B0B6BE';
    ctx.font = dtFontStr;
    ctx.fillText(dtFitted, tX, cy);

    return new Promise(function(resolve){
      canvas.toBlob(function(blob){ resolve({ blob: blob, width: canvas.width, height: canvas.height }); }, 'image/jpeg', 0.88);
    });
  });
}

function fileToImage(file){
  return new Promise(function(res, rej){
    var img = new Image();
    img.onload = function(){ res(img); };
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

function buildPhotoMetadata(key){
  var slot = state.slots.find(function(s){ return s.key === key; });
  if (!slot) return null;
  var campaignSlug = slugify(state.campaign.key) || 'campaign';
  var dateSlug = todayStr();
  var memberSlug = slugify(state.member.name) || ('member-' + state.member.phone.slice(-4));
  var vehiclePlate = (state.vehicleNumber || '').replace(/\s+/g,'');
  var vehicleSlug = slugify(vehiclePlate) || 'novehicle';
  // ⭐ v2 CRITICAL: sessionId folder me daala → har vehicle ka path UNIQUE.
  // Same number 2 baar ho ya OCR-garbage same ho, sessionId alag hone se
  // path alag → koi overwrite nahi → koi duplicate DB row nahi.
  var sid = state.sessionId || genSessionId();
  var angle = getAngleName(slot);
  var filename = angle + '-' + vehicleSlug + '.jpg';
  var path = campaignSlug + '/' + dateSlug + '/' + memberSlug + '/' + sid + '/' + filename;
  var dbRow = {
    storage_path: path,
    campaign_key: state.campaign.key,
    member_phone: state.member.phone,
    member_name: state.member.name,
    vehicle_number: state.vehicleNumber || null,
    owner_name: state.ownerName || null,
    contact_number: state.contactNumber || null,
    capture_session_id: sid,
    mode: slot.mode,
    photo_number: slot.n,
    photo_type: slot.pt || 'after',
    total_expected: slot.mode === 'hood' ? (state.campaign.hood_photo_count||3) : (state.campaign.back_panel_photo_count||1),
    captured_at: new Date().toISOString(),
    latitude: state.gps.lat,
    longitude: state.gps.lng,
    address: state.gps.address,
    city: state.gps.city,
    app_version: APP_VERSION,
    rejected: false
  };
  return { storage_path: path, dbRow: dbRow };
}

function queuePhoto(key){
  var photo = state.photos[key];
  if (!photo || photo._queued) return;
  var meta = buildPhotoMetadata(key);
  if (!meta) return;
  photo._queued = true;
  idb.add({ blob: photo.blob, metadata: meta, status: 'pending', attempts: 0, queued_at: Date.now(), session_id: state.sessionId, slot_key: key })
    .then(function(){ updateSessionStatus(); processQueue(); })
    .catch(function(err){ console.error('Queue add failed:', err); photo._queued = false; });
}

function fsApiSupported(){ return typeof window.showDirectoryPicker === 'function'; }
// ⭐ v15.4.7: Photo folder permission — EK BAAR maango (location jaisा), phir koi popup nahi
//   _photoFolderState: 'unknown' | 'granted' | 'denied' (session-wide cache)
//   Ek baar granted → handle cache, dobara query/request NAHI (no repeat popup)
//   Ek baar denied/skip → session bhar gallery-save silent skip (server upload to ho hi raha)
var _photoFolderState = 'unknown';
var _photoFolderHandle = null;

function ensurePhotoFolder(){
  if (!fsApiSupported()) return Promise.resolve(null);

  // Already granted is session — cached handle do, koi permission check nahi (NO POPUP)
  if (_photoFolderState === 'granted' && _photoFolderHandle){
    return Promise.resolve(_photoFolderHandle);
  }
  // Already denied/skipped is session — silent skip (server upload still happening)
  if (_photoFolderState === 'denied'){
    return Promise.resolve(null);
  }

  // Pehli baar is session — handle nikaalो, ek baar permission check
  return idb.getConfig('photo_dir_handle').then(function(handle){
    if (!handle){ _photoFolderState = 'denied'; return null; }
    return handle.queryPermission({ mode:'readwrite' }).then(function(perm){
      if (perm === 'granted'){
        _photoFolderState = 'granted';
        _photoFolderHandle = handle;
        return handle;
      }
      // 'prompt' state — ek baar request karo (session mein sirf yahi ek baar)
      return handle.requestPermission({ mode:'readwrite' }).then(function(p2){
        if (p2 === 'granted'){
          _photoFolderState = 'granted';
          _photoFolderHandle = handle;
          return handle;
        }
        // User ne deny kiya — session bhar skip (ab koi popup nahi)
        _photoFolderState = 'denied';
        return null;
      }).catch(function(){
        _photoFolderState = 'denied';
        return null;
      });
    }).catch(function(){
      _photoFolderState = 'denied';
      return null;
    });
  }).catch(function(){ _photoFolderState = 'denied'; return null; });
}
function pickPhotoFolder(){
  if (!fsApiSupported()){
    toast('Browser puraana hai — Downloads folder use hoga','warn');
    return Promise.resolve(null);
  }
  return window.showDirectoryPicker({ mode: 'readwrite', id: 'prajapati-gps-photos', startIn: 'pictures' })
    .then(function(handle){
      return idb.setConfig('photo_dir_handle', handle).then(function(){
        _photoFolderState = 'granted';
        _photoFolderHandle = handle;
        toast('✓ Photo folder set! Ab silent save hoga','success');
        return handle;
      });
    }).catch(function(){
      _photoFolderState = 'denied';
      toast('Folder pick cancel — Downloads use hoga','warn');
      return null;
    });
}
function savePhotoToGallery(blob, filename){
  return ensurePhotoFolder().then(function(handle){
    if (handle){
      return handle.getFileHandle(filename, { create:true }).then(function(fh){
        return fh.createWritable().then(function(w){
          return w.write(blob).then(function(){ return w.close(); });
        });
      }).catch(function(err){
        console.warn('FS save failed, download fallback:', err);
        triggerDownload(blob, filename);
      });
    }
    // Folder handle nahi mila (FS API unsupported ya user ne folder set nahi kiya)
    // → download fallback se gallery/Downloads mein save karo (mobile + desktop dono)
    triggerDownload(blob, filename);
  });
}

// Mobile/Android detect — wahान File System API popups irritating hain
function isMobileLike(){
  try {
    return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
           (navigator.maxTouchPoints && navigator.maxTouchPoints > 1 && window.matchMedia('(display-mode: standalone)').matches);
  } catch(e){ return false; }
}
function triggerDownload(blob, filename){
  try {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 8000);
  } catch (e){ console.warn('Download trigger failed:', e); }
}
function saveToGallery(blob, key){
  try {
    var slot = state.slots.find(function(s){ return s.key === key; });
    var angle = slot ? getAngleName(slot) : 'photo';
    var dateStr = todayStr();
    var fname = 'prajapati-' + dateStr + '-' + state.sessionId + '-' + angle + '.jpg';
    return savePhotoToGallery(blob, fname);
  } catch (e){ console.warn('Gallery save failed:', e); }
}

function queuePhotoWhenReady(key){
  // photos-first flow: full_entry mode mein details PHOTOS KE BAAD aate hai.
  // Isliye capture pe abhi queue mat karo (owner/contact khali hai) —
  // finishVehicleSession (details submit ke baad) saari photos queue karega.
  // photo_only mode: koi details nahi → turant queue theek.
  if (workerEntryMode() === 'full_entry'){
    return;  // defer — finishVehicleSession will queue with details
  }
  queuePhoto(key);
}

function finishVehicleSession(){
  loader(true, 'Saving vehicle…');
  // ⭐ Ab details bhar chuke — saari photos ko owner/contact ke saath queue karo.
  //    (photos-first flow: capture ke time details khali the, isliye yahan queue.)
  Object.keys(state.photos).forEach(function(k){
    // re-queue with latest details (metadata owner/contact ab bhara hai)
    queuePhoto(k);
  });
  var plate = state.vehicleNumber || '— (review)';
  var vehicleKey = state.vehicleNumber || ('v-' + state.sessionId);
  state.sessionCaptures.push({
    key: vehicleKey,
    vehicle_number: state.vehicleNumber || '',
    owner_name: state.ownerName || '',
    contact_number: state.contactNumber || '',
    hood_count: state.slots.filter(function(s){return s.mode==='hood';}).length,
    back_count: state.slots.filter(function(s){return s.mode==='back_panel';}).length,
    captured_at: new Date().toISOString()
  });
  state.todayCount += 1;
  persistSessionCaptures();
  clearResumeState();   // vehicle complete — resume snapshot clear
  touchActivity();
  loader(false);
  $('flash-plate').textContent = plate;
  $('flash-meta').textContent = state.slots.length + ' photos saved · ' + (state.gps.city || 'GPS');
  $('flash').classList.add('show');
  setTimeout(function(){
    $('flash').classList.remove('show');
    // ⭐ NAYA FLOW: next vehicle bhi PHOTOS PEHLE → seedha camera (dono mode).
    //    Details baad mein aayenge (afterPhotosComplete se). Purana entry-screen NAHI.
    resetSession(false);
    enterCaptureScreen();
    processQueue();
  }, 1800);
}

// ═════════════════════════════════════════════════════════════════
// PWA: SERVICE WORKER + STRONG INSTALL + AGGRESSIVE AUTO-UPDATE (v15.4)
// ═════════════════════════════════════════════════════════════════

var deferredInstallPrompt = null;
var refreshing = false;
var pendingWorker = null;

function isIosSafari(){
  var ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) && /safari/.test(ua) && !/crios|fxios/.test(ua);
}
function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isAndroid(){ return /android/i.test(navigator.userAgent); }
function isChrome(){ return /chrome|crios/i.test(navigator.userAgent) && !/edg|opr/i.test(navigator.userAgent); }

// ⭐ FIELD-V2 FIX: SW registration field-v2.html mein handle hoti hai (sw-field-v2.js, scope /field-v2.html).
// Yeh purana field-1 block (sw-field.js, scope /field.html) DISABLE — warna field-v2 ka SW
// unregister hokar field-1 ka SW lag jaata tha (dono mix). Ab dono bilkul alag.
if (false && 'serviceWorker' in navigator) {
  window.addEventListener('load', function(){
    // First — clean up any wrong SW (admin SW that may have been wrongly installed)
    navigator.serviceWorker.getRegistrations().then(function(regs){
      var cleanupPromises = regs.map(function(reg){
        var url = (reg.active && reg.active.scriptURL) || '';
        if (url && url.indexOf('/sw-field.js') === -1){
          console.log('[PWA v15.4] Unregistering wrong SW:', url);
          return reg.unregister();
        }
        return Promise.resolve();
      });
      return Promise.all(cleanupPromises);
    }).then(function(){
      // Now register correct field SW
      return navigator.serviceWorker.register('/sw-field.js?v=' + APP_VERSION, { scope: '/field.html' });
    }).then(function(reg){
      console.log('[PWA v15.4] Field SW registered:', reg.scope);
      setInterval(function(){
        reg.update().catch(function(e){ console.warn('[PWA] Update check failed:', e); });
      }, CONFIG.swUpdateIntervalMs);
      setTimeout(function(){ reg.update(); }, 5000);
      
      reg.addEventListener('updatefound', function(){
        var newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', function(){
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller){
            // ⭐ v15.4.4 FIX: Suppress duplicate banner after recent user-triggered update
            var justUpdated = sessionStorage.getItem('pf_just_updated_at');
            if (justUpdated) {
              var elapsedMs = Date.now() - parseInt(justUpdated, 10);
              if (elapsedMs < 10 * 60 * 1000) {  // within last 10 min
                console.log('[PWA v15.4.4] Update banner suppressed — just updated ' + Math.round(elapsedMs/1000) + 's ago');
                return;
              }
              // 10+ min ago — clear flag, allow new banner
              sessionStorage.removeItem('pf_just_updated_at');
            }
            
            // ⭐ v15.4.4 FIX: Track last shown version to avoid same-version banner
            var lastShownVersion = sessionStorage.getItem('pf_banner_shown_version');
            var currentAppVersion = APP_VERSION;
            if (lastShownVersion === currentAppVersion) {
              console.log('[PWA v15.4.4] Banner already shown for version ' + currentAppVersion + ' — skipping');
              return;
            }
            sessionStorage.setItem('pf_banner_shown_version', currentAppVersion);
            
            pendingWorker = newWorker;
            $('update-banner').classList.add('show');
            console.log('[PWA v15.4.4] Update banner shown for version ' + currentAppVersion);
          }
        });
      });
    }).catch(function(err){
      console.warn('[PWA v15.4] SW register failed:', err);
    });
  });
  // ⭐ v15.4 FIX: SW reload loop prevention
  // Original bug: SW skipWaiting + clients.claim → controllerchange → reload
  //   → loop → looks like "auto login/logout"
  // Fix logic:
  //   1. Track if we had a controller BEFORE registration (real update)
  //   2. Only reload if controller was already there AND now changed
  //   3. Suppress repeated controllerchange events within 5 sec
  
  // Snapshot: did we have an active SW controller when page loaded?
  var hadControllerOnLoad = !!navigator.serviceWorker.controller;
  console.log('[PWA v15.4] Page loaded with controller:', hadControllerOnLoad);
  
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    if (refreshing) {
      console.log('[PWA v15.4.2] controllerchange ignored — already refreshing');
      return;
    }
    
    // ⭐ v15.4.2 FIX: User-triggered update ALWAYS reloads (bypass guards)
    if (sessionStorage.getItem('pf_user_triggered_update') === '1') {
      sessionStorage.removeItem('pf_user_triggered_update');
      refreshing = true;
      sessionStorage.setItem('pf_sw_last_reload', String(Date.now()));
      console.log('[PWA v15.4.2] User-triggered update — reloading now');
      window.location.reload();
      return;
    }
    
    // First install (no prior controller) — don't reload (avoids unnecessary flicker)
    if (!hadControllerOnLoad) {
      console.log('[PWA v15.4.2] First-time SW install — NOT reloading');
      hadControllerOnLoad = true;
      return;
    }
    
    // Auto-update loop guard (only for background updates, NOT user-triggered)
    var lastReload = parseInt(sessionStorage.getItem('pf_sw_last_reload') || '0');
    if (Date.now() - lastReload < 10000) {
      console.log('[PWA v15.4.2] controllerchange suppressed — reloaded ' + (Date.now() - lastReload) + 'ms ago');
      return;
    }
    
    // Background SW update with prior controller — reload once
    refreshing = true;
    sessionStorage.setItem('pf_sw_last_reload', String(Date.now()));
    console.log('[PWA v15.4.2] Background SW update — reloading');
    window.location.reload();
  });
  
  navigator.serviceWorker.addEventListener('message', function(event){
    if (event.data && event.data.type === 'SW_ACTIVATED'){
      var lastReload = parseInt(sessionStorage.getItem('pf_sw_last_reload') || '0');
      if (Date.now() - lastReload < 10000) {
        console.log('[PWA v15.4] SW_ACTIVATED suppressed (recent reload)');
        return;
      }
      if (!refreshing){
        refreshing = true;
        sessionStorage.setItem('pf_sw_last_reload', String(Date.now()));
        toast('🔄 Updating to new version…', 'success');
        setTimeout(function(){ window.location.reload(); }, 800);
      }
    }
  });
}

window.addEventListener('beforeinstallprompt', function(e){
  console.log('[PWA v15.4] beforeinstallprompt captured!');
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBar();
});

window.addEventListener('appinstalled', function(){
  console.log('[PWA v15.4] App installed!');
  toast('✅ App installed!', 'success');
  $('install-bar').classList.remove('show');
  deferredInstallPrompt = null;
});

function showInstallBar(){
  if (isStandalone()) {
    console.log('[PWA v15.4] Already standalone - no install bar');
    return;
  }
  if (localStorage.getItem('pf_install_dismissed_v15') === '1') {
    console.log('[PWA v15.4] User dismissed - skipping');
    return;
  }
  
  var bar = $('install-bar');
  if (!bar) return;
  
  if (isIosSafari()){
    bar.querySelector('.ib-sub').textContent = 'Share button → "Add to Home Screen"';
    bar.querySelector('.ib-btn.primary').textContent = 'How to install';
  } else if (deferredInstallPrompt) {
    bar.querySelector('.ib-sub').textContent = 'Home screen pe app jaisa add karo';
    bar.querySelector('.ib-btn.primary').textContent = 'Install';
  } else {
    bar.querySelector('.ib-sub').textContent = 'Chrome menu → "Install app" tap karo';
    bar.querySelector('.ib-btn.primary').textContent = 'Show me how';
  }
  
  bar.classList.add('show');
  console.log('[PWA v15.4] Install bar shown');
}

window.triggerInstall = function(){
  console.log('[PWA v15.4] Install button clicked');
  
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(function(choice){
      console.log('[PWA v15.4] Install choice:', choice.outcome);
      if (choice.outcome === 'accepted'){
        toast('Install ho raha hai…', 'success');
      }
      deferredInstallPrompt = null;
      $('install-bar').classList.remove('show');
    });
  } else if (isIosSafari()) {
    alert('iPhone/iPad par install karne ke liye:\n\n1️⃣ Safari ke neeche Share button tap karo (square with arrow)\n2️⃣ Scroll down → "Add to Home Screen"\n3️⃣ "Add" tap karo\n\nApp home screen pe install ho jayega!');
  } else if (isAndroid() && isChrome()) {
    alert('Chrome par install karne ke liye:\n\n1️⃣ Top-right me 3-dots menu tap karo\n2️⃣ "Install app" ya "Add to Home Screen" tap karo\n3️⃣ "Install" confirm karo\n\nApp install ho jayega!');
  } else {
    alert('Install karne ke liye:\n\n1️⃣ Browser ke address bar me icon dhundo (computer + arrow)\n2️⃣ Ya 3-dots menu → "Install app"\n3️⃣ Install confirm karo\n\nApp install ho jayega!');
  }
};

window.dismissInstall = function(){
  $('install-bar').classList.remove('show');
  localStorage.setItem('pf_install_dismissed_v15', '1');
};

// ⭐ v15.4.4: User can dismiss update banner — suppresses for 30 min
window.dismissUpdate = function(){
  $('update-banner').classList.remove('show');
  sessionStorage.setItem('pf_just_updated_at', String(Date.now()));
  console.log('[PWA v15.4.4] Update dismissed by user — suppressing banner for 10 min');
};

window.applyUpdate = function(){
  $('update-banner').classList.remove('show');
  // ⭐ v15.4.4 FIX: Set timestamp so updatefound handler suppresses duplicate banner for 10 min
  sessionStorage.setItem('pf_just_updated_at', String(Date.now()));
  // Track which version was applied so we don't show banner for same version
  sessionStorage.setItem('pf_last_applied_version', APP_VERSION);
  
  // ⭐ v15.4.2 FIX: Set explicit user-triggered flag so controllerchange knows to reload
  sessionStorage.setItem('pf_user_triggered_update', '1');
  // Clear the loop guard since user explicitly wants update
  sessionStorage.removeItem('pf_sw_last_reload');
  
  if (pendingWorker){
    console.log('[PWA v15.4.4] User clicked Update — sending SKIP_WAITING to pending SW');
    pendingWorker.postMessage({ type: 'SKIP_WAITING' });
    pendingWorker = null;  // clear reference — banner handler will detect this
    
    // Fallback: if controllerchange doesn't fire within 3 sec, force reload
    setTimeout(function(){
      if (!refreshing){
        console.log('[PWA v15.4.4] Fallback: forcing reload after 3 sec');
        refreshing = true;
        window.location.reload();
      }
    }, 3000);
  } else {
    // No pending worker — just hard reload to fetch latest
    console.log('[PWA v15.4.4] No pendingWorker — forcing hard reload');
    refreshing = true;
    window.location.reload();
  }
};

setTimeout(function(){
  if (state.member && !isStandalone() && localStorage.getItem('pf_install_dismissed_v15') !== '1'){
    showInstallBar();
  }
}, 3000);

window.logout = logout;
window.loadAssignment = loadAssignment;

bootAuth();
