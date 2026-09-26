/* Local-only UI shims. The real build keeps the CDN libraries unchanged. */
(function () {
  window.Swal = window.Swal || { fire: function () { return Promise.resolve({ isConfirmed: true, value: {} }); }, showValidationMessage: function () {} };
  window.Chart = window.Chart || function () { return { destroy: function () {} }; };
  window.tailwind = window.tailwind || {};
  // Preserve the visibility utility while the production Tailwind runtime
  // initializes in the local visual test harness.
  var style = document.createElement('style');
  style.textContent = [
    '.hidden{display:none!important;}',
    /* Browser GPT may use a narrow viewport. Keep the staff menu visible in
       Local Test so every tab can be inspected without opening a drawer. */
    '@media (max-width: 767px){',
    '#admin-sidebar{display:flex!important;position:relative!important;left:auto!important;width:260px!important;min-width:260px!important;height:100%!important;}',
    '#admin-sidebar{display:flex!important;width:260px!important;min-width:260px!important;}',
    '#admin-sidebar.sidebar-collapsed{width:260px!important;}',
    '#admin-sidebar .sidebar-header-text,#admin-sidebar .nav-text,#admin-sidebar .sidebar-footer-info{display:block!important;}',
    '#admin-sidebar .nav-item{justify-content:flex-start!important;padding-left:1.5rem!important;padding-right:1.5rem!important;margin-left:0!important;margin-right:0!important;border-radius:0 10px 10px 0!important;}',
    '#admin-sidebar .nav-item i{margin-right:0!important;font-size:1rem!important;}',
    '}',
    /* Local Test keeps the menu expanded at every viewport size. */
    '#admin-sidebar.sidebar-collapsed{width:260px!important;}',
    '#admin-sidebar.sidebar-collapsed .nav-text,#admin-sidebar.sidebar-collapsed .sidebar-header-text,#admin-sidebar.sidebar-collapsed .sidebar-footer-info{display:block!important;}',
    '#admin-sidebar.sidebar-collapsed .nav-item{justify-content:flex-start!important;padding-left:1.5rem!important;padding-right:1.5rem!important;margin-left:0!important;margin-right:0!important;}',
    '#admin-sidebar{display:flex!important;width:260px!important;min-width:260px!important;}'
  ].join('');
  document.head.appendChild(style);
  // Do not override window.print in Local Test. The source print handlers
  // must call the browser's native Print Preview/Print Dialog directly.
})();
