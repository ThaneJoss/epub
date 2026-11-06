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

  // Share one parser with Bibi so validation and actual layout agree.
  // Exponents also support numeric values serialized by JavaScript.
  const parseViewport = content => {
    if (typeof content !== 'string') return null;
    const dimensions = new Map();
    const pattern = /(?:^|[,;\s])(width|height)\s*=\s*([^,;\s]*)/gi;
    for (const match of content.matchAll(pattern)) {
      const name = match[1].toLowerCase();
      const value = Number(match[2]);
      if (dimensions.has(name) || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(match[2])
        || !Number.isFinite(value) || value <= 0) return null;
      dimensions.set(name, value);
    }
    return dimensions.size === 2
      ? { Width: dimensions.get('width'), Height: dimensions.get('height') }
      : null;
  };

  O.getViewportByMetaContent = parseViewport;

  // Inspect a metadata-only copy; never restore arbitrary EPUB meta elements.
  const readViewport = content => {
    const metadata = DOMPurify.sanitize(content, {
      WHOLE_DOCUMENT: true,
      RETURN_DOM: true,
      ALLOWED_TAGS: ['html', 'head', 'body', 'meta'],
      ALLOWED_ATTR: ['name', 'content'],
      ALLOW_DATA_ATTR: false,
      ALLOW_ARIA_ATTR: false,
      KEEP_CONTENT: false,
    });
    const meta = Array.from(metadata.querySelectorAll('head > meta'))
      .find(element => (element.getAttribute('name') || '').trim().toLowerCase() === 'viewport');
    const viewport = meta ? parseViewport(meta.getAttribute('content')) : null;
    return viewport ? `width=${viewport.Width}, height=${viewport.Height}` : '';
  };

  // Navigation enters the parent UI, so it needs a stricter policy than chapters.
  // Sanitize before passing any navigation nodes to Bibi's document parser.
  const openDocument = O.openDocument;
  O.openDocument = function (source, ...args) {
    if (source.Path === B.Nav?.Source?.Path && B.Nav.Type === 'Navigation Document') {
      return O.file(source).then(function (navigation) {
        const clean = DOMPurify.sanitize(navigation.Content, {
          WHOLE_DOCUMENT: true,
          RETURN_DOM: true,
          ALLOWED_TAGS: [
            'html', 'head', 'body', 'title', 'nav',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
            'ol', 'ul', 'li', 'a', 'span', 'p', 'div', 'br',
            'em', 'strong', 'b', 'i', 'small',
          ],
          ALLOWED_ATTR: ['href', 'epub:type', 'lang', 'xml:lang', 'dir', 'title', 'aria-label'],
          ALLOW_DATA_ATTR: false,
          ALLOW_ARIA_ATTR: false,
        });
        const doc = document.implementation.createHTMLDocument('');
        doc.replaceChild(doc.importNode(clean, true), doc.documentElement);
        return doc;
      });
    }
    return openDocument.call(this, source, ...args).then(function (doc) {
      if (source.Path !== B.Nav?.Source?.Path) return doc;
      // EPUB 2 NCX labels are plain text, never HTML.
      for (const text of doc.getElementsByTagName('text')) {
        // The DOM setter replaces any child markup with a single text node.
        // eslint-disable-next-line no-self-assign -- deliberately invoke the textContent setter
        text.textContent = text.textContent;
      }
      for (const content of doc.getElementsByTagName('content')) {
        if (/^\s*(?:javascript|data|vbscript):/i.test(content.getAttribute('src') || '')) content.removeAttribute('src');
      }
      return doc;
    });
  };

  O.sanitizeItemSource = function (source, options) {
    if (!source || typeof source.Content !== 'string' || !['HTML', 'SVG'].includes(options?.As)) {
      throw new Error('Invalid EPUB content');
    }
    const isHtml = options.As === 'HTML';
    const viewport = isHtml ? readViewport(source.Content) : '';
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
      const safeMetadata = '<meta http-equiv="Content-Security-Policy" content="' + policy + '">'
        + (viewport ? '<meta name="viewport" content="' + viewport + '">' : '');
      source.Content = source.Content.replace(/<head[^>]*>/i, '$&' + safeMetadata)
        .replace(/(<head[\s>])/, '\n$1').replace(/(<\/body>)/, '$1\n');
    }
    return source.Content;
  };
});
