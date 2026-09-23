// Bibi 1.2.0 otherwise enables spreads on landscape screens even when an EPUB
// explicitly requests rendition:spread=none. Patch the two layout decisions in
// the checksum-pinned release; do not silently accept a changed upstream bundle.
export function patchSinglePageLayout(source) {
  const replacements = [
    [
      'e.Spreaded="horizontal"==F.SLA',
      'e.Spreaded="none"!=e["rendition:spread"]&&"horizontal"==F.SLA',
    ],
    [
      'e.Spreaded=!("paged"!=F.RVM',
      'e.Spreaded="none"!=e["rendition:spread"]&&!("paged"!=F.RVM',
    ],
  ];
  for (const [before, after] of replacements) {
    if (source.split(before).length !== 2) {
      throw new Error('Bibi single-page patch no longer matches the pinned release');
    }
    source = source.replace(before, after);
  }
  return source;
}
