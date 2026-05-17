// ════════════════════════════════════════════════════════════════════
// FIELD APP — Manual GPS Date Range Logic
//
// Add this function to /app.js (field app's main script)
// 
// Use case:
//   - Campaign has manual_gps_enabled = true
//   - Has manual_valid_from = '2026-05-17' and manual_valid_to = '2026-05-25'
//   - Today is 17 May → use manual GPS (anchor + radius)
//   - Today is 30 May → use real device GPS
//   - Date fields NULL → use manual always (backward compat)
// ════════════════════════════════════════════════════════════════════

/**
 * Decides whether to use manual GPS or real device GPS based on:
 *   1. Campaign's manual_gps_enabled flag
 *   2. Campaign's manual_valid_from / manual_valid_to date range
 *   3. Today's date (IST)
 *   4. Per-member GPS overrides (trial_member_gps_overrides)
 *
 * @param {object} campaign - Current campaign object from trial_campaigns
 * @param {array} memberOverrides - Member's GPS overrides for this campaign
 * @returns {object} {useManual: boolean, anchorLat, anchorLng, radiusM, source: 'member' | 'campaign' | 'real'}
 */
function decideGpsMode(campaign, memberOverrides) {
  // Get today's date in IST (matches DB timezone)
  var now = new Date();
  var istOffsetMs = 5.5 * 60 * 60 * 1000;
  var todayIST = new Date(now.getTime() + istOffsetMs).toISOString().slice(0, 10);
  
  // PRIORITY 1: Check per-member override (most specific)
  if (memberOverrides && memberOverrides.length > 0) {
    var activeMemberOverride = memberOverrides.find(function(o) {
      if (!o.active) return false;
      if (!o.valid_from || !o.valid_to) return false;
      return todayIST >= o.valid_from && todayIST <= o.valid_to;
    });
    
    if (activeMemberOverride) {
      return {
        useManual: true,
        anchorLat: activeMemberOverride.anchor_lat,
        anchorLng: activeMemberOverride.anchor_lng,
        radiusM: activeMemberOverride.gps_radius_m || 50,
        source: 'member'
      };
    }
  }
  
  // PRIORITY 2: Check campaign-level manual GPS
  if (campaign && campaign.manual_gps_enabled) {
    var inRange = true;
    
    // If date range set, check today is within range
    if (campaign.manual_valid_from && campaign.manual_valid_to) {
      inRange = todayIST >= campaign.manual_valid_from && todayIST <= campaign.manual_valid_to;
    }
    // If dates NULL → always on (backward compat with existing campaigns)
    
    if (inRange && campaign.anchor_lat && campaign.anchor_lng) {
      return {
        useManual: true,
        anchorLat: campaign.anchor_lat,
        anchorLng: campaign.anchor_lng,
        radiusM: campaign.gps_radius_m || 50,
        source: 'campaign'
      };
    }
  }
  
  // PRIORITY 3: Real device GPS
  return {
    useManual: false,
    source: 'real'
  };
}


/**
 * Generate random GPS coordinates within radius of anchor.
 * Used when useManual = true.
 *
 * @param {number} anchorLat - Anchor latitude
 * @param {number} anchorLng - Anchor longitude  
 * @param {number} radiusM - Variation radius in meters
 * @returns {object} {lat, lng} - Random point within radius
 */
function generateManualGpsPoint(anchorLat, anchorLng, radiusM) {
  // Convert radius from meters to degrees (approximate, India latitude)
  var radiusDeg = radiusM / 111000; // 1 deg ≈ 111 km at equator
  
  // Random angle + distance
  var angle = Math.random() * 2 * Math.PI;
  var distance = Math.sqrt(Math.random()) * radiusDeg; // sqrt for uniform distribution
  
  return {
    lat: anchorLat + distance * Math.cos(angle),
    lng: anchorLng + distance * Math.sin(angle) / Math.cos(anchorLat * Math.PI / 180)
  };
}


// ────────────────────────────────────────────────────────────────────
// USAGE EXAMPLE in capture flow:
// ────────────────────────────────────────────────────────────────────
/*

async function captureWithGps(campaign, memberPhone) {
  // 1. Fetch member's GPS overrides for current campaign
  var overridesResp = await fetch(
    SUPABASE_URL + '/rest/v1/trial_member_gps_overrides' +
    '?member_phone=eq.' + memberPhone +
    '&campaign_key=eq.' + campaign.key,
    { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } }
  );
  var memberOverrides = await overridesResp.json();
  
  // 2. Decide GPS mode (date-driven)
  var decision = decideGpsMode(campaign, memberOverrides);
  
  if (decision.useManual) {
    // Generate manual coords with random variation
    var point = generateManualGpsPoint(
      decision.anchorLat, 
      decision.anchorLng, 
      decision.radiusM
    );
    console.log('[GPS] Using MANUAL (source:', decision.source, ')', point);
    return { lat: point.lat, lng: point.lng, accuracy: 5, source: 'manual' };
  } else {
    // Use real device GPS
    return new Promise(function(resolve, reject) {
      navigator.geolocation.getCurrentPosition(
        function(pos) {
          console.log('[GPS] Using REAL device GPS');
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            source: 'real'
          });
        },
        reject,
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
  }
}

*/
