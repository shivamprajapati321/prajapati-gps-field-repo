// ═══════════════════════════════════════════════════════════════════════
// /lib/wati-client.js — v1.0
// 
// Browser library for Wati WhatsApp OTP + Templates
// 
// Usage:
//   <script src="/lib/wati-client.js"></script>
//   <script>
//     const res = await WatiClient.sendOTP('9922138138');
//     if (res.success) {
//       // Show OTP input...
//       const verify = await WatiClient.verifyOTP('9922138138', '482917');
//       if (verify.success) {
//         // Logged in! verify.member has user data
//         WatiClient.saveSession(verify);
//         window.location.href = WatiClient.getHomeForRole(verify.member.role);
//       }
//     }
//   </script>
// ═══════════════════════════════════════════════════════════════════════

(function(window) {
  'use strict';

  const CONFIG = {
    supabaseUrl: 'https://fpbktcgtspqsqpaytslv.supabase.co',
    supabaseKey: 'sb_publishable_JhObe56x_zETygpy6y8-DQ_qpQXIz_j',
    sendUrl: 'https://fpbktcgtspqsqpaytslv.supabase.co/functions/v1/wati-send',
    verifyUrl: 'https://fpbktcgtspqsqpaytslv.supabase.co/functions/v1/wati-verify-otp',
    sessionKey: 'prajapati_session',
    timeout: 15000
  };

  // ─── Internal: API call with timeout ──────────────────────────────────
  async function apiCall(url, body) {
    const ctrl = new AbortController();
    const timeoutId = setTimeout(() => ctrl.abort(), CONFIG.timeout);
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + CONFIG.supabaseKey,
          'apikey': CONFIG.supabaseKey
        },
        body: JSON.stringify(body)
      });
      clearTimeout(timeoutId);
      const text = await res.text();
      try { return JSON.parse(text); }
      catch { return { success: false, error: 'Invalid response: ' + text.slice(0, 100) }; }
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') return { success: false, error: 'Network timeout' };
      return { success: false, error: err.message };
    }
  }

  // ─── Internal: Phone normalization ────────────────────────────────────
  function validatePhone(phone) {
    if (!phone) return null;
    const cleaned = String(phone).replace(/\D/g, '');
    if (cleaned.length === 10) return cleaned;
    if (cleaned.length === 12 && cleaned.startsWith('91')) return cleaned.slice(2);
    if (cleaned.length === 11 && cleaned.startsWith('0')) return cleaned.slice(1);
    return null;
  }

  // ─── Public API ───────────────────────────────────────────────────────
  const WatiClient = {

    /**
     * Send WhatsApp OTP
     * @param {string} phone - 10 digit phone
     * @returns {Promise<{success, otp_id, expires_at, masked_phone, error?}>}
     */
    async sendOTP(phone, options = {}) {
      const validPhone = validatePhone(phone);
      if (!validPhone) return { success: false, error: 'Invalid phone (need 10 digits)' };
      
      const result = await apiCall(CONFIG.sendUrl, {
        action: 'send_otp',
        phone: validPhone,
        purpose: options.purpose || 'login',
        ip_address: window.location.hostname
      });
      
      if (result.success) {
        sessionStorage.setItem(CONFIG.sessionKey + '_pending', JSON.stringify({
          phone: validPhone,
          otp_id: result.otp_id,
          expires_at: result.expires_at,
          sent_at: Date.now()
        }));
      }
      
      return result;
    },

    /**
     * Verify OTP and get session
     * @returns {Promise<{success, session_token, member, expires_in, error?}>}
     */
    async verifyOTP(phone, code) {
      const validPhone = validatePhone(phone);
      if (!validPhone) return { success: false, error: 'Invalid phone' };
      
      const cleanCode = String(code).replace(/\D/g, '');
      if (cleanCode.length !== 6) return { success: false, error: 'OTP must be 6 digits' };
      
      return await apiCall(CONFIG.verifyUrl, {
        phone: validPhone,
        code: cleanCode
      });
    },

    /**
     * Save verified session to localStorage
     */
    saveSession(verifyResult) {
      if (!verifyResult || !verifyResult.success) return false;
      const session = {
        token: verifyResult.session_token,
        member: verifyResult.member,
        phone: verifyResult.member.phone,
        verified_at: Date.now(),
        expires_at: Date.now() + (verifyResult.expires_in * 1000)
      };
      localStorage.setItem(CONFIG.sessionKey, JSON.stringify(session));
      sessionStorage.removeItem(CONFIG.sessionKey + '_pending');
      return true;
    },

    /**
     * Manually save session (for non-OTP login like field workers)
     */
    savePasswordSession(member) {
      const session = {
        token: 'pwd_' + Date.now() + '_' + Math.random().toString(36).slice(2),
        member: member,
        phone: member.phone,
        verified_at: Date.now(),
        expires_at: Date.now() + (12 * 60 * 60 * 1000)  // 12 hours
      };
      localStorage.setItem(CONFIG.sessionKey, JSON.stringify(session));
      return true;
    },

    /**
     * Get current session (auto-cleans if expired)
     */
    getSession() {
      try {
        const raw = localStorage.getItem(CONFIG.sessionKey);
        if (!raw) return null;
        const session = JSON.parse(raw);
        if (session.expires_at && Date.now() > session.expires_at) {
          localStorage.removeItem(CONFIG.sessionKey);
          return null;
        }
        return session;
      } catch { return null; }
    },

    /**
     * Logout / clear session
     */
    logout() {
      localStorage.removeItem(CONFIG.sessionKey);
      sessionStorage.removeItem(CONFIG.sessionKey + '_pending');
      // Also clear legacy session keys
      localStorage.removeItem('crm_user');
      localStorage.removeItem('prajapati_admin');
    },

    /**
     * Get home page URL for a given role
     */
    getHomeForRole(role) {
      const r = String(role || '').toLowerCase();
      const routes = {
        'owner': '/owner.html',
        'admin': '/owner.html',
        'sales': '/crm.html',
        'hr_sales': '/crm.html',
        'sales_admin': '/crm.html',
        'operations_manager': '/owner.html',
        'operations': '/execution-entry.html',
        'execution': '/execution-entry.html',
        'field': '/field.html',
        'field_worker': '/field.html',
        'printing': '/printing.html',
        'stitching': '/stitching.html',
        'delivery': '/delivery.html',
        'verifier': '/verifier.html',
        'data_entry': '/admin.html',
        'deo': '/admin.html'
      };
      return routes[r] || '/owner.html';
    },

    /**
     * Send any Wati template (for automations)
     */
    async sendTemplate(options) {
      const validPhone = validatePhone(options.to_phone);
      if (!validPhone) return { success: false, error: 'Invalid recipient phone' };
      
      const session = this.getSession();
      return await apiCall(CONFIG.sendUrl, {
        action: 'send_template',
        to_phone: validPhone,
        to_name: options.to_name,
        template_name: options.template_name,
        params: options.params || [],
        context_type: options.context_type,
        context_id: options.context_id,
        triggered_by: session?.phone
      });
    },

    // ─── Quick automation helpers ─────────────────────────────────────
    
    async sendLeadWelcome(phone, leadName) {
      return this.sendTemplate({
        to_phone: phone, to_name: leadName,
        template_name: 'lead_welcome', params: [leadName],
        context_type: 'lead'
      });
    },

    async sendQuoteToClient(opts) {
      return this.sendTemplate({
        to_phone: opts.client_phone, to_name: opts.client_name,
        template_name: 'quote_sent',
        params: [opts.client_name, opts.quote_number, opts.amount, opts.valid_till, opts.url],
        context_type: 'quote', context_id: opts.quote_id
      });
    },

    async sendInvoice(opts) {
      return this.sendTemplate({
        to_phone: opts.client_phone, to_name: opts.client_name,
        template_name: 'invoice_sent',
        params: [opts.client_name, opts.invoice_number, opts.amount, opts.gst, opts.url],
        context_type: 'invoice', context_id: opts.invoice_id
      });
    },

    async sendPaymentReminder(opts) {
      return this.sendTemplate({
        to_phone: opts.client_phone, to_name: opts.client_name,
        template_name: 'payment_reminder',
        params: [opts.client_name, opts.invoice_number, opts.amount, String(opts.days_overdue)],
        context_type: 'payment_reminder', context_id: opts.invoice_id
      });
    },

    async sendCampaignComplete(opts) {
      return this.sendTemplate({
        to_phone: opts.client_phone, to_name: opts.client_name,
        template_name: 'campaign_complete',
        params: [opts.client_name, opts.campaign_name, String(opts.vehicle_count), String(opts.city_count), opts.report_url],
        context_type: 'campaign_done', context_id: opts.campaign_id
      });
    },

    async sendPhotosVerified(opts) {
      return this.sendTemplate({
        to_phone: opts.client_phone, to_name: opts.client_name,
        template_name: 'photos_verified',
        params: [opts.client_name, String(opts.photo_count), opts.campaign_name, opts.portal_url],
        context_type: 'photos_batch', context_id: opts.campaign_id
      });
    },

    validatePhone
  };

  window.WatiClient = WatiClient;
  console.log('%c🔐 WatiClient v1.0 loaded', 'background:#0B1957;color:#D4B45F;padding:4px 10px;border-radius:4px;font-weight:bold;');

})(window);
