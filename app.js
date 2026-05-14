"use strict";

// ═════════════════════════════════════════════════════════════════
// Prajapati GPS Field App v15
// FIXES: Camera 0.5x ultra-wide + GPS map stamp restored
//        + Strong PWA install + Aggressive auto-update
// ═════════════════════════════════════════════════════════════════

var APP_VERSION = 'v15.2';
var BUILD_DATE = '2026-05-14-15-2';

var CONFIG = {
  supabaseUrl: 'https://fpbktcgtspqsqpaytslv.supabase.co',
  supabaseKey: 'sb_publishable_JhObe56x_zETygpy6y8-DQ_qpQXIz_j',
  storageBucket: 'trial-photos',
  locationIqToken: 'pk.fde6fab706b3370a82c78ba286a896be',
  plateRecognizerToken: '4f6a384fb325649a527b7b2341aaf800b9f10306',
  plateRecognizerUrl: 'https://api.platerecognizer.com/v1/plate-reader/',
  sessionTtlMs: 12 * 60 * 60 * 1000,
  swUpdateIntervalMs: 15 * 1000  // v15.2: Check for SW update every 15 seconds (aggressive)
};

var state = {
  member: null, campaign: null, assignment: null,
  todayPhotos: [], todayVehicles: [], todayCount: 0,
  slots: [], photos: {}, vehicleNumber: '',
  plateOcrScore: null, ocrInFlight: false, ocrAttempted: false,
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
    var chain = Promise.resolve();
    items.forEach(function(item){
      chain = chain.then(function(){
        return uploadQueueItem(item)
          .then(function(){ return idb.remove(item.id); })
          .then(function(){ updateSessionStatus(); })
          .catch(function(err){
            console.error('Queue item '+item.id+' failed:', err);
            return idb.update(item.id, { status:'failed', attempts:(item.attempts||0)+1, lastError:String(err) });
          });
      });
    });
    return chain;
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
        state.member = rows[0]; touchActivity(); enterApp();
        setTimeout(function(){
          var n = state.sessionCaptures.length || state.todayCount || 0;
          var firstName = state.member.name.split(' ')[0];
          if (n > 0) toast('Welcome back, ' + firstName + ' — ' + n + ' vehicles aaj', 'success');
          else toast('Welcome back, ' + firstName, 'success');
        }, 800);
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
      touchActivity(); persistSessionCaptures(); enterApp();
    }).catch(function(){ loader(false); toast('Login error','error'); });
});

$('inp-mobile').addEventListener('keypress', function(e){ if (e.key === 'Enter') $('btn-login').click(); });

function logout(skipConfirm){
  if (!skipConfirm && !confirm('Logout?')) return;
  clearSessionStorage();
  if (typeof stopHomeAutoRefresh === 'function') stopHomeAutoRefresh();
  state = { member:null, campaign:null, assignment:null, todayPhotos:[], todayVehicles:[], todayCount:0, slots:[], photos:{}, vehicleNumber:'', plateOcrScore:null, ocrInFlight:false, ocrAttempted:false, sessionId:'', resumeMode:false, serverPhotoUrls:{}, sessionCaptures:[], gps:{} };
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
    } else { touchActivity(); }
  }
});

function enterApp(){
  showScreen('screen-home');
  if (!$('app-header')){
    var hdr = document.createElement('div');
    hdr.id = 'app-header'; hdr.className = 'header';
    hdr.innerHTML = '<div class="h-l"><div class="h-logo">P</div><div><h1>PRAJAPATI GPS</h1><div class="sub">'+escapeHtml(state.member.name)+'</div></div></div><button class="lo-btn" onclick="logout(false)">Logout</button>';
    $('screen-home').insertBefore(hdr, $('home-content'));
  } else {
    var subEl = $('app-header').querySelector('.sub');
    if (subEl) subEl.textContent = state.member.name;
  }
  touchActivity();
  loadAssignment();
  processQueue();
  startHomeAutoRefresh();
}

function loadAssignment(){
  loader(true, 'Loading…');
  var date = todayStr();
  api('/rest/v1/trial_daily_assignments?member_phone=eq.'+state.member.phone+'&assignment_date=eq.'+date+'&select=*')
    .then(function(rows){
      if (!rows || !rows.length){ state.assignment = null; state.campaign = null; renderHome(); loader(false); return null; }
      state.assignment = rows[0];
      return api('/rest/v1/trial_campaigns?key=eq.'+rows[0].campaign_key+'&select=*');
    })
    .then(function(rows){ if (rows && rows.length){ state.campaign = rows[0]; return loadTodayPhotos(); } })
    .then(function(){ renderHome(); loader(false); })
    .catch(function(err){ console.error(err); loader(false); toast('Load error','error'); });
}

function loadTodayPhotos(){
  var date = todayStr();
  var startUTC = new Date(date + 'T00:00:00+05:30').toISOString();
  var endUTC = new Date(date + 'T23:59:59+05:30').toISOString();
  // Filter rejected/deleted out at query level
  return api('/rest/v1/trial_photos?member_phone=eq.'+state.member.phone+'&campaign_key=eq.'+state.campaign.key+'&captured_at=gte.'+startUTC+'&captured_at=lte.'+endUTC+'&rejected=eq.false&deleted_at=is.null&select=*&order=captured_at.desc')
    .then(function(rows){
      state.todayPhotos = rows || [];
      var byVeh = {};
      state.todayPhotos.forEach(function(p){
        var k = p.vehicle_number || ('UNK_' + (p.captured_at||'').slice(0,16));
        if (!byVeh[k]){ byVeh[k] = { key: k, vehicle_number: p.vehicle_number || '', photos: [], firstAt: p.captured_at }; }
        byVeh[k].photos.push(p);
      });
      state.todayVehicles = Object.values(byVeh);
      var hT = state.campaign.hood_photo_count || 0;
      var bT = state.campaign.back_panel_photo_count || 0;
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
    return hd >= hT && bd >= bT;
  }).length;
  html += '<div class="hero"><div class="lbl">Today\'s Campaign</div><h2>'+escapeHtml(c.name)+'</h2><div class="meta">'+escapeHtml(c.client_name||'-')+(c.default_city?' · '+escapeHtml(c.default_city):'')+'</div><div class="progress"><div><strong>'+completeCount+'</strong>Complete</div><div><strong>'+vehCount+'</strong>Started</div><div><strong>'+(c.target_count||'∞')+'</strong>Target</div></div></div>';
  var modeLine = '';
  if (hT > 0 && bT > 0) modeLine = '4 photos per rickshaw (3 hood + 1 back panel)';
  else if (hT > 0) modeLine = hT + ' hood photos per rickshaw (back, left, right)';
  else if (bT > 0) modeLine = bT + ' back panel photo per rickshaw';
  else modeLine = 'No media type configured';
  html += '<div class="card"><h3>Capture vehicles</h3><div class="sub">'+modeLine+' · OCR auto-detects plate</div><button class="btn" '+((hT+bT)===0?'disabled':'')+' onclick="startCapture()">📸 Start Capture</button></div>';
  html += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><h3 style="margin:0">Aaj ke vehicles ('+vehCount+')</h3><button class="btn btn-g btn-sm" onclick="loadAssignment()" style="padding:5px 12px;font-size:11px">↻ Refresh</button></div>';
  if (!vehCount){ html += '<p style="color:var(--mu);font-size:12px;text-align:center;padding:18px 0">No vehicles captured yet today</p>'; }
  else {
    html += mergedVehicles.map(function(v){
      var hd = v.photos.filter(function(p){ return p.mode==='hood'; }).length;
      var bd = v.photos.filter(function(p){ return p.mode==='back_panel'; }).length;
      var complete = hd >= hT && bd >= bT;
      var statusCls = complete ? 'complete' : 'partial';
      var statusTxt = complete ? 'complete' : 'partial';
      var time = v.firstAt ? new Date(v.firstAt).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}) : '';
      var actionBtn = complete ? '' : '<button class="btn btn-w btn-sm" onclick="continueVehicle(\''+escapeHtml(v.key)+'\')" style="padding:6px 12px;font-size:11px">Continue →</button>';
      var details = '';
      if (hT > 0) details += 'Hood '+hd+'/'+hT;
      if (bT > 0) details += (details?' · ':'')+'Back '+bd+'/'+bT;
      var label = v.vehicle_number || '— (plate not detected)';
      return '<div class="vrow"><div class="vi"><div class="num">'+escapeHtml(label)+'</div><div class="det">'+time+' · '+details+'</div></div><div class="va"><span class="pill '+statusCls+'">'+statusTxt+'</span>'+actionBtn+'</div></div>';
    }).join('');
  }
  html += '</div>';
  html += '<div style="text-align:center;font-size:9px;color:#bbb;margin-top:20px;padding:10px;opacity:.6">'+APP_VERSION+' · '+BUILD_DATE+'</div>';
  $('home-content').innerHTML = html;
}

// ═══ GPS ═══
var gpsWatchId = null;
function watchGps(){
  if (isManualMode()){
    applyManualGps();
    $('gps-strip').className = 'gps';
    $('gps-strip').innerHTML = '<div class="live"></div><span>📍 Manual GPS · '+state.gps.lat.toFixed(5)+', '+state.gps.lng.toFixed(5)+' · anchor ±'+(state.campaign.gps_radius_m||50)+'m</span>';
    return;
  }
  if (gpsWatchId) return;
  if (!navigator.geolocation){ $('gps-strip').className = 'gps warn'; $('gps-strip').innerHTML = '<div class="live"></div><span>GPS not supported</span>'; return; }
  navigator.geolocation.getCurrentPosition(function(pos){ setGpsFromPosition(pos); }, function(){}, { enableHighAccuracy:true, maximumAge:0, timeout:8000 });
  gpsWatchId = navigator.geolocation.watchPosition(function(pos){ setGpsFromPosition(pos); }, function(err){ $('gps-strip').className = 'gps warn'; $('gps-strip').innerHTML = '<div class="live"></div><span>GPS error: '+err.message+'</span>'; }, { enableHighAccuracy:true, maximumAge:3000, timeout:20000 });
}

function setGpsFromPosition(pos){
  state.gps.lat = pos.coords.latitude;
  state.gps.lng = pos.coords.longitude;
  state.gps.accuracy = pos.coords.accuracy;
  state.gps._timestamp = Date.now();
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
    var done = false;
    var timer = setTimeout(function(){ if (!done){ done = true; resolve(state.gps.lat != null); } }, 6000);
    navigator.geolocation.getCurrentPosition(function(pos){
      if (done) return; done = true; clearTimeout(timer);
      setGpsFromPosition(pos);
      resolve(true);
    }, function(){
      if (done) return; done = true; clearTimeout(timer);
      resolve(state.gps.lat != null);
    }, { enableHighAccuracy:true, maximumAge:0, timeout:5500 });
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
function isManualMode(){ return !!(state.campaign && state.campaign.manual_gps_enabled && state.campaign.anchor_lat != null && state.campaign.anchor_lng != null); }
function applyManualGps(){
  if (!isManualMode()) return false;
  var anchorLat = parseFloat(state.campaign.anchor_lat);
  var anchorLng = parseFloat(state.campaign.anchor_lng);
  var radiusM = parseInt(state.campaign.gps_radius_m) || 50;
  var radiusDeg = radiusM / 111320;
  var lngScale = 1 / Math.cos(anchorLat * Math.PI / 180);
  var angle = Math.random() * 2 * Math.PI;
  var dist = Math.sqrt(Math.random()) * radiusDeg;
  state.gps.lat = anchorLat + dist * Math.cos(angle);
  state.gps.lng = anchorLng + dist * Math.sin(angle) * lngScale;
  state.gps.accuracy = Math.max(8, Math.round(radiusM / 5));
  state.gps._timestamp = Date.now();
  state.gps._isManual = true;
  if (!state.gps.address){
    if (state.campaign.anchor_address) state.gps.address = state.campaign.anchor_address;
    fetchReverseGeocode(anchorLat, anchorLng);
  }
  return true;
}

// ═══ CAPTURE FLOW ═══
function buildSlotList(){
  var slots = [];
  var hT = state.campaign.hood_photo_count || 0;
  var bT = state.campaign.back_panel_photo_count || 0;
  var hoodLabels = ['Back', 'Left', 'Right', 'Front', 'Top'];
  for (var i = 1; i <= hT; i++){ slots.push({ key: 'hood_'+i, mode: 'hood', n: i, label: 'Hood ' + (hoodLabels[i-1] || i) }); }
  for (var j = 1; j <= bT; j++){ slots.push({ key: 'back_panel_'+j, mode: 'back_panel', n: j, label: bT === 1 ? 'Back Panel' : 'Back Panel ' + j }); }
  return slots;
}

window.startCapture = function(){
  if (!state.campaign) return toast('No campaign assigned','error');
  if (fsApiSupported()){
    idb.getConfig('photo_dir_handle').then(function(existing){
      if (existing){ resetSession(false); enterCaptureScreen(); }
      else {
        if (confirm('First-time setup:\n\nPhone gallery mein photos save karne ke liye ek folder pick karo. (Recommend: Pictures folder)\n\nYeh ek hi baar hoga, baad mein silent save hoga.\n\nProceed?')){
          pickPhotoFolder().then(function(){ resetSession(false); enterCaptureScreen(); });
        } else { resetSession(false); enterCaptureScreen(); }
      }
    });
  } else { resetSession(false); enterCaptureScreen(); }
};

window.continueVehicle = function(key){
  var veh = state.todayVehicles.find(function(v){ return v.key === key; });
  if (!veh) return toast('Vehicle not found','error');
  resetSession(true);
  state.vehicleNumber = veh.vehicle_number;
  state.ocrAttempted = !!veh.vehicle_number;
  veh.photos.forEach(function(p){
    var k = p.mode + '_' + p.photo_number;
    state.serverPhotoUrls[k] = p.public_url;
  });
  enterCaptureScreen();
};

function resetSession(isResume){
  state.slots = buildSlotList();
  state.photos = {};
  state.vehicleNumber = '';
  state.plateOcrScore = null;
  state.ocrInFlight = false;
  state.ocrAttempted = false;
  state.sessionId = genSessionId();
  state._fallbackVehicleId = null;
  state.resumeMode = !!isResume;
  if (!isResume) state.serverPhotoUrls = {};
}

function enterCaptureScreen(){
  $('ocr-banner').style.display = 'none';
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
  isPinching: false, zoomHideTimer: null
};

function openInAppCamera(key){
  var slot = state.slots.find(function(s){ return s.key === key; });
  $('cam-slot-label').textContent = slot ? slot.label : 'Capture';
  $('cam-modal').classList.add('show');
  $('cam-shutter').disabled = true;

  updateCamStampPreview();
  camStampTimer = setInterval(updateCamStampPreview, 1500);

  navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920, max: 4096 },
      height: { ideal: 1440, max: 3072 },
      focusMode: { ideal: 'continuous' },
      whiteBalanceMode: { ideal: 'continuous' }
    },
    audio: false
  }).then(function(stream){
    camStream = stream;
    var v = $('cam-feed');
    v.srcObject = stream;
    v.onloadedmetadata = function(){
      v.play();
      $('cam-shutter').disabled = false;
      
      // ⭐ FIX: Force 0.5x ULTRA-WIDE on open (min zoom)
      var track = stream.getVideoTracks()[0];
      if (track && track.getCapabilities) {
        try {
          var caps = track.getCapabilities();
          if (caps.zoom) {
            // ⭐ v15.2 FIX: Force to ABSOLUTE MINIMUM (0.0x / 0.5x / whatever hardware min is)
            var targetZoom = caps.zoom.min;
            // If min is 1.0 (no ultra-wide), try setting to 0 anyway - some browsers accept
            console.log('[CAM v15.2] Camera capabilities:', JSON.stringify(caps.zoom));
            console.log('[CAM v15.2] Forcing zoom to MIN:', targetZoom);
            
            track.applyConstraints({ advanced: [{ zoom: targetZoom }] })
              .then(function() {
                camZoomState.currentZoom = targetZoom;
                camZoomState.minZoom = caps.zoom.min;
                camZoomState.maxZoom = caps.zoom.max || 4.0;
                camZoomState.stepZoom = caps.zoom.step || 0.1;
                console.log('[CAM v15.2] ✅ Zoom set to:', targetZoom + 'x');
                updateZoomIndicator(targetZoom);
              })
              .catch(function(e) { 
                console.warn('[CAM v15.2] Hardware zoom failed - using digital:', e); 
                // Digital zoom fallback: CSS scale at 0 = NO ZOOM (widest possible view)
                var video = $('cam-feed');
                if (video) {
                  video.style.transform = 'scale(1)';
                  video.style.transformOrigin = 'center center';
                }
                camZoomState.currentZoom = 1.0;
              });
          } else {
            // No zoom capability - use CSS digital zoom to widest
            console.log('[CAM v15.2] No hardware zoom - using digital fallback');
            var video = $('cam-feed');
            if (video) {
              video.style.transform = 'scale(1)';
              video.style.transformOrigin = 'center center';
            }
          }
        } catch (e) { console.warn('[CAM v15] Cap check failed:', e); }
      }
      
      setupPinchToZoom(stream);
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
    var firstKey = state.slots.find(function(s){ return s.mode === 'hood'; });
    var primaryKey = firstKey ? firstKey.key : (state.slots[0] && state.slots[0].key);
    if (key === primaryKey && !state.ocrAttempted && !state.vehicleNumber){
      state.ocrAttempted = true;
      runPlateOcr(file);
    }
    queuePhotoWhenReady(key);
    var allFilled = state.slots.every(function(s){ return state.photos[s.key] || state.serverPhotoUrls[s.key]; });
    if (allFilled){ setTimeout(finishVehicleSession, 600); }
  }).catch(function(err){ loader(false); console.error(err); toast('Stamp error','error'); });
}

window.endSession = function(){
  if (Object.keys(state.photos).length > 0){
    if (!confirm('End session? Pending photos queue mein chale jayenge.')) return;
    var waitMs = state.ocrInFlight ? 3000 : 0;
    if (waitMs) loader(true, 'Saving last vehicle…');
    waitForOcr(waitMs).then(function(){
      Object.keys(state.photos).forEach(function(k){ if (!state.photos[k]._queued) queuePhoto(k); });
      loader(false);
      stopGps();
      $('capture-actions').style.display = 'none';
      showScreen('screen-home');
      loadAssignment();
      startHomeAutoRefresh();
    });
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

function runPlateOcr(originalBlob){
  var b = $('ocr-banner');
  state.ocrInFlight = true;
  b.className = 'ocr detect';
  b.style.display = 'flex';
  b.innerHTML = '<div class="sm"></div><span>Reading vehicle plate from photo…</span>';
  var fd = new FormData();
  fd.append('upload', originalBlob);
  fd.append('regions', 'in');
  fetch(CONFIG.plateRecognizerUrl, {
    method: 'POST',
    headers: { 'Authorization': 'Token ' + CONFIG.plateRecognizerToken },
    body: fd
  }).then(function(r){ return r.json(); }).then(function(data){
    state.ocrInFlight = false;
    if (data.results && data.results.length){
      var best = data.results[0];
      var plate = (best.plate || '').toUpperCase().replace(/\s+/g,'');
      var score = Math.round((best.score || 0) * 100);
      if (plate){
        state.vehicleNumber = plate;
        state.plateOcrScore = best.score;
        b.className = 'ocr success';
        b.innerHTML = '<span>✓ Plate: <span class="pl">'+escapeHtml(plate)+'</span> ('+score+'%)</span>';
      } else {
        b.className = 'ocr fail';
        b.innerHTML = '<span>Plate not clear — admin will review</span>';
      }
    } else {
      b.className = 'ocr fail';
      b.innerHTML = '<span>Plate not detected — admin will review</span>';
    }
  }).catch(function(err){
    state.ocrInFlight = false;
    console.error('OCR error:', err);
    b.className = 'ocr fail';
    b.innerHTML = '<span>OCR unavailable — admin will review</span>';
  });
}

function waitForOcr(maxMs){
  return new Promise(function(resolve){
    var start = Date.now();
    var check = function(){
      if (!state.ocrInFlight || (Date.now() - start) > maxMs) resolve();
      else setTimeout(check, 100);
    };
    check();
  });
}

// ═════════════════════════════════════════════════════════════════
// GPS STAMP - WITH GOOGLE MAPS GRAPHIC (RESTORED v15)
// Draws: Green map background + red pin + roads + Google label
//        on LEFT side, then address+coords+timestamp on RIGHT
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
    var oH = Math.round(H * 0.18);
    var oY = H - oH;
    var pad = Math.round(oH * 0.08);
    var mS = oH - 2*pad;

    // Dark overlay panel at bottom
    ctx.fillStyle = 'rgba(10,14,26,0.85)';
    ctx.fillRect(0, oY, W, oH);

    // ━━━ MAP GRAPHIC (LEFT SIDE) ━━━
    var mX = pad, mY = oY + pad;
    
    // Green map background
    ctx.fillStyle = '#7AA070';
    ctx.fillRect(mX, mY, mS, mS);
    
    // Cream-colored roads (horizontal + vertical)
    ctx.fillStyle = '#D8D4C0';
    ctx.fillRect(mX, mY + Math.round(mS*0.4), mS, Math.round(mS*0.06));
    ctx.fillRect(mX + Math.round(mS*0.45), mY, Math.round(mS*0.04), mS);
    
    // Building blocks (gray)
    ctx.fillStyle = '#5A5650';
    ctx.fillRect(mX + Math.round(mS*0.08), mY + Math.round(mS*0.08), Math.round(mS*0.25), Math.round(mS*0.25));
    ctx.fillStyle = '#6A6660';
    ctx.fillRect(mX + Math.round(mS*0.55), mY + Math.round(mS*0.08), Math.round(mS*0.35), Math.round(mS*0.25));
    ctx.fillRect(mX + Math.round(mS*0.08), mY + Math.round(mS*0.55), Math.round(mS*0.25), Math.round(mS*0.4));
    ctx.fillStyle = '#5A5650';
    ctx.fillRect(mX + Math.round(mS*0.55), mY + Math.round(mS*0.55), Math.round(mS*0.35), Math.round(mS*0.4));
    
    // Blue river strip at bottom
    ctx.fillStyle = '#3070C0';
    ctx.fillRect(mX, mY + Math.round(mS*0.78), mS, Math.round(mS*0.06));

    // Red Google Maps pin
    var pCX = mX + mS/2, pCY = mY + mS*0.45, pR = mS*0.13;
    ctx.fillStyle = '#DB4437';
    ctx.beginPath();
    ctx.arc(pCX, pCY, pR, Math.PI*1.1, Math.PI*1.9);
    ctx.lineTo(pCX, pCY + pR*2.2);
    ctx.closePath();
    ctx.fill();
    
    // White dot in center of pin
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(pCX, pCY, pR*0.4, 0, 2*Math.PI);
    ctx.fill();

    // "Google" label in bottom-left of map
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold ' + Math.round(mS*0.13) + 'px system-ui';
    ctx.fillText('Google', mX + Math.round(mS*0.06), mY + mS - Math.round(mS*0.08));

    // ━━━ TEXT PANEL (RIGHT SIDE) ━━━
    var tX = mX + mS + pad;
    var tW = W - tX - pad;

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
    var dateStr = dayName + ', ' + dd + '/' + mm + '/' + yyyy + ' ' + String(hh).padStart(2,'0') + ':' + min + ' ' + ampm + ' GMT +05:30';

    var lat = state.gps.lat ? state.gps.lat.toFixed(6) : '—';
    var lng = state.gps.lng ? state.gps.lng.toFixed(6) : '—';

    var a = state.gps.addressObj || {};
    var city = a.city || a.town || a.village || a.suburb || a.county || '';
    var stateName = a.state || '';
    var country = a.country || 'India';
    var cityLine = [city, stateName, country].filter(Boolean).join(', ') || '—';
    var addrText = state.gps.address || '';
    if (a.postcode && addrText.indexOf(a.postcode) === -1) addrText += ', ' + a.postcode;

    ctx.font = Math.round(oH*0.09) + 'px system-ui';
    var words = addrText.split(/[, ]+/).filter(Boolean);
    var lines = [], cur = '';
    for (var i = 0; i < words.length; i++){
      var w = words[i];
      var test = cur ? cur + ', ' + w : w;
      if (ctx.measureText(test).width > tW && cur){
        lines.push(cur + ',');
        cur = w;
        if (lines.length >= 2){ cur = words.slice(i).join(', '); break; }
      } else { cur = test; }
    }
    if (cur && lines.length < 2) lines.push(cur);
    while (lines.length < 2) lines.push('');
    if (ctx.measureText(lines[1]).width > tW){
      while (lines[1] && ctx.measureText(lines[1]+'…').width > tW){ lines[1] = lines[1].slice(0,-1); }
      lines[1] += '…';
    }

    var cy = oY + pad + Math.round(oH*0.16);
    
    // City name (bold)
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold ' + Math.round(oH*0.13) + 'px system-ui';
    ctx.fillText(cityLine, tX, cy);
    
    // India flag next to city
    var cityW = ctx.measureText(cityLine).width;
    var flagX = tX + cityW + Math.round(oH*0.06);
    var flagY = cy - Math.round(oH*0.11);
    var flagW = Math.round(oH*0.13);
    var flagH = Math.round(flagW*0.66);
    if (flagX + flagW < W - pad){
      ctx.fillStyle = '#FF9933'; ctx.fillRect(flagX, flagY, flagW, flagH/3);
      ctx.fillStyle = '#FFFFFF'; ctx.fillRect(flagX, flagY+flagH/3, flagW, flagH/3);
      ctx.fillStyle = '#138808'; ctx.fillRect(flagX, flagY+2*flagH/3, flagW, flagH/3);
    }
    
    cy += Math.round(oH*0.17);
    
    // Address lines
    ctx.fillStyle = '#FFFFFF';
    ctx.font = Math.round(oH*0.09) + 'px system-ui';
    for (var j = 0; j < lines.length; j++){
      if (lines[j]) ctx.fillText(lines[j], tX, cy);
      cy += Math.round(oH*0.13);
    }
    
    // Lat/Long
    ctx.fillText('Lat ' + lat + '° Long ' + lng + '°', tX, cy);
    cy += Math.round(oH*0.13);
    
    // Timestamp
    ctx.fillText(dateStr, tX, cy);

    return new Promise(function(resolve){
      canvas.toBlob(function(blob){ resolve({ blob: blob, width: canvas.width, height: canvas.height }); }, 'image/jpeg', 0.85);
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
  if (!state._fallbackVehicleId) state._fallbackVehicleId = fallbackVehicleId();
  var vehicleSlug = slugify(vehiclePlate) || state._fallbackVehicleId;
  var angle = getAngleName(slot);
  var filename = angle + '-' + vehicleSlug + '.jpg';
  var path = campaignSlug + '/' + dateSlug + '/' + memberSlug + '/' + vehicleSlug + '/' + filename;
  var dbRow = {
    storage_path: path,
    campaign_key: state.campaign.key,
    member_phone: state.member.phone,
    member_name: state.member.name,
    vehicle_number: state.vehicleNumber || null,
    mode: slot.mode,
    photo_number: slot.n,
    total_expected: slot.mode === 'hood' ? (state.campaign.hood_photo_count||3) : (state.campaign.back_panel_photo_count||1),
    captured_at: new Date().toISOString(),
    latitude: state.gps.lat,
    longitude: state.gps.lng,
    address: state.gps.address,
    city: state.gps.city,
    app_version: APP_VERSION,
    rejected: false
  };
  if (state.plateOcrScore && slot.mode === 'hood' && slot.n === 1){
    dbRow.plate_ocr_score = state.plateOcrScore;
  }
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
function ensurePhotoFolder(){
  if (!fsApiSupported()) return Promise.resolve(null);
  return idb.getConfig('photo_dir_handle').then(function(handle){
    if (!handle) return null;
    return handle.queryPermission({ mode:'readwrite' }).then(function(perm){
      if (perm === 'granted') return handle;
      return handle.requestPermission({ mode:'readwrite' }).then(function(p2){ return p2 === 'granted' ? handle : null; });
    });
  }).catch(function(){ return null; });
}
function pickPhotoFolder(){
  if (!fsApiSupported()){
    toast('Browser puraana hai — Downloads folder use hoga','warn');
    return Promise.resolve(null);
  }
  return window.showDirectoryPicker({ mode: 'readwrite', id: 'prajapati-gps-photos', startIn: 'pictures' })
    .then(function(handle){
      return idb.setConfig('photo_dir_handle', handle).then(function(){
        toast('✓ Photo folder set! Ab silent save hoga','success');
        return handle;
      });
    }).catch(function(){
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
        console.warn('FS save failed, falling back:', err);
        triggerDownload(blob, filename);
      });
    }
    triggerDownload(blob, filename);
  });
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
  if (state.ocrInFlight){
    waitForOcr(4000).then(function(){ queuePhoto(key); });
  } else {
    queuePhoto(key);
  }
}

function finishVehicleSession(){
  loader(true, state.ocrInFlight ? 'Reading plate…' : 'Saving vehicle…');
  waitForOcr(4000).then(function(){
    Object.keys(state.photos).forEach(function(k){
      if (!state.photos[k]._queued) queuePhoto(k);
    });
    var plate = state.vehicleNumber || ('— (' + (state._fallbackVehicleId || 'review') + ')');
    var vehicleKey = state.vehicleNumber || state._fallbackVehicleId;
    state.sessionCaptures.push({
      key: vehicleKey,
      vehicle_number: state.vehicleNumber || '',
      hood_count: state.slots.filter(function(s){return s.mode==='hood';}).length,
      back_count: state.slots.filter(function(s){return s.mode==='back_panel';}).length,
      captured_at: new Date().toISOString()
    });
    state.todayCount += 1;
    persistSessionCaptures();
    touchActivity();
    loader(false);
    $('flash-plate').textContent = plate;
    $('flash-meta').textContent = state.slots.length + ' photos saved · ' + (state.gps.city || 'GPS');
    $('flash').classList.add('show');
    setTimeout(function(){
      $('flash').classList.remove('show');
      resetSession(false);
      enterCaptureScreen();
      processQueue();
    }, 1800);
  });
}

// ═════════════════════════════════════════════════════════════════
// PWA: SERVICE WORKER + STRONG INSTALL + AGGRESSIVE AUTO-UPDATE (v15.1)
// ═════════════════════════════════════════════════════════════════

var deferredInstallPrompt = null;
var refreshing = false;
var pendingWorker = null;

// Detect environment
function isIosSafari(){
  var ua = navigator.userAgent.toLowerCase();
  return /iphone|ipad|ipod/.test(ua) && /safari/.test(ua) && !/crios|fxios/.test(ua);
}
function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isAndroid(){ return /android/i.test(navigator.userAgent); }
function isChrome(){ return /chrome|crios/i.test(navigator.userAgent) && !/edg|opr/i.test(navigator.userAgent); }

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('/sw.js?v=' + APP_VERSION).then(function(reg){
      console.log('[PWA v15] SW registered:', reg.scope);
      // Check for updates every 30 seconds
      setInterval(function(){
        reg.update().catch(function(e){ console.warn('[PWA] Update check failed:', e); });
      }, CONFIG.swUpdateIntervalMs);
      setTimeout(function(){ reg.update(); }, 5000);
      
      reg.addEventListener('updatefound', function(){
        var newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', function(){
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller){
            pendingWorker = newWorker;
            $('update-banner').classList.add('show');
          }
        });
      });
    }).catch(function(err){
      console.warn('[PWA v15] SW register failed:', err);
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', function(){
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
  navigator.serviceWorker.addEventListener('message', function(event){
    if (event.data && event.data.type === 'SW_ACTIVATED'){
      if (!refreshing){
        refreshing = true;
        toast('🔄 Updating to new version…', 'success');
        setTimeout(function(){ window.location.reload(); }, 800);
      }
    }
  });
}

// ━━━ STRONG INSTALL PROMPT (v15.1: shows ALWAYS) ━━━
window.addEventListener('beforeinstallprompt', function(e){
  console.log('[PWA v15] beforeinstallprompt captured!');
  e.preventDefault();
  deferredInstallPrompt = e;
  showInstallBar();
});

window.addEventListener('appinstalled', function(){
  console.log('[PWA v15] App installed!');
  toast('✅ App installed!', 'success');
  $('install-bar').classList.remove('show');
  deferredInstallPrompt = null;
});

function showInstallBar(){
  // Already installed? Skip.
  if (isStandalone()) {
    console.log('[PWA v15] Already standalone - no install bar');
    return;
  }
  // Dismissed permanently? Skip.
  if (localStorage.getItem('pf_install_dismissed_v15') === '1') {
    console.log('[PWA v15] User dismissed - skipping');
    return;
  }
  
  var bar = $('install-bar');
  if (!bar) return;
  
  // Customize message based on browser/platform
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
  console.log('[PWA v15] Install bar shown');
}

window.triggerInstall = function(){
  console.log('[PWA v15] Install button clicked');
  
  if (deferredInstallPrompt) {
    // Native install (Chrome Android/Desktop)
    deferredInstallPrompt.prompt();
    deferredInstallPrompt.userChoice.then(function(choice){
      console.log('[PWA v15] Install choice:', choice.outcome);
      if (choice.outcome === 'accepted'){
        toast('Install ho raha hai…', 'success');
      }
      deferredInstallPrompt = null;
      $('install-bar').classList.remove('show');
    });
  } else if (isIosSafari()) {
    // iOS Safari manual instructions
    alert('iPhone/iPad par install karne ke liye:\n\n1️⃣ Safari ke neeche Share button tap karo (square with arrow)\n2️⃣ Scroll down → "Add to Home Screen"\n3️⃣ "Add" tap karo\n\nApp home screen pe install ho jayega!');
  } else if (isAndroid() && isChrome()) {
    // Android Chrome manual instructions
    alert('Chrome par install karne ke liye:\n\n1️⃣ Top-right me 3-dots menu tap karo\n2️⃣ "Install app" ya "Add to Home Screen" tap karo\n3️⃣ "Install" confirm karo\n\nApp install ho jayega!');
  } else {
    // Desktop or other
    alert('Install karne ke liye:\n\n1️⃣ Browser ke address bar me icon dhundo (computer + arrow)\n2️⃣ Ya 3-dots menu → "Install app"\n3️⃣ Install confirm karo\n\nApp install ho jayega!');
  }
};

window.dismissInstall = function(){
  $('install-bar').classList.remove('show');
  localStorage.setItem('pf_install_dismissed_v15', '1');
};

window.applyUpdate = function(){
  $('update-banner').classList.remove('show');
  if (pendingWorker){
    pendingWorker.postMessage({ type: 'SKIP_WAITING' });
  } else {
    window.location.reload();
  }
};

// SHOW INSTALL BAR after 3 sec — ALWAYS if not standalone & not dismissed
setTimeout(function(){
  if (state.member && !isStandalone() && localStorage.getItem('pf_install_dismissed_v15') !== '1'){
    showInstallBar();
  }
}, 3000);

window.logout = logout;
window.loadAssignment = loadAssignment;

bootAuth();
