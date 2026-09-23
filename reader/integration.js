// Preserve Bibi's prototype-clone behavior without its historical `new Function`.
// This keeps restored settings compatible with script-src 'self'.
sML.clone = function (value) {
  return Object.create(value !== null && ['object', 'function'].includes(typeof value) ? value : Object.prototype);
};

// Bibi controls chapter layout from the parent; EPUB scripts need no privileges.
const createElement = sML.create;
sML.create = function (...args) {
  const element = createElement.apply(this, args);
  if (element?.tagName === 'IFRAME' && element.classList.contains('item')) {
    element.setAttribute('sandbox', 'allow-same-origin');
  }
  return element;
};

// Keep the full Bibi reader, but display one page on every screen size. Set the
// package before Bibi builds its spine so fixed-layout left/right pages are not
// grouped into a spread. The user's EPUB file itself is never changed.
const openDocument = O.openDocument;
O.openDocument = function (...args) {
  return openDocument.apply(this, args).then(doc => {
    if (doc.documentElement.localName !== 'package') return doc;
    const metadata = doc.getElementsByTagNameNS('*', 'metadata')[0];
    if (metadata) {
      const spread = Array.from(metadata.getElementsByTagNameNS('*', 'meta'))
        .filter(meta => meta.getAttribute('property') === 'rendition:spread');
      if (!spread.length) {
        const meta = doc.createElementNS(metadata.namespaceURI, 'meta');
        meta.setAttribute('property', 'rendition:spread');
        metadata.appendChild(meta);
        spread.push(meta);
      }
      spread.forEach(meta => { meta.textContent = 'none'; });
    }
    for (const item of doc.getElementsByTagNameNS('*', 'itemref')) {
      const properties = (item.getAttribute('properties') || '').split(/\s+/)
        .filter(property => property && !/^(?:rendition:)?(?:spread|page-spread)-/.test(property));
      properties.push('rendition:spread-none');
      item.setAttribute('properties', properties.join(' '));
    }
    return doc;
  });
};

// Apply this after restored settings as well, so an old saved scrolling mode
// cannot override the single-page reader. Font size, bookmarks and position
// continue to use Bibi's existing persistence.
const updateSettings = S.update;
S.update = function (settings = {}) {
  return updateSettings.call(this, { ...settings, 'reader-view-mode': 'paged' });
};
