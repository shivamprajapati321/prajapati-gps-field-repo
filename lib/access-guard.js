// ═══════════════════════════════════════════════════════════════════════
// /lib/access-guard.js — v2.0 (Owner-Driven RBAC)
// 
// Reads module_access EXACTLY as stored by owner.html:
//   module_access = { 'leads': true, 'payments': false, ... }
//   - true   = explicitly granted (override role default)
//   - false  = explicitly denied (override role default)
//   - missing = use role default
// ═══════════════════════════════════════════════════════════════════════

(function(window) {
  'use strict';

  const CONFIG = {
    sessionKey: 'prajapati_session',
    loginUrl: '/login.html',
    legacyKeys: ['crm_user', 'prajapati_admin']
  };

  const ROLE_DEFAULTS = {
    'owner': '*',
    'admin': '*',
    'sales': ['crm', 'leads', 'quotations', 'pi', 'invoices', 'clients', 'dashboard'],
    'hr_sales': ['crm', 'leads', 'quotations', 'pi', 'invoices', 'clients', 'dashboard'],
    'sales_admin': ['crm', 'leads', 'quotations', 'pi', 'invoices', 'clients', 'dashboard', 'report-team', 'report-campaign'],
    'operations_manager': ['admin-v2', 'master-cache', 'launch-campaign', 'execution-plan', 'execution-entry', 'rates-master', 'dashboard', 'printing', 'stitching', 'delivery', 'payments', 'outstanding', 'report-daily', 'report-team', 'report-campaign', 'ppt'],
    'operations': ['execution-entry', 'launch-campaign', 'dashboard'],
    'execution': ['execution-entry', 'execution-plan'],
    'field': ['field'],
    'field_worker': ['field'],
    'printing': ['printing'],
    'stitching': ['stitching'],
    'delivery': ['delivery'],
    'verifier': ['verifier'],
    'data_entry': ['admin-v2'],
    'deo': ['admin-v2']
  };

  const MODULE_PAGES = {
    'owner': '/owner.html', 'admin-v2': '/admin-v2.html', 'verifier': '/verifier.html',
    'master-cache': '/master-cache.html', 'ppt': '/ppt.html',
    'launch-campaign': '/launch-campaign.html', 'execution-plan': '/execution-plan.html',
    'execution-entry': '/execution-entry.html', 'rates-master': '/rates-master.html',
    'dashboard': '/dashboard.html', 'printing': '/printing.html',
    'stitching': '/stitching.html', 'delivery': '/delivery.html',
    'payments': '/payments.html', 'outstanding': '/outstanding.html',
    'report-daily': '/report-daily.html', 'report-team': '/report-team.html',
    'report-campaign': '/report-campaign.html', 'crm': '/crm.html',
    'leads': '/leads.html', 'quotations': '/quotations.html',
    'pi': '/pi.html', 'invoices': '/invoices.html',
    'clients': '/clients.html', 'field': '/field.html'
  };

  function getSession() {
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
  }

  function hasModuleAccess(member, moduleName) {
    if (!member || !moduleName) return false;
    const role = String(member.role || '').toLowerCase();
    
    if (role === 'owner' || role === 'admin') {
      if (member.module_access && member.module_access[moduleName] === false) return false;
      return true;
    }
    
    const ma = member.module_access || {};
    const explicit = ma[moduleName];
    
    if (explicit === true) return true;
    if (explicit === false) return false;
    
    const allowed = ROLE_DEFAULTS[role];
    if (!allowed) return false;
    if (allowed === '*') return true;
    return allowed.includes(moduleName);
  }

  function hasRoleAccess(member, allowedRoles) {
    if (!member) return false;
    if (!allowedRoles || allowedRoles.length === 0) return true;
    const role = String(member.role || '').toLowerCase();
    if (role === 'owner') return true;
    return allowedRoles.includes(role);
  }

  function showBlockedScreen(reason, redirectTo, autoRedirect) {
    const overlay = document.createElement('div');
    overlay.id = 'ag-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;background:#0B1957;z-index:999999;display:flex;align-items:center;justify-content:center;font-family:"Plus Jakarta Sans",system-ui,sans-serif;color:#fff;padding:24px;animation:fadeIn 0.3s ease;';
    
    const countdownHtml = autoRedirect 
      ? '<p style="font-size:13px;color:#a3a3a3;font-family:\'JetBrains Mono\',monospace;margin-top:18px;">Redirecting in <span id="ag-countdown">3</span>s...</p>' 
      : '';
    
    overlay.innerHTML = '<style>@keyframes fadeIn{from{opacity:0}to{opacity:1}}</style><div style="text-align:center;max-width:480px;"><div style="width:88px;height:88px;background:#D4B45F;color:#0B1957;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:40px;margin:0 auto 24px;box-shadow:0 12px 40px rgba(212,180,95,0.4);">🔒</div><h1 style="font-size:30px;font-weight:700;margin-bottom:14px;letter-spacing:-0.025em;">Access Restricted</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin-bottom:6px;max-width:400px;margin-left:auto;margin-right:auto;">' + reason + '</p>' + countdownHtml + '<button onclick="location.href=\'' + redirectTo + '\'" style="margin-top:24px;padding:14px 32px;background:#D4B45F;color:#0B1957;border:none;border-radius:6px;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:14px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;cursor:pointer;box-shadow:0 8px 24px rgba(212,180,95,0.3);">Go to Login →</button></div>';
    document.body.appendChild(overlay);
    
    if (autoRedirect) {
      let seconds = 3;
      const countEl = document.getElementById('ag-countdown');
      const timer = setInterval(() => {
        seconds--;
        if (countEl) countEl.textContent = seconds;
        if (seconds <= 0) {
          clearInterval(timer);
          window.location.href = redirectTo;
        }
      }, 1000);
    }
  }

  const AccessGuard = {
    protect(options) {
      options = options || {};
      const opts = {
        module: options.module || '',
        allowedRoles: options.allowedRoles || null,
        requiresOTP: options.requiresOTP === true,
        redirectTo: options.redirectTo || CONFIG.loginUrl,
        silent: options.silent === true
      };

      const session = getSession();

      if (!session || !session.member) {
        console.warn('[AccessGuard] No session');
        if (opts.silent) {
          window.location.href = opts.redirectTo;
        } else {
          showBlockedScreen('Please sign in to continue.', opts.redirectTo, true);
        }
        return false;
      }

      const member = session.member;

      if (member.active === false) {
        showBlockedScreen('Your account is inactive. Please contact admin.', opts.redirectTo, true);
        return false;
      }

      if (opts.requiresOTP && session.token && session.token.startsWith('pwd_')) {
        showBlockedScreen('This page requires WhatsApp OTP verification. Please login with OTP.', opts.redirectTo, true);
        return false;
      }

      if (opts.allowedRoles && !hasRoleAccess(member, opts.allowedRoles)) {
        showBlockedScreen('Your role (' + member.role + ') cannot access this page. Contact admin to upgrade access.', opts.redirectTo, true);
        return false;
      }

      if (opts.module && !hasModuleAccess(member, opts.module)) {
        const moduleLabel = opts.module.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        showBlockedScreen('You don\'t have access to "' + moduleLabel + '". Contact your owner to grant module access.', opts.redirectTo, true);
        return false;
      }

      console.log('%c✓ Access granted', 'background:#047857;color:#fff;padding:3px 8px;border-radius:3px;', member.name + ' (' + member.role + ') → ' + (opts.module || 'page'));
      
      window.currentUser = member;
      window.currentSession = session;
      
      return true;
    },

    getUser() {
      const session = getSession();
      return session ? session.member : null;
    },

    getSession() { return getSession(); },

    canAccess(moduleName) {
      const session = getSession();
      if (!session) return false;
      return hasModuleAccess(session.member, moduleName);
    },

    getAccessibleModules() {
      const session = getSession();
      if (!session || !session.member) return [];
      const member = session.member;
      const allModules = Object.keys(MODULE_PAGES);
      return allModules.filter(mod => hasModuleAccess(member, mod));
    },

    getDefaultHome() {
      const member = this.getUser();
      if (!member) return CONFIG.loginUrl;
      const role = String(member.role || '').toLowerCase();
      
      if (role === 'owner' || role === 'admin') return '/owner.html';
      if (role === 'sales' || role === 'hr_sales' || role === 'sales_admin') return '/crm.html';
      if (role === 'operations_manager') return '/owner.html';
      if (role === 'operations' || role === 'execution') return '/execution-entry.html';
      if (role === 'field' || role === 'field_worker') return '/field.html';
      if (role === 'printing') return '/printing.html';
      if (role === 'stitching') return '/stitching.html';
      if (role === 'delivery') return '/delivery.html';
      if (role === 'verifier') return '/verifier.html';
      if (role === 'data_entry' || role === 'deo') return '/admin-v2.html';
      
      const accessible = this.getAccessibleModules();
      return accessible.length > 0 ? MODULE_PAGES[accessible[0]] : CONFIG.loginUrl;
    },

    logout(redirectTo) {
      localStorage.removeItem(CONFIG.sessionKey);
      CONFIG.legacyKeys.forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
      window.location.href = redirectTo || CONFIG.loginUrl;
    },

    renderUserBar(containerId) {
      const el = document.getElementById(containerId);
      if (!el) return;
      const user = this.getUser();
      if (!user) return;
      
      const initial = (user.name || '?').charAt(0).toUpperCase();
      const roleDisplay = String(user.role || 'user').replace(/_/g, ' ').toUpperCase();
      
      el.innerHTML = '<div style="display:flex;align-items:center;gap:12px;font-family:\'Plus Jakarta Sans\',sans-serif;"><div style="display:flex;align-items:center;gap:10px;padding:4px 14px 4px 4px;background:#FAF8F3;border:1px solid #B89B4E;border-radius:999px;"><div style="width:30px;height:30px;border-radius:50%;background:#0B1957;color:#D4B45F;display:flex;align-items:center;justify-content:center;font-family:\'Fraunces\',serif;font-style:italic;font-weight:600;font-size:13px;border:1.5px solid #B89B4E;">' + initial + '</div><div><div style="font-size:13px;font-weight:700;color:#0B1957;line-height:1.1;">' + (user.name || 'User') + '</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:8.5px;color:#8B7430;letter-spacing:0.14em;text-transform:uppercase;margin-top:2px;">' + roleDisplay + '</div></div></div><button onclick="AccessGuard.logout()" style="padding:8px 14px;border:1px solid #E5E0D2;background:#fff;color:#475569;font-size:11.5px;font-weight:500;border-radius:999px;cursor:pointer;">Sign out</button></div>';
    },

    ROLE_DEFAULTS,
    MODULE_PAGES
  };

  window.AccessGuard = AccessGuard;
  console.log('%c🛡️ AccessGuard v2.0 loaded', 'background:#0B1957;color:#D4B45F;padding:4px 10px;border-radius:4px;font-weight:bold;');

})(window);
