// Scroll-spy for the "On this page" table of contents: highlights the entry
// for the last section scrolled past and keeps the URL hash in sync.
// The tracked headings are whatever the .toc links point at, so a page only
// needs ids on its headings and matching links.
// ponytail: scroll position over IntersectionObserver so a short final
// section still activates at the bottom of the page (its heading never
// reaches an observer band). OFFSET = header + breathing room.
(() => {
  const OFFSET = 96;
  const links = new Map(
    [...document.querySelectorAll('.toc a[href^="#"]')].map((a) => [a.getAttribute('href').slice(1), a]),
  );
  const headings = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  if (headings.length === 0) return;

  const setActive = (id) => {
    links.forEach((a) => a.classList.remove('active'));
    links.get(id)?.classList.add('active');
    // Above the first section: no hash. Writing one during load made the
    // browser scroll to it once loading finished, skipping the title.
    if (location.hash !== (id ? '#' + id : '')) {
      history.replaceState(null, '', id ? '#' + id : location.pathname);
    }
  };

  const onScroll = () => {
    // At the bottom of the page the last section can't reach the top — pin it.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      setActive(headings[headings.length - 1].id);
      return;
    }
    let current = null;
    for (const h of headings) {
      if (h.getBoundingClientRect().top > OFFSET) break;
      current = h.id;
    }
    setActive(current);
  };

  document.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
