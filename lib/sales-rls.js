// ═══════════════════════════════════════════════════════════════════════
// /lib/sales-rls.js — Universal Sales Multi-Tenancy Patch
// 
// Auto-injects RLS filtering into Supabase queries on sales pages.
// 
// USAGE in each sales page (add 2 lines after supabase init):
// 
//   <script src="/lib/wati-client.js"></script>
//   <script src="/lib/access-guard.js"></script>
//   <script src="/lib/sales-rls.js"></script>  ← ADD THIS
//   
//   <script>
//     AccessGuard.protect({ module: 'leads' });  ← ADD THIS
//     // ... existing code unchanged
//   </script>
// 
// After loading, this script:
//   1. Wraps window.supabase.createClient() to auto-filter queries
//   2. Auto-injects sales_owner_id filter for sales role
//   3. Auto-tags INSERT with current user
//   4. Owner sees all (no filter)
//   5. "View as User" support for owner
// 
// ═══════════════════════════════════════════════════════════════════════

(function(window) {
  'use strict';

  // Tables that need filtering
  const FILTERED_TABLES = [
    'sales_leads',
    'sales_quotations',
    'sales_quotation_items',
    'sales_pi',
    'sales_pi_items',
    'sales_invoices',
    'sales_invoice_items',
    'sales_clients',
    'sales_communications',
    'sales_activities',
    'trial_leads',
    'trial_campaigns',
    'trial_quotations',
    'trial_pi',
    'trial_invoices',
    'trial_clients'
  ];

  // Owner column name varies by table
  const OWNER_COLUMNS = {
    'sales_leads': 'sales_owner_id',
    'sales_quotations': 'sales_owner_id',
    'sales_pi': 'sales_owner_id',
    'sales_invoices': 'sales_owner_id',
    'sales_clients': 'sales_owner_id',
    'sales_communications': 'sales_owner_id',
    'sales_activities': 'sales_owner_id',
    'trial_leads': 'sales_owner_id',
    'trial_campaigns': 'sales_owner_id',
    'trial_quotations': 'sales_owner_id',
    'trial_pi': 'sales_owner_id',
    'trial_invoices': 'sales_owner_id',
    'trial_clients': 'sales_owner_id'
  };

  // Roles that get full access (no filter)
  const FULL_ACCESS_ROLES = ['owner', 'admin'];

  function getCurrentUser() {
    try {
      if (window.AccessGuard && window.AccessGuard.getUser) {
        return window.AccessGuard.getUser();
      }
      const raw = localStorage.getItem('prajapati_session');
      if (raw) {
        const session = JSON.parse(raw);
        return session.member;
      }
    } catch(e) { console.warn('[SalesRLS] getCurrentUser error:', e); }
    return null;
  }

  function shouldFilter(tableName) {
    if (!tableName) return false;
    // Exact match or include in our list
    return FILTERED_TABLES.includes(tableName);
  }

  function getOwnerFilter(tableName) {
    const user = getCurrentUser();
    if (!user) return null;
    
    const role = String(user.role || '').toLowerCase();
    
    // Full access: no filter
    if (FULL_ACCESS_ROLES.includes(role)) {
      // Check view-as override
      const viewAs = sessionStorage.getItem('prajapati_view_as');
      if (viewAs) {
        return { column: OWNER_COLUMNS[tableName] || 'sales_owner_id', value: viewAs };
      }
      return null; // No filter
    }
    
    // Sales roles: filter by own ID
    return { 
      column: OWNER_COLUMNS[tableName] || 'sales_owner_id', 
      value: user.id 
    };
  }

  /**
   * Patch a Supabase client to auto-filter sales tables
   */
  function patchSupabaseClient(client) {
    if (!client || client.__sales_rls_patched) return client;
    
    const originalFrom = client.from.bind(client);
    
    client.from = function(tableName) {
      const queryBuilder = originalFrom(tableName);
      
      // Only patch sales tables
      if (!shouldFilter(tableName)) {
        return queryBuilder;
      }
      
      const filter = getOwnerFilter(tableName);
      if (!filter) {
        // Owner/admin - no filter
        console.log('%c[SalesRLS] No filter for owner', 'color:#047857', tableName);
        return queryBuilder;
      }
      
      // Wrap select to auto-add filter
      const originalSelect = queryBuilder.select.bind(queryBuilder);
      queryBuilder.select = function(...args) {
        const builder = originalSelect.apply(queryBuilder, args);
        // Auto-add eq filter for owner column
        if (builder && builder.eq) {
          const filtered = builder.eq(filter.column, filter.value);
          console.log('%c[SalesRLS] Filtered query', 'color:#0B1957', 
            tableName, `WHERE ${filter.column}=${filter.value}`);
          return filtered;
        }
        return builder;
      };
      
      // Wrap insert to auto-tag with owner
      const originalInsert = queryBuilder.insert.bind(queryBuilder);
      queryBuilder.insert = function(values, options) {
        const user = getCurrentUser();
        if (user && user.id) {
          if (Array.isArray(values)) {
            values = values.map(v => ({
              ...v,
              [filter.column]: v[filter.column] || user.id,
              assigned_to: v.assigned_to || user.id,
              created_by: v.created_by || user.id
            }));
          } else if (values && typeof values === 'object') {
            values = {
              ...values,
              [filter.column]: values[filter.column] || user.id,
              assigned_to: values.assigned_to || user.id,
              created_by: values.created_by || user.id
            };
          }
          console.log('%c[SalesRLS] Auto-tagged insert', 'color:#B89B4E', 
            tableName, 'owner:', user.id);
        }
        return originalInsert(values, options);
      };
      
      // Wrap update to ensure filtering (sales can only update own)
      const originalUpdate = queryBuilder.update.bind(queryBuilder);
      queryBuilder.update = function(values, options) {
        const builder = originalUpdate(values, options);
        if (builder && builder.eq) {
          const filtered = builder.eq(filter.column, filter.value);
          console.log('%c[SalesRLS] Filtered update', 'color:#C2410C', 
            tableName, `WHERE ${filter.column}=${filter.value}`);
          return filtered;
        }
        return builder;
      };
      
      // Wrap delete to ensure filtering (sales can only delete own)
      const originalDelete = queryBuilder.delete.bind(queryBuilder);
      queryBuilder.delete = function(options) {
        const builder = originalDelete(options);
        if (builder && builder.eq) {
          const filtered = builder.eq(filter.column, filter.value);
          console.log('%c[SalesRLS] Filtered delete', 'color:#BE123C', 
            tableName, `WHERE ${filter.column}=${filter.value}`);
          return filtered;
        }
        return builder;
      };
      
      return queryBuilder;
    };
    
    client.__sales_rls_patched = true;
    console.log('%c🛡️ Sales RLS patched onto Supabase client', 
      'background:#0B1957;color:#D4B45F;padding:4px 10px;border-radius:4px;font-weight:bold;');
    
    return client;
  }

  /**
   * Auto-patch when Supabase loads
   */
  function autoPatch() {
    if (window.supabase && window.supabase.createClient) {
      const originalCreateClient = window.supabase.createClient.bind(window.supabase);
      
      window.supabase.createClient = function(url, key, options) {
        const client = originalCreateClient(url, key, options);
        return patchSupabaseClient(client);
      };
      
      console.log('%c🛡️ SalesRLS active - all Supabase clients will be patched', 
        'background:#047857;color:#fff;padding:3px 8px;border-radius:3px;');
    }
  }

  // Try immediate patch
  if (window.supabase) {
    autoPatch();
  } else {
    // Wait for Supabase to load
    let attempts = 0;
    const waitInterval = setInterval(() => {
      attempts++;
      if (window.supabase) {
        autoPatch();
        clearInterval(waitInterval);
      } else if (attempts > 50) {
        clearInterval(waitInterval);
        console.warn('[SalesRLS] Supabase library not found after 5 seconds');
      }
    }, 100);
  }

  // Expose public API
  window.SalesRLS = {
    patch: patchSupabaseClient,
    getOwnerFilter,
    getCurrentUser,
    shouldFilter,
    FILTERED_TABLES,
    OWNER_COLUMNS,
    FULL_ACCESS_ROLES
  };

})(window);
