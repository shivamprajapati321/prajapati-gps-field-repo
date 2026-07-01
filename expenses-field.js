/* ════════════════════════════════════════════════════════════════════
   EXPENSES FIELD PWA — logic  v1.0.0
   Field worker: apna expense daale (pending approval) + bank/doc profile.
   Sirf assigned campaigns dikhe. Sirf apne expenses history.
   ════════════════════════════════════════════════════════════════════ */
var SUPABASE_URL = 'https://fpbktcgtspqsqpaytslv.supabase.co';
var SUPABASE_KEY = 'sb_publishable_JhObe56x_zETygpy6y8-DQ_qpQXIz_j';
var APP_VERSION = 'v1.0.11';
var RECEIPT_BUCKET = 'payment-receipts';   // existing public bucket; docs go to private path prefix

var state = { member:null, campaigns:[], profile:null, currentTab:'add' };

function $(id){ return document.getElementById(id); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

// ── API helper ──
function api(path, opts){
  opts = opts || {};
  var headers = { apikey:SUPABASE_KEY, Authorization:'Bearer '+SUPABASE_KEY, 'Content-Type':'application/json' };
  if (opts.prefer) headers['Prefer'] = opts.prefer;
  return fetch(SUPABASE_URL+'/rest/v1'+path, {
    method: opts.method||'GET', headers: headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  }).then(function(r){
    if (!r.ok) return r.text().then(function(t){ throw new Error(t||('HTTP '+r.status)); });
    if (r.status === 204) return null;
    return r.text().then(function(t){ return t ? JSON.parse(t) : null; });
  });
}

function toast(msg, type){
  var t = $('toast'); t.textContent = msg;
  t.className = 'toast show' + (type ? ' '+type : '');
  clearTimeout(window._tt); window._tt = setTimeout(function(){ t.className='toast'; }, 2600);
}
function loader(on, txt){ if(txt)$('loaderText').textContent=txt; $('loader').className = on?'loader show':'loader'; }

function todayIST(){
  var d = new Date(Date.now() + (5.5*3600*1000));
  return d.toISOString().slice(0,10);
}

// ════════ AUTH ════════
// ═══ OTP LOGIN (WhatsApp via Wati) ═══
var _loginPhone = '';
var _resendInt = null;

function sendLoginOtp(isResend){
  var phone = $('inp-mobile').value.trim().replace(/\D/g,'');
  if (phone.length !== 10) return toast('10-digit mobile number daalo','error');
  // pehle check karo number registered hai
  loader(true, isResend ? 'OTP dobara bhej rahe…' : 'Number check kar rahe…');
  api('/trial_team_members?phone=eq.'+phone+'&active=eq.true&select=*')
    .then(function(rows){
      if (!rows || !rows.length){ loader(false); return toast('Number registered nahi hai','error'); }
      state.member = rows[0];
      _loginPhone = phone;
      // Wati OTP bhejo
      if (typeof WatiClient === 'undefined'){
        loader(false);
        toast('OTP service load nahi hua — reload karo','error');
        return;
      }
      loader(true,'WhatsApp pe OTP bhej rahe…');
      return WatiClient.sendOTP(phone).then(function(result){
        loader(false);
        if (!result || !result.success){
          return toast('OTP bhejne mein dikkat: '+((result&&result.error)||'try again'),'error');
        }
        // show OTP step
        $('login-step-phone').style.display='none';
        $('login-step-otp').style.display='block';
        $('otp-sent-to').textContent = 'WhatsApp pe OTP bheja: +91 '+phone.slice(0,5)+' '+phone.slice(5);
        var otpInp = $('inp-otp'); if(otpInp){ otpInp.value=''; otpInp.focus(); }
        startResendTimer();
      });
    })
    .catch(function(e){ loader(false); toast('Error: '+e.message,'error'); });
}

function startResendTimer(){
  var btn = $('resend-btn'), tEl = $('resend-timer');
  var sec = 30;
  if (btn){ btn.disabled = true; }
  if (_resendInt) clearInterval(_resendInt);
  _resendInt = setInterval(function(){
    sec--;
    if (tEl) tEl.textContent = sec;
    if (sec <= 0){
      clearInterval(_resendInt);
      if (btn){ btn.disabled = false; btn.innerHTML = 'Resend OTP'; }
    }
  }, 1000);
}

function verifyLoginOtp(){
  var code = $('inp-otp').value.trim().replace(/\D/g,'');
  if (code.length !== 6) return toast('6-digit OTP daalo','error');
  if (typeof WatiClient === 'undefined') return toast('OTP service error','error');
  loader(true,'Verify kar rahe…');
  WatiClient.verifyOTP(_loginPhone, code).then(function(result){
    loader(false);
    if (!result || !result.success){
      return toast(result&&result.error||'Galat OTP — phir try karo','error');
    }
    // success — login
    localStorage.setItem('exp_member_phone', _loginPhone);
    if (_resendInt) clearInterval(_resendInt);
    enterApp();
  }).catch(function(e){ loader(false); toast('Verify error: '+e.message,'error'); });
}

function backToPhone(){
  $('login-step-otp').style.display='none';
  $('login-step-phone').style.display='block';
  if (_resendInt) clearInterval(_resendInt);
}

function doLogout(){
  if (!confirm('Logout?')) return;
  localStorage.removeItem('exp_member_phone');
  location.reload();
}

function bootAuth(){
  var saved = localStorage.getItem('exp_member_phone');
  if (!saved){ $('screen-login').style.display='flex'; return; }
  loader(true,'Loading…');
  api('/trial_team_members?phone=eq.'+saved+'&active=eq.true&select=*')
    .then(function(rows){
      loader(false);
      if (!rows || !rows.length){ localStorage.removeItem('exp_member_phone'); $('screen-login').style.display='flex'; return; }
      state.member = rows[0];
      enterApp();
    })
    .catch(function(){ loader(false); $('screen-login').style.display='flex'; });
}

function enterApp(){
  $('screen-login').style.display='none';
  $('appHeader').style.display='flex';
  $('tabbar').style.display='flex';
  $('appVer').style.display='block';
  $('appVer').textContent = APP_VERSION;
  $('memName').textContent = (state.member.name||state.member.phone) + ' · Field';
  $('expDate').value = todayIST();
  switchTab('add');
  loadAssignedCampaigns();
  loadProfile();
}

// ════════ TABS ════════
function switchTab(tab){
  state.currentTab = tab;
  ['add','advance','history','settings'].forEach(function(t){
    $('screen-'+t).className = 'scr' + (t===tab?' active':'');
    $('tab-'+t).className = 'tb' + (t===tab?' active':'');
  });
  if (tab==='history') loadHistory();
  if (tab==='advance') loadAdvances();
}

// ════════ ASSIGNED CAMPAIGNS ════════
// Worker ke recent assignments (last 7 din) ke distinct campaigns — sirf yahi dikhe.
// Privacy: completed campaigns hide; 7-day window (purane auto-hide).
function loadAssignedCampaigns(){
  var sel = $('expCampaign');
  var fromDate = new Date(Date.now() - 7*86400000).toISOString().slice(0,10);
  api('/trial_daily_assignments?member_phone=eq.'+encodeURIComponent(state.member.phone)+'&assignment_date=gte.'+fromDate+'&select=campaign_key&order=assignment_date.desc')
    .then(function(rows){
      var keys = [];
      (rows||[]).forEach(function(r){ if(r.campaign_key && keys.indexOf(r.campaign_key)===-1) keys.push(r.campaign_key); });
      if (!keys.length){
        state.campaigns = [];
        renderCampaignOptions([]);
        return;
      }
      // Fetch campaign names + completed flag (completed = hide)
      var inList = keys.map(function(k){ return encodeURIComponent(k); }).join(',');
      return api('/trial_campaigns?key=in.('+inList+')&select=key,name,client_name,completed').then(function(camps){
        var byKey = {}; (camps||[]).forEach(function(c){ byKey[c.key]=c; });
        // Keep assignment order; SKIP completed campaigns (privacy)
        var list = [];
        keys.forEach(function(k){
          var c = byKey[k];
          if (c && c.completed !== true) list.push(c);
        });
        state.campaigns = list;
        renderCampaignOptions(list);
      });
    })
    .catch(function(e){ sel.innerHTML='<option value="">Load error</option>'; console.warn(e); });
}

// Searchable campaign dropdown render
function renderCampaignOptions(list){
  var sel = $('expCampaign');
  var search = $('campSearch');
  if (!list || !list.length){
    sel.innerHTML = '<option value="">Koi campaign assign nahi (7 din)</option>';
    if (search) search.style.display = 'none';
    return;
  }
  // search box dikhao agar 5+ campaigns
  if (search) search.style.display = list.length >= 5 ? 'block' : 'none';
  var q = (search && search.value || '').toLowerCase().trim();
  var filtered = q
    ? list.filter(function(c){ return (c.name||c.key||'').toLowerCase().indexOf(q) !== -1; })
    : list;
  var opts = '<option value="">Campaign select karo…</option>';
  filtered.forEach(function(c){
    opts += '<option value="'+esc(c.key)+'">'+esc(c.name||c.key)+'</option>';
  });
  if (!filtered.length) opts = '<option value="">Koi match nahi — search badlo</option>';
  sel.innerHTML = opts;
}

// search box ke input pe filter
function filterCampaigns(){
  renderCampaignOptions(state.campaigns || []);
}

// ════════ ADD EXPENSE ════════
function recalc(){
  var ids = ['food','auto','hotel','bus','other'];
  var total = 0;
  ids.forEach(function(id){
    var v = +$('amt-'+id).value || 0;
    total += v;
    $('box-'+id).className = 'cat-box' + (v>0?' filled':'');
  });
  $('totalView').textContent = '₹'+total;
  return total;
}

function submitExpense(){
  var campaign = $('expCampaign').value;
  if (!campaign) return toast('Campaign select karo','error');
  var total = recalc();
  if (total <= 0) return toast('Kam se kam ek kharcha daalo','error');

  var camp = state.campaigns.find(function(c){ return c.key===campaign; }) || {};
  var btn = $('submitExpBtn');
  btn.disabled = true; btn.textContent = '⏳ Submitting…';

  var payload = {
    expense_type: 'campaign',
    campaign_key: campaign,
    campaign_name: camp.name || campaign,
    team_member_phone: state.member.phone,
    team_member_name: state.member.name || state.member.phone,
    expense_date: $('expDate').value || todayIST(),
    food_amount:  +$('amt-food').value  || 0,
    auto_amount:  +$('amt-auto').value  || 0,
    hotel_amount: +$('amt-hotel').value || 0,
    bus_amount:   +$('amt-bus').value   || 0,
    other_amount: +$('amt-other').value || 0,
    total_amount: total,
    remark: $('expRemark').value.trim() || null,
    approval_status: 'pending',     // field se aaya → admin approve kare
    payment_status: 'unpaid',
    source: 'field'
  };

  api('/prajapati_expenses', { method:'POST', body:payload, prefer:'return=minimal' })
    .then(function(){
      toast('✅ Submitted! Admin approve karega','success');
      // reset form
      ['food','auto','hotel','bus','other'].forEach(function(id){ $('amt-'+id).value=''; });
      $('expRemark').value=''; recalc();
      btn.disabled=false; btn.textContent='📤 Submit for Approval';
    })
    .catch(function(e){
      btn.disabled=false; btn.textContent='📤 Submit for Approval';
      toast('Failed: '+e.message,'error');
    });
}

// ════════ HISTORY ════════
// ════════ ADVANCE ════════
function currentMonthKey(){
  var d = new Date(new Date().getTime()+5.5*3600*1000);
  return d.toISOString().slice(0,7); // 'YYYY-MM'
}
function submitAdvance(){
  var amt = +$('advAmount').value || 0;
  if (amt <= 0) return toast('Amount daalo','error');
  var reason = $('advReason').value.trim();
  var btn = $('advSubmitBtn');
  btn.disabled = true; btn.textContent = '⏳ Requesting…';
  var payload = {
    member_phone: state.member.phone,
    member_name: state.member.name || state.member.phone,
    amount: amt,
    reason: reason || null,
    request_month: currentMonthKey(),
    status: 'pending',
    source: 'field'
  };
  api('/prajapati_advances', { method:'POST', body:payload, prefer:'return=minimal' })
    .then(function(){
      toast('✅ Advance request bhej diya','success');
      $('advAmount').value=''; $('advReason').value='';
      btn.disabled=false; btn.textContent='📤 Request Advance';
      loadAdvances();
    })
    .catch(function(e){
      btn.disabled=false; btn.textContent='📤 Request Advance';
      toast('Failed: '+e.message,'error');
    });
}
function loadAdvances(){
  $('advList').innerHTML = '<div class="empty"><div class="ei">⏳</div>Loading…</div>';
  api('/prajapati_advances?member_phone=eq.'+encodeURIComponent(state.member.phone)+'&select=*&order=requested_at.desc&limit=200')
    .then(function(rows){
      rows = rows || [];
      // is month ka total (approved + paid + pending sab count — jo liya/maanga)
      var mk = currentMonthKey();
      var monthRows = rows.filter(function(r){ return r.request_month === mk; });
      // "liya hua" = approved + paid (actually diya gaya). Pending bhi dikha do alag.
      var takenTotal = monthRows.filter(function(r){ return r.status==='approved'||r.status==='paid'; })
        .reduce(function(s,r){ return s + (Number(r.amount)||0); }, 0);
      var pendingCount = monthRows.filter(function(r){ return r.status==='pending'; }).length;
      $('advMonthTotal').textContent = '₹' + takenTotal.toLocaleString('en-IN');
      var monthName = new Date(mk+'-01').toLocaleDateString('en-IN',{month:'short',year:'numeric'});
      $('advMonthMeta').textContent = monthName + ' · ' + monthRows.length + ' request' + (monthRows.length===1?'':'s') + (pendingCount?(' · '+pendingCount+' pending'):'');

      if (!rows.length){ $('advList').innerHTML = '<div class="empty"><div class="ei">💰</div>Abhi koi advance request nahi</div>'; return; }
      $('advList').innerHTML = rows.map(function(r){
        var d = new Date(r.requested_at||Date.now()).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
        var st = String(r.status||'pending');
        return '<div class="adv-item">'+
          '<div class="adv-item-top">'+
            '<div><div class="adv-item-amt">₹'+(Number(r.amount)||0).toLocaleString('en-IN')+'</div>'+
            '<div class="adv-item-date">📅 '+d+'</div></div>'+
            '<span class="adv-pill '+st+'">'+st.charAt(0).toUpperCase()+st.slice(1)+'</span>'+
          '</div>'+
          (r.reason ? '<div class="adv-item-reason">💬 '+esc(r.reason)+'</div>' : '')+
          '</div>';
      }).join('');
    })
    .catch(function(e){
      $('advList').innerHTML = '<div class="empty">Failed: '+esc(e.message)+'</div>';
    });
}

function loadHistory(){
  $('histList').innerHTML = '<div class="empty"><div class="ei">⏳</div>Loading…</div>';
  api('/prajapati_expenses?team_member_phone=eq.'+encodeURIComponent(state.member.phone)+'&source=eq.field&select=*&order=expense_date.desc&limit=200')
    .then(function(rows){
      if (!rows || !rows.length){
        $('histList').innerHTML = '<div class="empty"><div class="ei">📋</div>Abhi koi expense nahi daala</div>';
        return;
      }
      window._histCache = {};
      rows.forEach(function(e){ window._histCache[e.id] = e; });
      $('histList').innerHTML = rows.map(renderExpCard).join('');
    })
    .catch(function(e){ $('histList').innerHTML='<div class="empty"><div class="ei">⚠️</div>Load error</div>'; });
}

function renderExpCard(e){
  var d = e.expense_date ? new Date(e.expense_date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '—';
  // status badge — paid > approval_status
  var badge, btxt;
  if (e.payment_status === 'paid'){ badge='paid'; btxt='✓ Paid'; }
  else if (e.approval_status === 'approved'){ badge='approved'; btxt='Approved'; }
  else if (e.approval_status === 'rejected'){ badge='rejected'; btxt='Rejected'; }
  else { badge='pending'; btxt='Pending'; }

  var parts = [];
  if (+e.food_amount>0)  parts.push('🍱'+e.food_amount);
  if (+e.auto_amount>0)  parts.push('🛺'+e.auto_amount);
  if (+e.hotel_amount>0) parts.push('🏨'+e.hotel_amount);
  if (+e.bus_amount>0)   parts.push('🚌'+e.bus_amount);
  if (+e.other_amount>0) parts.push('📦'+e.other_amount);
  var catStr = parts.join(' · ');
  var campStr = e.campaign_name ? (' · '+e.campaign_name) : '';
  var rejRow = (e.approval_status==='rejected' && e.reject_reason) ? '<div class="erem">❌ '+esc(e.reject_reason)+'</div>' : '';
  var remRow = e.remark ? '<div class="erem">📝 '+esc(e.remark)+'</div>' : '';
  // Payment proof — paid hone pe mode + receipt photo dikhe
  var payRow = '';
  if (e.payment_status === 'paid'){
    var pm = e.paid_via ? ('💸 Paid via '+esc(e.paid_via)) : '💸 Paid';
    if (e.paid_date) pm += ' · '+esc(e.paid_date);
    payRow = '<div class="erem" style="color:#15803d;font-weight:600">'+pm+'</div>';
    var rcptUrl = e.payment_receipt_url || e.receipt_url;
    if (rcptUrl){
      payRow += '<div style="margin-top:6px"><a href="'+esc(rcptUrl)+'" target="_blank"><img src="'+esc(rcptUrl)+'" style="max-width:100%;border-radius:8px;border:1px solid #86efac"></a><div style="font-size:10px;color:#888;margin-top:2px">Payment receipt — tap to view</div></div>';
    }
  }

  return '<div class="exp-card">'+
    '<div class="er1"><span class="ed">📅 '+d+'</span><span class="ea">₹'+(e.total_amount||0)+'</span></div>'+
    '<div class="er2"><span class="ecat">'+esc(catStr)+esc(campStr)+'</span><span class="badge '+badge+'">'+btxt+'</span></div>'+
    remRow + rejRow + payRow +
    '<div style="margin-top:8px;text-align:right"><button onclick="slipPDF(\''+esc(e.id)+'\')" style="background:#eef2ff;color:#4338ca;border:none;padding:6px 12px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer">📄 Slip PDF</button></div>'+
  '</div>';
}

// Slip PDF (worker apna record)
window._histCache = window._histCache || {};
function slipPDF(id){
  var e = (window._histCache[id]);
  if(!e){ toast('Reload karo','error'); return; }
  if(typeof window.jspdf==='undefined'){ toast('PDF lib loading…','warn'); return; }
  var jsPDF = window.jspdf.jsPDF;
  var doc = new jsPDF({unit:'pt',format:'a5'});
  var W = doc.internal.pageSize.getWidth();
  var M = 32;
  doc.setFillColor(26,41,128); doc.rect(0,0,W,82,'F');
  doc.setTextColor(255,255,255); doc.setFontSize(17); doc.setFont('helvetica','bold');
  doc.text('Prajapati Advertising',M,34);
  doc.setFontSize(8.5); doc.setFont('helvetica','normal'); doc.setTextColor(220,225,240);
  doc.text('Ph: 9922138138   |   www.prajapatiadvertising.com',M,50);
  doc.setFillColor(245,184,0); doc.rect(0,82,W,3,'F');
  var slipNo = 'EXP-'+String(e.id||'').slice(-6).toUpperCase();
  doc.setTextColor(26,41,128); doc.setFontSize(13); doc.setFont('helvetica','bold');
  doc.text('EXPENSE SLIP',M,112);
  doc.setFontSize(8.5); doc.setFont('helvetica','normal'); doc.setTextColor(120,120,120);
  doc.text('Slip No: '+slipNo,W-M,104,{align:'right'});
  doc.text('Date: '+(e.expense_date||'-'),W-M,116,{align:'right'});
  var y=138; doc.setTextColor(40,40,40);
  function info(l,v){ doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.setTextColor(110,110,110); doc.text(String(l),M,y); doc.setFont('helvetica','normal'); doc.setTextColor(30,30,30); doc.text(String(v==null?'-':v),M+90,y); y+=18; }
  info('Campaign', e.campaign_name||'-');
  info('Member', e.team_member_name||'-');
  y+=4; doc.setFillColor(243,244,248); doc.rect(M,y,W-2*M,22,'F');
  doc.setFont('helvetica','bold'); doc.setFontSize(8.5); doc.setTextColor(26,41,128);
  doc.text('CATEGORY',M+8,y+15); doc.text('AMOUNT (Rs.)',W-M-8,y+15,{align:'right'}); y+=22;
  doc.setFont('helvetica','normal'); doc.setTextColor(40,40,40); doc.setFontSize(9.5);
  function line(l,v){ if(!v) return; doc.text(l,M+8,y+14); doc.text('Rs. '+v,W-M-8,y+14,{align:'right'}); doc.setDrawColor(235); doc.line(M,y+20,W-M,y+20); y+=22; }
  line('Food', e.food_amount); line('Auto', e.auto_amount); line('Hotel', e.hotel_amount);
  line('Bus', e.bus_amount); line('Other', e.other_amount);
  if(e.remark){ doc.setFontSize(8); doc.setTextColor(120,120,120); doc.text('Remark: '+e.remark, M+8, y+12); y+=18; }
  y+=6; doc.setFillColor(26,41,128); doc.rect(M,y,W-2*M,30,'F');
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(13);
  doc.text('TOTAL',M+10,y+20); doc.text('Rs. '+(e.total_amount||0),W-M-10,y+20,{align:'right'}); y+=42;
  var st = e.payment_status==='paid'?'PAID':(e.approval_status||'pending').toUpperCase();
  doc.setFontSize(9); doc.setTextColor(110,110,110); doc.setFont('helvetica','normal');
  doc.text('Status: '+st,M,y);
  doc.setFontSize(7); doc.setTextColor(160,160,160);
  doc.text('This is a computer-generated slip.',W/2,doc.internal.pageSize.getHeight()-20,{align:'center'});
  doc.save('ExpenseSlip_'+slipNo+'.pdf');
  toast('✅ Slip downloaded','success');
}

// ════════ PROFILE (Settings) ════════
var _docFiles = { aadhaar:null, pan:null, upiqr:null };

function loadProfile(){
  api('/prajapati_team_bank_profile?member_phone=eq.'+encodeURIComponent(state.member.phone)+'&select=*')
    .then(function(rows){
      if (rows && rows.length){
        var p = rows[0]; state.profile = p;
        $('pf-holder').value = p.account_holder||'';
        $('pf-bank').value   = p.bank_name||'';
        $('pf-acc').value    = p.account_number||'';
        $('pf-ifsc').value   = p.ifsc_code||'';
        $('pf-upi').value    = p.upi_id||'';
        $('pf-aadhaar').value= p.aadhaar_number||'';
        $('pf-pan').value    = p.pan_number||'';
        if (p.aadhaar_photo_url){ var ai=$('aadhaar-prev'); ai.src=p.aadhaar_photo_url; ai.style.display='block'; $('aadhaar-up-btn').className='up-btn has'; $('aadhaar-up-btn').textContent='✓ Aadhaar uploaded'; }
        if (p.pan_photo_url){ var pi=$('pan-prev'); pi.src=p.pan_photo_url; pi.style.display='block'; $('pan-up-btn').className='up-btn has'; $('pan-up-btn').textContent='✓ PAN uploaded'; }
        if (p.upi_qr_url){ var qi=$('upiqr-prev'); qi.src=p.upi_qr_url; qi.style.display='block'; $('upiqr-up-btn').className='up-btn has'; $('upiqr-up-btn').textContent='✓ UPI QR uploaded'; }
      }
    })
    .catch(function(e){ console.warn('profile load', e); });
}

function pickDoc(kind, input){
  var f = input.files && input.files[0];
  if (!f) return;
  _docFiles[kind] = f;
  var prev = $(kind+'-prev');
  var objUrl = URL.createObjectURL(f);
  prev.src = objUrl; prev.style.display='block';
  var lbl = kind==='aadhaar'?'Aadhaar':(kind==='pan'?'PAN':'UPI QR');
  var btn = $(kind+'-up-btn');
  if (btn){ btn.className='up-btn has'; btn.textContent='✓ '+lbl+' selected'; }

  // ── SCANNER: Aadhaar/PAN se number auto-read ──
  if (kind === 'aadhaar' || kind === 'pan'){
    scanDocument(kind, f, objUrl);
  }
}

// Scan: pehle QR (Aadhaar — 100% accurate), phir OCR (number nikaalo)
function scanDocument(kind, file, objUrl){
  var numInput = $('pf-'+kind);
  var btn = $(kind+'-up-btn');
  var orig = btn ? btn.textContent : '';
  if (btn) btn.textContent = '🔍 Scanning…';

  var img = new Image();
  img.onload = function(){
    // 1) Aadhaar QR try (sirf aadhaar)
    if (kind === 'aadhaar' && typeof jsQR !== 'undefined'){
      try{
        var cv = document.createElement('canvas');
        var sc = Math.min(1000/img.width, 1);
        cv.width = img.width*sc; cv.height = img.height*sc;
        var cx = cv.getContext('2d');
        cx.drawImage(img,0,0,cv.width,cv.height);
        var imgData = cx.getImageData(0,0,cv.width,cv.height);
        var qr = jsQR(imgData.data, cv.width, cv.height);
        if (qr && qr.data){
          // Aadhaar QR mein number hota hai (secure QR mein last 4, old mein full)
          var qnum = (qr.data.match(/\d{12}/)||[])[0];
          if (qnum && numInput){ numInput.value = qnum; toast('✅ Aadhaar QR se number mila','success'); if(btn)btn.textContent=orig; return; }
        }
      }catch(e){ console.warn('QR fail', e); }
    }
    // 2) OCR fallback (Tesseract) — number text se nikaalo
    runOCR(kind, objUrl, numInput, btn, orig);
  };
  img.onerror = function(){ if(btn)btn.textContent=orig; };
  img.src = objUrl;
}

function runOCR(kind, objUrl, numInput, btn, orig){
  if (typeof Tesseract === 'undefined'){ if(btn)btn.textContent=orig; return; }
  if (btn) btn.textContent = '🔍 Reading number…';
  Tesseract.recognize(objUrl, 'eng', {})
    .then(function(res){
      var text = (res.data.text||'').replace(/\s+/g,' ');
      var num = '';
      if (kind === 'aadhaar'){
        // 12 digit (may have spaces: 1234 5678 9012)
        var m = text.replace(/[^0-9]/g,'').match(/\d{12}/);
        if (m) num = m[0];
      } else if (kind === 'pan'){
        // PAN: 5 letters + 4 digits + 1 letter
        var p = text.toUpperCase().match(/[A-Z]{5}[0-9]{4}[A-Z]/);
        if (p) num = p[0];
      }
      if (num && numInput){
        numInput.value = num;
        toast('✅ '+(kind==='aadhaar'?'Aadhaar':'PAN')+' number mila — check kar lo','success');
      } else {
        toast('⚠️ Number clear nahi mila — manually daalo','warn');
      }
    })
    .catch(function(e){ console.warn('OCR fail', e); toast('Scan fail — manually daalo','warn'); })
    .finally(function(){ if(btn)btn.textContent=orig; });
}

function uploadDoc(kind, file){
  var safe = file.name.replace(/[^a-zA-Z0-9._-]/g,'_');
  var path = 'team-docs/'+state.member.phone+'/'+kind+'_'+Date.now()+'_'+safe;
  return fetch(SUPABASE_URL+'/storage/v1/object/'+RECEIPT_BUCKET+'/'+encodeURI(path), {
    method:'POST',
    headers:{ apikey:SUPABASE_KEY, Authorization:'Bearer '+SUPABASE_KEY, 'Content-Type':file.type||'image/jpeg', 'x-upsert':'true' },
    body:file
  }).then(function(r){
    if (!r.ok) return r.text().then(function(t){ throw new Error('Upload '+r.status+': '+(t||'').slice(0,100)); });
    return SUPABASE_URL+'/storage/v1/object/public/'+RECEIPT_BUCKET+'/'+encodeURI(path);
  });
}

function saveProfile(){
  var btn = $('saveProfileBtn');
  btn.disabled=true; btn.textContent='⏳ Saving…';

  var payload = {
    member_phone: state.member.phone,
    member_name: state.member.name || state.member.phone,
    account_holder: $('pf-holder').value.trim() || null,
    bank_name: $('pf-bank').value.trim() || null,
    account_number: $('pf-acc').value.trim() || null,
    ifsc_code: $('pf-ifsc').value.trim().toUpperCase() || null,
    upi_id: $('pf-upi').value.trim() || null,
    aadhaar_number: $('pf-aadhaar').value.trim() || null,
    pan_number: $('pf-pan').value.trim().toUpperCase() || null,
    updated_at: new Date().toISOString()
  };

  // Photo upload — agar fail ho to bhi text save ho jaaye (non-blocking)
  var photoWarn = [];
  var uploads = [];
  function tryUp(kind, urlKey){
    if (!_docFiles[kind]) return;
    uploads.push(
      uploadDoc(kind, _docFiles[kind])
        .then(function(u){ payload[urlKey]=u; })
        .catch(function(e){ photoWarn.push(kind); console.warn('upload fail', kind, e); })
    );
  }
  tryUp('aadhaar','aadhaar_photo_url');
  tryUp('pan','pan_photo_url');
  tryUp('upiqr','upi_qr_url');

  Promise.all(uploads).then(function(){
    return api('/prajapati_team_bank_profile?on_conflict=member_phone', {
      method:'POST',
      body:payload,
      prefer:'resolution=merge-duplicates,return=minimal'
    });
  }).then(function(){
    _docFiles = { aadhaar:null, pan:null, upiqr:null };
    btn.disabled=false; btn.textContent='💾 Save My Details';
    if (photoWarn.length){
      toast('✅ Details saved (par '+photoWarn.join(', ')+' photo upload fail — phir try karo)','warn');
    } else {
      toast('✅ Details saved','success');
    }
  }).catch(function(e){
    btn.disabled=false; btn.textContent='💾 Save My Details';
    var msg = e.message||String(e);
    // Common errors ko samajhne layak banao
    if (msg.indexOf('does not exist')!==-1 || msg.indexOf('relation')!==-1){
      toast('❌ Database table nahi bani — admin se SQL chalwao','error');
    } else if (msg.indexOf('on_conflict')!==-1 || msg.indexOf('constraint')!==-1){
      toast('❌ Save error — admin se backend SQL check karwao','error');
    } else {
      toast('❌ Save fail: '+msg.slice(0,80),'error');
    }
    console.error('saveProfile error:', e);
  });
}

// ════════ SW + boot ════════
if ('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw-expenses.js', { scope:'/expenses-field.html' }).catch(function(){});
}
document.addEventListener('DOMContentLoaded', bootAuth);
