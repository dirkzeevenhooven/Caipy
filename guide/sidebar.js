/* ─────────────────────────────────────────────────────────────
   Planet Curated · Shared Sidebar Component
   Each page declares: var GUIDE_PAGE = 'page-id';
   Then loads: <script src="/guide/sidebar.js" defer></script>
───────────────────────────────────────────────────────────── */
(function () {

  // ── Navigation structure ────────────────────────────────
  var NAV = [
    // Primary (no section header)
    { type: 'item', id: 'home',           href: 'home.html',          icon: 'home',           label: 'Home' },
    { type: 'item', id: 'myguide',        href: 'myguide.html',       icon: 'book-open',      label: 'My Guide' },

    // Explore
    { type: 'section', label: 'Explore' },
    { type: 'item', id: 'experiences',    href: 'experiences.html',   icon: 'star',           label: 'Iconic Experiences' },
    { type: 'item', id: 'hidden-gems',    href: 'hidden-gems.html',   icon: 'gem',            label: 'Hidden Gems' },
    { type: 'item', id: 'neighbourhoods', href: 'neighbourhoods.html', icon: 'map-pin',        label: 'Neighbourhoods' },
    { type: 'item', id: 'beaches',        href: 'beaches.html',       icon: 'waves',          label: 'Beaches' },
    { type: 'item', id: 'outdoor-activities', href: 'outdoor-activities.html', icon: 'mountain',   label: 'Outdoor Activities' },
    { type: 'item', id: 'daytrips',       href: 'daytrips.html',      icon: 'compass',        label: 'Day Trips' },
    { type: 'item', id: 'map',            href: 'map.html',           icon: 'map',            label: 'Interactive Map' },

    // Eat & Drink
    { type: 'section', label: 'Eat & Drink' },
    { type: 'item', id: 'food',           href: 'food.html',          icon: 'utensils',       label: 'Where to Eat' },
    { type: 'item', id: 'wine',           href: 'wine.html',          icon: 'wine',           label: 'Wine & Winelands' },

    // Stay & Get Around
    { type: 'section', label: 'Stay & Get Around' },
    { type: 'item', id: 'stay',           href: 'stay.html',          icon: 'bed-double',     label: 'Where to Stay' },
    { type: 'item', id: 'carrental',      href: 'carrental.html',     icon: 'key',            label: 'Car Rental' },

    // Trip Prep
    { type: 'section', label: 'Trip Prep' },
    { type: 'item', id: 'budget',         href: 'budget.html',        icon: 'wallet',         label: 'Budget & Costs' },
    { type: 'item', id: 'safety',         href: 'safety.html',        icon: 'shield',         label: 'Safety Guide' },
    { type: 'item', id: 'packing',        href: 'packing.html',       icon: 'luggage',        label: 'Packing & Essentials' }
  ];

  var activePage = (typeof GUIDE_PAGE !== 'undefined') ? GUIDE_PAGE : '';

  // ── Build sidebar inner HTML ────────────────────────────
  function buildHTML() {
    var html = '';

    // In-sidebar Close button (lives at the top of the nav, near the logo)
    html += '<button type="button" class="pc-sidebar__close" id="navClose" title="Close navigation">' +
      '<span class="pc-sidebar__close-icon">\u2715</span> Close</button>';

    // Logo (links back to Guide Home)
    html += '<a href="home.html" class="pc-sidebar__logo" style="text-decoration:none;display:block;">' +
      '<div class="pc-sidebar__brand">Planet <span style="color:rgba(90,180,232,0.95)">Curated</span></div>' +
      '<div class="pc-sidebar__sub">Cape Town Guide</div>' +
      '</a>';

    // Build My Trip CTA
    var ctaStyle = activePage === 'itinerary'
      ? ' style="outline:2px solid rgba(201,169,110,0.5);outline-offset:2px;"'
      : '';
    html += '<a href="itinerary.html" class="pc-sidebar__cta"' + ctaStyle + '>&#9992;&#65039; Build My Trip</a>';

    // Talk to Ubuntu CTA (secondary, gold-outline)
    html += '<a href="home.html#ubuntu-voice" class="pc-sidebar__cta pc-sidebar__cta--ubuntu">&#128172; Talk to Ubuntu</a>';

    // Nav items
    for (var i = 0; i < NAV.length; i++) {
      var entry = NAV[i];
      if (entry.type === 'section') {
        html += '<div class="pc-sidebar__section">' + entry.label + '</div>';
      } else {
        var isActive = activePage === entry.id;
        var linkClass = 'pc-sidebar__link' + (isActive ? ' pc-sidebar__link--active' : '');
        html += '<a href="' + entry.href + '" class="' + linkClass + '">' +
          '<i data-lucide="' + entry.icon + '" class="pc-sidebar__link-icon"></i>' +
          entry.label +
          '</a>';
      }
    }

    return html;
  }

  // ── Inject sidebar, overlay, and toggle ────────────────
  function injectSidebar() {
    var placeholder = document.getElementById('guide-sidebar');
    if (!placeholder) return;

    // Sidebar element
    var sidebar = document.createElement('div');
    sidebar.className = 'pc-sidebar';
    sidebar.id = 'guide-sidebar-nav';
    sidebar.innerHTML = buildHTML();
    placeholder.parentNode.replaceChild(sidebar, placeholder);

    // Overlay (mobile/tablet drawer backdrop)
    var overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    document.body.appendChild(overlay);

    // Floating "Menu" open button — only visible while the sidebar is
    // closed/collapsed (see sidebar.css). Never overlaps content while open.
    var openBtn = document.createElement('button');
    openBtn.className = 'pc-nav-open';
    openBtn.id = 'navOpen';
    openBtn.title = 'Open navigation';
    openBtn.innerHTML = '<span class="pc-nav-open__icon">\u2630</span> Menu';
    document.body.appendChild(openBtn);

    // In-sidebar Close button (rendered by buildHTML)
    var closeBtn = sidebar.querySelector('#navClose');

    // ── Open / close logic ────────────────────────────────
    function isMobile() { return window.innerWidth <= 900; }

    function openNav() {
      if (isMobile()) {
        document.body.classList.remove('nav-hidden');
        document.body.classList.add('nav-open');
      } else {
        document.body.classList.remove('nav-hidden');
      }
    }
    function closeNav() {
      if (isMobile()) {
        document.body.classList.remove('nav-open');
      } else {
        document.body.classList.add('nav-hidden');
      }
    }

    if (closeBtn) closeBtn.addEventListener('click', closeNav);
    openBtn.addEventListener('click', openNav);

    overlay.addEventListener('click', function () {
      if (isMobile()) closeNav();
    });

    // Clean up stale body classes on resize
    window.addEventListener('resize', function () {
      if (!isMobile()) {
        document.body.classList.remove('nav-open');
      } else {
        document.body.classList.remove('nav-hidden');
      }
    });

    // ── Lucide icons ──────────────────────────────────────
    // The page's inline lucide.createIcons() may have already run before
    // this deferred script. Re-run to process newly-injected sidebar icons.
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
      lucide.createIcons();
    }
  }

  // Run immediately if DOM is ready, otherwise wait
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectSidebar);
  } else {
    injectSidebar();
  }

})();
