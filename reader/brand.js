// Brand the UI that Bibi creates after reading index.html. Keep its file input,
// drop handlers and reader controls intact; EPUB titles and covers are untouched.
(() => {
  const brandLink = () => {
    const link = document.createElement('a');
    link.className = 'leafread-brand';
    link.href = '/';
    link.setAttribute('aria-label', '叶读 LeafRead 首页');
    link.title = '返回叶读首页';
    link.innerHTML = '<img src="/leafread.svg" width="24" height="24" alt=""><span>叶读 <small>LeafRead</small></span>';
    return link;
  };

  const createCatcher = I.Catcher.create;
  I.Catcher.create = function (...args) {
    createCatcher.apply(this, args);
    const catcher = document.getElementById('bibi-catcher');
    if (!catcher) return;
    const welcome = catcher.querySelector('.pgroup');
    welcome.classList.add('leafread-welcome');
    welcome.lang = 'zh-CN';
    welcome.innerHTML = '<img class="leafread-welcome-logo" src="/leafread.svg" width="80" height="80" alt="">'
      + '<h1>叶读<small>LeafRead</small></h1>'
      + '<p class="leafread-welcome-copy">打开一本书，开始阅读。</p>'
      + '<button class="leafread-open-book" type="button">选择 EPUB 文件</button>'
      + '<p class="leafread-welcome-hint">也可以将电子书拖到这里</p>'
      + '<p class="leafread-welcome-note">文件仅在你的浏览器中读取</p>';
    catcher.title = '选择 EPUB 文件，或将电子书拖到这里';
    catcher.querySelector('.book-icon')?.remove();
    catcher.Input.setAttribute('aria-label', '选择 EPUB 文件');
  };

  const createMenu = I.Menu.create;
  I.Menu.create = function (...args) {
    createMenu.apply(this, args);
    const link = brandLink();
    link.classList.add('leafread-menu-brand');
    I.Menu.appendChild(link);
  };

  const createPoweredBy = I.PoweredBy.create;
  I.PoweredBy.create = function (...args) {
    createPoweredBy.apply(this, args);
    const row = document.createElement('p');
    row.className = 'leafread-credits';
    row.appendChild(brandLink());
    const credit = document.createElement('a');
    credit.className = 'leafread-engine-credit';
    credit.href = 'https://github.com/satorumurmur/bibi';
    credit.target = '_blank';
    credit.rel = 'noopener noreferrer';
    credit.textContent = 'Powered by Bibi';
    row.appendChild(credit);
    I.PoweredBy.replaceChildren(row);
  };
})();
