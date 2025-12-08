/* payments_admin.js compatibility shim */
window.__paymentsAdmin = window.__paymentsAdmin || {};
// legacy alias: call into the main fetcher if available
window.__paymentsAdmin.fetchPayments = window.__paymentsAdmin.fetchPayments || function(){ console.warn('payments_admin.fetchPayments not initialized yet'); };
