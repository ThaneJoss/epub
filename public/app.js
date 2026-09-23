const form = document.querySelector('#book-form');
const input = document.querySelector('#book-url');
const button = document.querySelector('#read-button');
const label = document.querySelector('#read-label');
const feedback = document.querySelector('#feedback');

function encodeUrl(value) {
  const bytes = new TextEncoder().encode(value);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

input.addEventListener('input', () => {
  input.removeAttribute('aria-invalid');
  feedback.textContent = '';
  feedback.classList.remove('error');
});

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (button.disabled) return;
  feedback.classList.remove('error');
  let target;
  try {
    target = new URL(input.value.trim());
    if (target.protocol !== 'https:' || target.username || target.password || target.port || target.href.length > 6000) throw new Error();
  } catch {
    feedback.textContent = '请输入有效的 HTTPS EPUB 文件直链。';
    feedback.classList.add('error');
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  target.hash = '';
  button.disabled = true;
  form.setAttribute('aria-busy', 'true');
  label.textContent = '正在打开…';
  feedback.textContent = '正在检查文件链接…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const book = `${encodeUrl(target.href)}.epub`;
    // GET instead of HEAD: many download servers do not implement HEAD.
    const response = await fetch(`/books/${book}`, { headers: { Range: 'bytes=0-3' }, signal: controller.signal });
    if (!response.ok) throw new Error((await response.text()).slice(0, 300) || '无法打开此链接，请稍后重试。');
    await response.body?.cancel();
    location.assign(`/bibi/?book=${book}`);
  } catch (error) {
    feedback.textContent = error.name === 'AbortError' ? '连接超时，请检查链接后重试。' : error.message;
    feedback.classList.add('error');
  } finally {
    clearTimeout(timeout);
    button.disabled = false;
    form.removeAttribute('aria-busy');
    label.textContent = '开始阅读';
  }
});
