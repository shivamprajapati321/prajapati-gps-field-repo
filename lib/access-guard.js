// ═══════════════════════════════════════════════════════════════════════
// /lib/access-guard.js — v3.2 (Universal Sidebar Filtering)
// 
// NEW IN v3.2:
//   • AccessGuard.filterUI() — Auto-hides menu items user can't access
//   • Universal solution: works on ALL pages without code changes
//   • Hides sidebar links + admin-only buttons
//   • Auto-runs after protect() succeeds
//   • Respects user.module_access overrides + role defaults
//
// NEW IN v3.0:
//   • AccessGuard.getDataFilter() — Returns Supabase filter string
//   • Owner/Admin → no filter (see all)
//   • Sales → filter by sales_owner_id = currentUser.id
//   • Per-page data isolation
// 
// Usage:
//   AccessGuard.protect({ module: 'printing' })  // Auto-filters UI
//   AccessGuard.filterUI()                        // Manual re-filter
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
    'sales': ['crm', 'leads', 'quotations', 'pi', 'invoices', 'clients', 'dashboard', 'design-tasks'],
    'hr_sales': ['crm', 'leads', 'quotations', 'pi', 'invoices', 'clients', 'dashboard'],
    'sales_admin': ['crm', 'leads', 'quotations', 'pi', 'invoices', 'clients', 'dashboard', 'report-team', 'report-campaign'],
    'operations_manager': ['admin-v2', 'master-cache', 'launch-campaign', 'execution-plan', 'execution-entry', 'rates-master', 'dashboard', 'printing', 'stitching', 'delivery', 'payments', 'outstanding', 'report-daily', 'report-team', 'report-campaign', 'ppt'],
    'operations': ['execution-entry', 'launch-campaign', 'dashboard'],
    'designer': ['admin-v2', 'designer-uploads', 'design-tasks', 'campaign-status', 'launch-campaign', 'dashboard'],
    'design': ['admin-v2', 'designer-uploads', 'design-tasks', 'campaign-status', 'launch-campaign', 'dashboard'],
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

  // Roles that get FULL DATA ACCESS (no filter)
  const FULL_ACCESS_ROLES = ['owner', 'admin'];

  // Roles that get FILTERED DATA (own records only)
  const FILTERED_ROLES = ['sales', 'hr_sales', 'sales_admin'];

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
    overlay.style.cssText = 'position:fixed;inset:0;background:#0B1957;z-index:999999;display:flex;align-items:center;justify-content:center;font-family:"Plus Jakarta Sans",system-ui,sans-serif;color:#fff;padding:24px;';
    
    const countdownHtml = autoRedirect 
      ? '<p style="font-size:13px;color:#a3a3a3;font-family:\'JetBrains Mono\',monospace;margin-top:18px;">Redirecting in <span id="ag-countdown">3</span>s...</p>' 
      : '';
    
    overlay.innerHTML = '<div style="text-align:center;max-width:480px;"><div style="width:88px;height:88px;background:#D4B45F;color:#0B1957;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:40px;margin:0 auto 24px;box-shadow:0 12px 40px rgba(212,180,95,0.4);">🔒</div><h1 style="font-size:30px;font-weight:700;margin-bottom:14px;letter-spacing:-0.025em;">Access Restricted</h1><p style="font-size:15px;line-height:1.65;color:rgba(255,255,255,0.75);margin-bottom:6px;max-width:400px;margin-left:auto;margin-right:auto;">' + reason + '</p>' + countdownHtml + '<button onclick="location.href=\'' + redirectTo + '\'" style="margin-top:24px;padding:14px 32px;background:#D4B45F;color:#0B1957;border:none;border-radius:6px;font-family:\'Plus Jakarta Sans\',sans-serif;font-size:14px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;cursor:pointer;">Go to Login →</button></div>';
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
    
    // ═════════════════════════════════════════════════════════
    // CORE: Page protection (unchanged from v2)
    // ═════════════════════════════════════════════════════════
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
        showBlockedScreen('This page requires WhatsApp OTP verification.', opts.redirectTo, true);
        return false;
      }

      // ═══ v3.3: module_access is the source of truth (consistent with Hub) ═══
      // If a module id is declared, an explicit grant/deny in module_access
      // OVERRIDES role-based allowedRoles. This keeps Hub visibility and
      // page-level guards in sync: what the owner grants in the Team modal works everywhere.
      const role = String(member.role || '').toLowerCase();
      const ma = (member.module_access && typeof member.module_access === 'string')
        ? (function(){ try { return JSON.parse(member.module_access); } catch(e){ return {}; } })()
        : (member.module_access || {});
      const moduleId = opts.module || '';
      const explicit = moduleId ? ma[moduleId] : undefined;

      if (role === 'owner') {
        // owner always allowed (unless explicitly denied a module)
        if (explicit === false) {
          const lbl = moduleId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          showBlockedScreen('No access to "' + lbl + '". Contact owner.', opts.redirectTo, true);
          return false;
        }
      } else if (explicit === true) {
        // explicit grant via module_access → bypass role restriction entirely
      } else if (explicit === false) {
        // explicit deny via module_access → block even if role would allow
        const lbl = moduleId.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        showBlockedScreen('No access to "' + lbl + '". Contact owner.', opts.redirectTo, true);
        return false;
      } else {
        // no explicit module_access entry → fall back to role-based check.
        // If allowedRoles is declared, that is the authority (role match = allow).
        // We do NOT additionally gate on ROLE_DEFAULTS here, else role-allowed
        // users get double-blocked when the module isn't in their role default set.
        if (opts.allowedRoles && opts.allowedRoles.length) {
          if (!hasRoleAccess(member, opts.allowedRoles)) {
            showBlockedScreen('Your role (' + member.role + ') cannot access this page.', opts.redirectTo, true);
            return false;
          }
        } else if (opts.module && !hasModuleAccess(member, opts.module)) {
          // No allowedRoles given → module is the gate (legacy module-only pages)
          const moduleLabel = opts.module.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          showBlockedScreen('No access to "' + moduleLabel + '". Contact owner.', opts.redirectTo, true);
          return false;
        }
      }

      console.log('%c✓ Access granted', 'background:#047857;color:#fff;padding:3px 8px;border-radius:3px;', 
        member.name + ' (' + member.role + ') → ' + (opts.module || 'page'));
      
      window.currentUser = member;
      window.currentSession = session;
      
      // v3.2: Auto-filter sidebar/UI based on user's module access
      // Runs after DOM ready (in case script loads before body)
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.filterUI());
      } else {
        // DOM already ready — defer to next tick for any inline scripts
        setTimeout(() => this.filterUI(), 0);
      }
      
      return true;
    },

    // ═════════════════════════════════════════════════════════
    // NEW v3.0: Data Filter for RLS
    // ═════════════════════════════════════════════════════════
    
    /**
     * Returns Supabase URL filter string for current user
     * 
     * For owner/admin: returns '' (no filter, sees all)
     * For sales:       returns 'sales_owner_id=eq.{userId}' (own only)
     * For others:      returns 'sales_owner_id=eq.{userId}' (default safe)
     * 
     * Usage:
     *   const filter = AccessGuard.getDataFilter();
     *   fetch(`/rest/v1/trial_leads?${filter}&select=*`)
     */
    getDataFilter(options) {
      options = options || {};
      const ownerColumn = options.column || 'sales_owner_id';
      
      const member = this.getUser();
      if (!member) return ''; // No session - no filter (will redirect anyway)
      
      const role = String(member.role || '').toLowerCase();
      
      // Full access roles: no filter
      if (FULL_ACCESS_ROLES.includes(role)) {
        // Check if owner has manually selected a "view as" user
        const viewAs = sessionStorage.getItem('prajapati_view_as');
        if (viewAs) {
          return ownerColumn + '=eq.' + viewAs;
        }
        return ''; // No filter = see all
      }
      
      // Filtered roles: own data only
      if (FILTERED_ROLES.includes(role)) {
        if (!member.id) {
          console.error('[AccessGuard] User has no ID - cannot filter');
          return ownerColumn + '=eq.00000000-0000-0000-0000-000000000000'; // Match nothing
        }
        return ownerColumn + '=eq.' + member.id;
      }
      
      // Default: filter by ID (safe default)
      return ownerColumn + '=eq.' + (member.id || '00000000-0000-0000-0000-000000000000');
    },

    /**
     * Get filter as object (for query builders)
     */
    getDataFilterObject(options) {
      options = options || {};
      const ownerColumn = options.column || 'sales_owner_id';
      
      const member = this.getUser();
      if (!member) return {};
      
      const role = String(member.role || '').toLowerCase();
      
      if (FULL_ACCESS_ROLES.includes(role)) {
        const viewAs = sessionStorage.getItem('prajapati_view_as');
        if (viewAs) return { [ownerColumn]: viewAs };
        return {}; // No filter
      }
      
      if (FILTERED_ROLES.includes(role)) {
        return { [ownerColumn]: member.id };
      }
      
      return { [ownerColumn]: member.id || '00000000-0000-0000-0000-000000000000' };
    },

    /**
     * Should current user see all data? (admin/owner)
     */
    canSeeAllData() {
      const member = this.getUser();
      if (!member) return false;
      const role = String(member.role || '').toLowerCase();
      return FULL_ACCESS_ROLES.includes(role);
    },

    /**
     * Auto-tag new records with current user as owner
     * Returns object to spread into INSERT payload
     * 
     * Usage:
     *   const newLead = {
     *     name: 'ABC Corp',
     *     phone: '...',
     *     ...AccessGuard.getOwnerTag()  // adds sales_owner_id
     *   };
     */
    getOwnerTag(options) {
      options = options || {};
      const ownerColumn = options.column || 'sales_owner_id';
      
      const member = this.getUser();
      if (!member || !member.id) return {};
      
      const role = String(member.role || '').toLowerCase();
      
      // For sales: tag with self
      if (FILTERED_ROLES.includes(role)) {
        return { 
          [ownerColumn]: member.id,
          'assigned_to': member.id 
        };
      }
      
      // For owner: tag with self (can be reassigned later)
      return { 
        [ownerColumn]: member.id,
        'assigned_to': member.id 
      };
    },

    /**
     * Owner sets "View as" filter to see specific sales person's data
     */
    setViewAsUser(userId) {
      if (!this.canSeeAllData()) {
        console.warn('[AccessGuard] Only owner/admin can set view-as');
        return false;
      }
      if (userId) {
        sessionStorage.setItem('prajapati_view_as', userId);
      } else {
        sessionStorage.removeItem('prajapati_view_as');
      }
      return true;
    },

    /**
     * Get current "view as" setting
     */
    getViewAsUser() {
      return sessionStorage.getItem('prajapati_view_as');
    },

    /**
     * Clear view-as
     */
    clearViewAs() {
      sessionStorage.removeItem('prajapati_view_as');
    },

    // ═════════════════════════════════════════════════════════
    // Standard API (from v2)
    // ═════════════════════════════════════════════════════════
    
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

      // Admin-dashboard roles all land on the unified admin wrapper (app.html#v2).
      // Their visible tabs are then filtered by module_access inside admin-v2.
      if (role === 'owner' || role === 'admin') return '/app.html#v2';
      if (role === 'operations_manager' || role === 'ops_manager') return '/app.html#v2';
      if (role === 'data_manager' || role === 'data_entry' || role === 'deo') return '/app.html#v2';

      // Sales → CRM
      if (role === 'sales' || role === 'hr_sales' || role === 'sales_admin') return '/crm.html';

      // Designer → admin-v2 (sees Designer Uploads tab there)
      if (role === 'designer' || role === 'design') return '/app.html#v2';

      // Single-purpose operator roles → their own tool
      if (role === 'operations' || role === 'execution') return '/execution-entry.html';
      if (role === 'field' || role === 'field_worker') return '/field.html';
      if (role === 'printing') return '/printing-v2.html';
      if (role === 'stitching') return '/stitching-v2.html';
      if (role === 'delivery') return '/delivery.html';
      if (role === 'verifier') return '/verifier.html';
      if (role === 'accountant') return '/payments.html';

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
      const viewAs = this.getViewAsUser();
      const viewAsBadge = viewAs ? '<span style="background:#D4B45F;color:#0B1957;padding:2px 8px;border-radius:999px;font-size:9px;font-weight:700;margin-left:6px;">VIEWING AS USER</span>' : '';
      
      el.innerHTML = '<div style="display:flex;align-items:center;gap:12px;font-family:\'Plus Jakarta Sans\',sans-serif;"><div style="display:flex;align-items:center;gap:10px;padding:4px 14px 4px 4px;background:#FAF8F3;border:1px solid #B89B4E;border-radius:999px;"><div style="width:30px;height:30px;border-radius:50%;background:#0B1957;color:#D4B45F;display:flex;align-items:center;justify-content:center;font-family:\'Fraunces\',serif;font-style:italic;font-weight:600;font-size:13px;border:1.5px solid #B89B4E;">' + initial + '</div><div><div style="font-size:13px;font-weight:700;color:#0B1957;line-height:1.1;">' + (user.name || 'User') + viewAsBadge + '</div><div style="font-family:\'JetBrains Mono\',monospace;font-size:8.5px;color:#8B7430;letter-spacing:0.14em;text-transform:uppercase;margin-top:2px;">' + roleDisplay + '</div></div></div><button onclick="AccessGuard.logout()" style="padding:8px 14px;border:1px solid #E5E0D2;background:#fff;color:#475569;font-size:11.5px;font-weight:500;border-radius:999px;cursor:pointer;">Sign out</button></div>';
    },

    // ═════════════════════════════════════════════════════════
    // v3.2: Universal Sidebar/UI Filtering
    // ═════════════════════════════════════════════════════════
    
    /**
     * Hide menu items and admin-only buttons based on user's access.
     * Auto-called by protect() — also exposed for manual re-runs.
     * 
     * For LEGACY pages with custom auth (printing.html, stitching.html, etc.):
     *   Call AccessGuard.filterUI(yourUserObject) explicitly after login.
     * 
     * Owner/admin: nothing hidden (sees all)
     * Other roles: only modules in ROLE_DEFAULTS + explicit module_access
     * 
     * Hides:
     *   • Sidebar links (<a href> matching MODULE_PAGES)
     *   • Elements with class="admin-only" or data-admin-only
     *   • Elements with data-requires-module="<module>"
     */
    filterUI(overrideUser) {
      const member = overrideUser || this.getUser();
      if (!member) return;
      
      const role = String(member.role || '').toLowerCase();
      const isAdmin = role === 'owner' || role === 'admin';
      
      // Build reverse map: URL → module name
      const urlToModule = {};
      Object.keys(MODULE_PAGES).forEach(mod => {
        const url = MODULE_PAGES[mod].replace(/^\//, '');  // 'printing.html'
        urlToModule[url] = mod;
        urlToModule['/' + url] = mod;
      });
      
      let hiddenCount = 0;
      
      // 1. Filter sidebar/nav links
      const allLinks = document.querySelectorAll('a[href]');
      allLinks.forEach(link => {
        const href = link.getAttribute('href') || '';
        if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('http')) return;
        
        // Extract filename (strip query/hash)
        const filename = href.replace(/^\//, '').split('?')[0].split('#')[0];
        const module = urlToModule[filename] || urlToModule['/' + filename];
        
        if (!module) return; // Unknown page → leave alone (e.g., external links)
        
        // Owner/admin sees all
        if (isAdmin && !(member.module_access && member.module_access[module] === false)) {
          return;
        }
        
        // Check access for this module
        if (!hasModuleAccess(member, module)) {
          // Hide the link
          link.style.display = 'none';
          link.setAttribute('data-ag-hidden', 'true');
          
          // Also hide common parent containers (li, nav-item, sidebar-item)
          const parent = link.closest('li, .nav-item, .sidebar-item, .menu-item');
          if (parent && !parent.querySelector('a[href]:not([data-ag-hidden])')) {
            // Only hide parent if NO other visible links inside
            parent.style.display = 'none';
          }
          
          hiddenCount++;
        }
      });
      
      // 2. Filter admin-only elements
      if (!isAdmin) {
        const adminOnly = document.querySelectorAll('.admin-only, [data-admin-only], [data-owner-only]');
        adminOnly.forEach(el => {
          el.style.display = 'none';
          hiddenCount++;
        });
      }
      
      // 3. Filter elements with explicit module requirement
      const moduleGated = document.querySelectorAll('[data-requires-module]');
      moduleGated.forEach(el => {
        const requiredMod = el.getAttribute('data-requires-module');
        if (requiredMod && !hasModuleAccess(member, requiredMod)) {
          el.style.display = 'none';
          hiddenCount++;
        }
      });
      
      // 4. Hide empty section headers (no visible children)
      const sectionHeaders = document.querySelectorAll('.sidebar-section, [data-section-header]');
      sectionHeaders.forEach(header => {
        const next = header.nextElementSibling;
        let hasVisibleChild = false;
        let cursor = next;
        while (cursor && !cursor.matches('.sidebar-section, [data-section-header]')) {
          if (cursor.style.display !== 'none' && cursor.offsetParent !== null) {
            hasVisibleChild = true;
            break;
          }
          cursor = cursor.nextElementSibling;
        }
        if (!hasVisibleChild) {
          header.style.display = 'none';
        }
      });
      
      if (hiddenCount > 0) {
        console.log('%c🔒 UI filtered', 'background:#8B7430;color:#fff;padding:2px 7px;border-radius:3px;', 
          hiddenCount + ' item(s) hidden for ' + member.name + ' (' + role + ')');
      }
    },

    ROLE_DEFAULTS,
    MODULE_PAGES,
    FULL_ACCESS_ROLES,
    FILTERED_ROLES
  };

  window.AccessGuard = AccessGuard;
  console.log('%c🛡️ AccessGuard v3.3 loaded (RLS + UI Filter + Legacy Support)', 'background:#0B1957;color:#D4B45F;padding:4px 10px;border-radius:4px;font-weight:bold;');

})(window);
