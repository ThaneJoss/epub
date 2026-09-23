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
