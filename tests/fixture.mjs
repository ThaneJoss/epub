import { zipSync, strToU8 } from 'fflate';

// Original test content. This is a genuine EPUB 3 ZIP, not a mocked reader.
export function makeEpub() {
  const text = '阅读是一段安静的旅程。你可以翻页、调整字号，或通过目录前往下一章。';
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8('<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:thanejoss-test</dc:identifier><dc:title>阅读测试</dc:title><dc:creator>ThaneJoss</dc:creator><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2026-09-23T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>'),
    'OEBPS/nav.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目录</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">第一章 开始阅读</a></li><li><a href="two.xhtml">第二章 继续旅程</a></li></ol></nav></body></html>'),
    'OEBPS/one.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第一章</title><style>body{font-family:serif;line-height:1.8}h1{color:#182230}</style></head><body><h1>第一章 开始阅读</h1>' + Array.from({ length: 40 }, () => `<p>${text.repeat(4)}</p>`).join('') + '<script>parent.__epubScriptRan = true</script><img src="https://tracker.example.org/pixel" onerror="parent.__epubScriptRan=true"/></body></html>'),
    'OEBPS/two.xhtml': strToU8('<html xmlns="http://www.w3.org/1999/xhtml"><head><title>第二章</title></head><body><h1>第二章 继续旅程</h1><p>你已到达第二章。目录跳转成功。</p></body></html>'),
  });
}
