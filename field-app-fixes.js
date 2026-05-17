// ════════════════════════════════════════════════════════════════════
// PRAJAPATI FIELD APP — TWO CRITICAL FIXES
// 
// Bug 1: GPS stamp text getting CUT OFF on right side
// Bug 2: Camera default zoom too high (zoomed in, not wide enough)
//
// HOW TO APPLY:
// 1. Find your existing camera open function in /app.js
//    (search: getUserMedia, openInAppCamera, or startCamera)
// 2. Replace zoom setting with applyWidestZoom() function below
// 3. Find your photo capture/processing function
//    (search: captureFromInAppCamera, drawImage, or canvas.toBlob)
// 4. Replace stamp drawing call with drawProfessionalGPSStamp()
// ════════════════════════════════════════════════════════════════════


// ────────────────────────────────────────────────────────────────────
// FIX 1: SET CAMERA TO WIDEST DEFAULT ZOOM (0.5x ultrawide if available)
// ────────────────────────────────────────────────────────────────────
/**
 * After getUserMedia stream starts, call this with the video track
 * to set the WIDEST possible zoom (often 0.5x ultrawide on modern phones).
 * 
 * @param {MediaStreamTrack} videoTrack - From stream.getVideoTracks()[0]
 */
async function applyWidestZoom(videoTrack) {
  if (!videoTrack || !videoTrack.getCapabilities) {
    console.log('[Camera] No capabilities API — skipping zoom adjustment');
    return;
  }
  
  try {
    const caps = videoTrack.getCapabilities();
    console.log('[Camera] Capabilities:', caps);
    
    if (caps.zoom) {
      // Set to MINIMUM zoom (widest view)
      // On phones with ultrawide, this is 0.5x. On standard cams, it's 1.0x
      const minZoom = caps.zoom.min;
      console.log('[Camera] Setting zoom to min (widest):', minZoom + 'x');
      
      await videoTrack.applyConstraints({
        advanced: [{ zoom: minZoom }]
      });
      
      // Update on-screen indicator if exists
      const indicator = document.getElementById('cam-zoom-indicator');
      if (indicator) {
        indicator.textContent = minZoom.toFixed(1) + 'x';
        indicator.classList.add('show');
        setTimeout(function() { indicator.classList.remove('show'); }, 1500);
      }
    } else {
      console.log('[Camera] Zoom not supported on this device — using default FOV');
    }
  } catch (err) {
    console.warn('[Camera] applyWidestZoom failed:', err);
  }
}


/**
 * Replace your camera open code with this. Selects back camera + wide FOV
 * + applies minimum zoom (widest) automatically after stream starts.
 */
async function openInAppCameraWide() {
  const video = document.getElementById('cam-feed');
  const modal = document.getElementById('cam-modal');
  const shutter = document.getElementById('cam-shutter');
  
  // Prefer back camera with wide FOV constraints
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
      // Request wide FOV hint (some browsers honor this)
      advanced: [
        { zoom: 1.0 },           // request 1x first
        { focusMode: 'continuous' }
      ]
    }
  };
  
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    modal.classList.add('show');
    
    // Wait for video to be ready before applying zoom
    await new Promise(function(resolve) {
      if (video.readyState >= 2) resolve();
      else video.addEventListener('loadeddata', resolve, { once: true });
    });
    
    // Apply WIDEST zoom after stream is live
    const track = stream.getVideoTracks()[0];
    setTimeout(function() { applyWidestZoom(track); }, 300);
    
    // Store stream for cleanup later
    window._cameraStream = stream;
    
    // Enable shutter
    if (shutter) shutter.disabled = false;
    
  } catch (err) {
    console.error('[Camera] Open failed:', err);
    alert('Camera access nahi mila: ' + err.message);
  }
}


// ────────────────────────────────────────────────────────────────────
// FIX 2: GPS STAMP THAT FITS ANY PHOTO WIDTH (NO CUTOFF)
// ────────────────────────────────────────────────────────────────────
/**
 * Draws professional GPS stamp on canvas that ADAPTS to canvas width.
 * Wraps long text, scales font sizes, never cuts off content.
 * 
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} canvasW - Canvas width
 * @param {number} canvasH - Canvas height
 * @param {object} data - { city, state, address, lat, lng, dateStr, timeStr }
 */
function drawProfessionalGPSStamp(ctx, canvasW, canvasH, data) {
  // Stamp dimensions — scaled to canvas width
  const stampH = Math.round(canvasH * 0.16);     // 16% of photo height
  const stampY = canvasH - stampH;
  const pad = Math.round(canvasW * 0.015);       // 1.5% padding
  const mapSize = stampH - (pad * 2);            // square map
  
  // Background dark overlay
  ctx.fillStyle = 'rgba(10, 14, 26, 0.88)';
  ctx.fillRect(0, stampY, canvasW, stampH);
  
  // Gold accent line at top
  ctx.fillStyle = '#D4AF37';
  ctx.fillRect(0, stampY, canvasW, 2);
  
  // ─── MAP THUMBNAIL (left side, Google-style) ───
  const mapX = pad;
  const mapY = stampY + pad;
  
  // Green map background
  ctx.fillStyle = '#7AA070';
  ctx.fillRect(mapX, mapY, mapSize, mapSize);
  
  // Road lines (cross pattern)
  ctx.fillStyle = '#D8D4C0';
  ctx.fillRect(mapX, mapY + mapSize * 0.4, mapSize, mapSize * 0.06); // horizontal
  ctx.fillRect(mapX + mapSize * 0.45, mapY, mapSize * 0.04, mapSize); // vertical
  
  // Red pin (Google Maps style)
  const pinX = mapX + mapSize * 0.5;
  const pinY = mapY + mapSize * 0.45;
  const pinR = mapSize * 0.12;
  
  ctx.fillStyle = '#DB4437';
  ctx.beginPath();
  ctx.arc(pinX, pinY - pinR, pinR, 0, Math.PI * 2);
  ctx.fill();
  // Pin tail (triangle pointing down)
  ctx.beginPath();
  ctx.moveTo(pinX - pinR * 0.7, pinY - pinR * 0.5);
  ctx.lineTo(pinX + pinR * 0.7, pinY - pinR * 0.5);
  ctx.lineTo(pinX, pinY + pinR * 0.8);
  ctx.closePath();
  ctx.fill();
  // White dot center
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(pinX, pinY - pinR, pinR * 0.3, 0, Math.PI * 2);
  ctx.fill();
  
  // "Google" label
  ctx.fillStyle = '#fff';
  ctx.font = 'bold ' + Math.round(mapSize * 0.13) + 'px Arial';
  ctx.textBaseline = 'bottom';
  ctx.fillText('Google', mapX + 3, mapY + mapSize - 3);
  
  // ─── INFO BLOCK (right of map) ───
  const infoX = mapX + mapSize + pad;
  const infoW = canvasW - infoX - pad;  // CRITICAL: respects canvas width
  let infoY = stampY + pad + 4;
  
  // Helper: wrap text to multi-line within infoW
  function wrapText(text, maxW, fontSize) {
    ctx.font = fontSize;
    const words = String(text || '').split(' ');
    const lines = [];
    let current = '';
    for (let w of words) {
      const test = current ? current + ' ' + w : w;
      if (ctx.measureText(test).width <= maxW) {
        current = test;
      } else {
        if (current) lines.push(current);
        current = w;
      }
    }
    if (current) lines.push(current);
    return lines;
  }
  
  // CITY (large, bold) — line 1
  const cityFontSize = Math.round(stampH * 0.14);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold ' + cityFontSize + 'px "Segoe UI", Arial, sans-serif';
  ctx.textBaseline = 'top';
  
  const cityText = (data.city || '—') + (data.state ? ', ' + data.state : '');
  const cityLines = wrapText(cityText, infoW - 24, ctx.font);  // -24 for India flag space
  
  // Draw only first line of city (truncate if too long)
  let cityFinal = cityLines[0];
  if (cityLines.length > 1) {
    // Try fitting more of the city name with ellipsis
    const fullW = ctx.measureText(cityText).width;
    if (fullW > infoW - 24) {
      // Truncate intelligently with ellipsis
      let chars = cityText.length;
      while (chars > 0 && ctx.measureText(cityText.substring(0, chars) + '…').width > infoW - 24) {
        chars--;
      }
      cityFinal = cityText.substring(0, chars) + '…';
    } else {
      cityFinal = cityText;
    }
  }
  ctx.fillText(cityFinal, infoX, infoY);
  
  // India flag mini (right of city, if space)
  const cityW = ctx.measureText(cityFinal).width;
  if (cityW + 22 < infoW) {
    const flagX = infoX + cityW + 8;
    const flagY = infoY + cityFontSize * 0.15;
    const flagW = 16;
    const flagH = 10;
    ctx.fillStyle = '#FF9933'; ctx.fillRect(flagX, flagY, flagW, flagH/3);
    ctx.fillStyle = '#fff';    ctx.fillRect(flagX, flagY + flagH/3, flagW, flagH/3);
    ctx.fillStyle = '#138808'; ctx.fillRect(flagX, flagY + (flagH*2)/3, flagW, flagH/3);
    // Ashok Chakra dot
    ctx.fillStyle = '#000080';
    ctx.beginPath();
    ctx.arc(flagX + flagW/2, flagY + flagH/2, 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
  
  infoY += cityFontSize + 4;
  
  // ADDRESS (smaller, may wrap to 2 lines) — line 2-3
  const addrFontSize = Math.round(stampH * 0.085);
  const addrLines = wrapText(data.address || '—', infoW, 
    addrFontSize + 'px "Segoe UI", Arial, sans-serif');
  
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.font = addrFontSize + 'px "Segoe UI", Arial, sans-serif';
  
  // Show max 2 lines of address with ellipsis on 2nd line if more
  const maxAddrLines = 2;
  for (let i = 0; i < Math.min(addrLines.length, maxAddrLines); i++) {
    let line = addrLines[i];
    if (i === maxAddrLines - 1 && addrLines.length > maxAddrLines) {
      // Add ellipsis if more lines exist
      while (ctx.measureText(line + '…').width > infoW && line.length > 0) {
        line = line.slice(0, -1);
      }
      line += '…';
    }
    ctx.fillText(line, infoX, infoY);
    infoY += addrFontSize + 3;
  }
  
  // LAT/LNG (monospace, smaller) — line 4
  const coordFontSize = Math.round(stampH * 0.085);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.font = coordFontSize + 'px "JetBrains Mono", "Courier New", monospace';
  
  const lat = data.lat ? Number(data.lat).toFixed(6) : '—';
  const lng = data.lng ? Number(data.lng).toFixed(6) : '—';
  const coordText = 'Lat ' + lat + '°   Long ' + lng + '°';
  
  // Truncate coord line if too wide (rare on 1080+ photos)
  let coordFinal = coordText;
  while (ctx.measureText(coordFinal).width > infoW && coordFinal.length > 10) {
    coordFinal = coordFinal.slice(0, -1);
  }
  if (coordFinal !== coordText) coordFinal = coordFinal.slice(0, -1) + '…';
  ctx.fillText(coordFinal, infoX, infoY);
  
  infoY += coordFontSize + 3;
  
  // DATE/TIME (smallest) — line 5
  const dtFontSize = Math.round(stampH * 0.075);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.font = dtFontSize + 'px "Segoe UI", Arial, sans-serif';
  
  const dtText = (data.dateStr || '') + ' ' + (data.timeStr || '') + ' GMT+5:30';
  let dtFinal = dtText;
  while (ctx.measureText(dtFinal).width > infoW && dtFinal.length > 10) {
    dtFinal = dtFinal.slice(0, -1);
  }
  if (dtFinal !== dtText) dtFinal = dtFinal.slice(0, -1) + '…';
  ctx.fillText(dtFinal, infoX, infoY);
}


// ────────────────────────────────────────────────────────────────────
// EXAMPLE: How to use drawProfessionalGPSStamp in your capture flow
// ────────────────────────────────────────────────────────────────────
/*

async function captureAndStamp(videoElement, gpsData) {
  const canvas = document.createElement('canvas');
  canvas.width = videoElement.videoWidth;   // Use full resolution
  canvas.height = videoElement.videoHeight;
  const ctx = canvas.getContext('2d');
  
  // 1. Draw the photo
  ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
  
  // 2. Draw the GPS stamp (auto-fits any width)
  drawProfessionalGPSStamp(ctx, canvas.width, canvas.height, {
    city: gpsData.city || 'Kandivali East',
    state: gpsData.state || 'Maharashtra',
    address: gpsData.address || 'Kandivali, East, R/S, Ward, Mumbai',
    lat: gpsData.lat,        // e.g. 19.196521
    lng: gpsData.lng,        // e.g. 72.857432
    dateStr: gpsData.dateStr || 'Sunday, 17/05/2026',
    timeStr: gpsData.timeStr || '07:00 PM'
  });
  
  // 3. Convert to blob and upload
  return new Promise(function(resolve) {
    canvas.toBlob(function(blob) {
      resolve(blob);
    }, 'image/jpeg', 0.92);
  });
}

*/


// ────────────────────────────────────────────────────────────────────
// TESTING UTILITY — Preview stamp without taking actual photo
// ────────────────────────────────────────────────────────────────────
/*
Open browser console and run:

(function() {
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1920;
  const ctx = c.getContext('2d');
  
  // Simulate photo background
  ctx.fillStyle = '#888'; ctx.fillRect(0, 0, c.width, c.height);
  
  // Draw stamp
  drawProfessionalGPSStamp(ctx, c.width, c.height, {
    city: 'Kandivali East',
    state: 'Maharashtra', 
    address: 'Kandivali, East, R/S, Ward, Mumbai, Zone, 4, Mumbai',
    lat: 19.196521,
    lng: 72.857432,
    dateStr: 'Sunday, 17/05/2026',
    timeStr: '07:00 PM'
  });
  
  // Show preview in new window
  const img = new Image();
  img.src = c.toDataURL();
  const w = window.open();
  w.document.body.appendChild(img);
})();
*/
