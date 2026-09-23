/* App integration. DOMPurify is prepended by scripts/build.mjs. */
Bibi.x({ id: 'Sanitizer', description: 'DOMPurify content sanitizer', author: 'ThaneJoss', version: '1.0.0' })(function () {
  DOMPurify.addHook('uponSanitizeAttribute', function (node, data) {
    // EPUB resources must be packaged locally. Keep external hyperlinks, but
    // discard remote image/media/CSS sources before Bibi can try to fetch them.
    if (['src', 'srcset', 'poster', 'href', 'xlink:href', 'background'].includes(data.attrName)) {
      const isLink = node.nodeName.toLowerCase() === 'a' && data.attrName === 'href';
      const value = data.attrValue.trim();
      if (!isLink && /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value) && !/^(?:blob:|data:)/i.test(value)) data.keepAttr = false;
    }
  });
  // Bibi's navigation is inserted into the reader UI, outside chapter frames.
  const openDocument = O.openDocument;
  O.openDocument = function (source, ...args) {
    return openDocument.call(this, source, ...args).then(function (doc) {
      if (source.Path !== B.Nav?.Source?.Path) return doc;
      if (B.Nav.Type === 'Navigation Document') {
        const clean = DOMPurify.sanitize(doc.documentElement.outerHTML, {
          WHOLE_DOCUMENT: true, RETURN_DOM: true, ADD_ATTR: ['epub:type'],
          FORBID_TAGS: ['form', 'input', 'button', 'iframe', 'object', 'embed', 'base', 'meta'],
        });
        doc.replaceChild(doc.importNode(clean, true), doc.documentElement);
      } else {
        // EPUB 2 NCX labels are plain text, never HTML.
        for (const text of doc.getElementsByTagName('text')) text.textContent = text.textContent;
        for (const content of doc.getElementsByTagName('content')) {
          if (/^\s*(?:javascript|data|vbscript):/i.test(content.getAttribute('src') || '')) content.removeAttribute('src');
        }
      }
      return doc;
    });
  };
  O.sanitizeItemSource = function (source, options) {
    if (!source || typeof source.Content !== 'string' || !['HTML', 'SVG'].includes(options?.As)) {
      throw new Error('Invalid EPUB content');
    }
    const isHtml = options.As === 'HTML';
    source.Content = DOMPurify.sanitize(source.Content, {
      WHOLE_DOCUMENT: isHtml,
      USE_PROFILES: isHtml ? { html: true, svg: true, svgFilters: true, mathMl: true } : { svg: true, svgFilters: true },
      ADD_TAGS: isHtml ? ['link'] : [],
      ADD_ATTR: ['xmlns', 'xmlns:epub', 'epub:type'],
      FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'meta', 'base', 'foreignObject'],
      FORBID_ATTR: ['srcdoc', 'action', 'formaction'],
    });
    if (isHtml) {
      // A second policy in each chapter prevents script execution and remote tracking.
      // Bibi's parent can still lay out and navigate its same-origin chapter documents.
      const policy = "default-src 'none'; script-src 'none'; style-src 'self' blob: data: 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; media-src blob: data:; base-uri 'none'; form-action 'none'";
      source.Content = source.Content.replace(/<head[^>]*>/i, '$&<meta http-equiv="Content-Security-Policy" content="' + policy + '">')
        .replace(/(<head[\s>])/, '\n$1').replace(/(<\/body>)/, '$1\n');
    }
    return source.Content;
  };
});
