# 叶读 · LeafRead

叶读（LeafRead）是一款免登录的 EPUB 在线阅读器。输入在线 EPUB 直链即可阅读，也可以直接打开本地 EPUB。界面沿用 [ThaneJoss/webapps](https://github.com/ThaneJoss/webapps) 的浅灰背景、白色卡片、蓝色主色与字体样式，使用独立的叶读品牌与书本图标。

阅读器使用 MIT 开源项目 [Bibi v1.2.0](https://github.com/satorumurmur/bibi/tree/v1.2.0)，在电脑、手机和横屏下均使用**单页翻阅**，保留目录、字号、书签与本地阅读进度。前端静态资源和链接代理部署在**同一个 Cloudflare Worker**，不需要 R2、KV、D1 或登录服务。

## 关联 GitHub 部署

在 Cloudflare 的 **Workers & Pages → 创建 Worker → 导入 Git 仓库** 中选择 `ThaneJoss/epub`，使用以下配置：

| 配置项 | 值 |
| --- | --- |
| 项目 / Worker 名称 | `epub` |
| 生产分支 | `main` |
| 根目录 | `/`（仓库根目录） |
| 构建命令 | **留空** |
| 部署命令 | `npx wrangler deploy` |
| Node.js | 22 或以上，仓库提供 `.node-version` |

Wrangler 的 `build.command` 已设置为 `npm run build`，部署时自动运行，不需要在控制台重复填写构建命令。Cloudflare 自动安装 npm 依赖；锁文件已提交。若控制台要求填写构建命令，也可以填 `npm run build`，重复构建不会影响结果。

`wrangler.jsonc` 已包含自定义域名：

```json
"routes": [{ "pattern": "epub.thanejoss.com", "custom_domain": true }]
```

需要在拥有 `thanejoss.com` Cloudflare zone 的账户下关联仓库。域名由首次部署创建；若此子域名已绑定其他站点或存在冲突 DNS 记录，请先在 Cloudflare 中解除冲突。项目无需在 GitHub 中添加 Cloudflare 密钥。`workers.dev` 地址也保持启用。

构建会下载固定的官方 Bibi 发布包，校验 SHA-256 后解压到 `dist/bibi/`；不需要自行下载或编译旧版 Bibi。浏览器运行时不依赖第三方 JS CDN。所有后续 `main` 提交可由 Cloudflare Git 集成自动部署。

## 本地运行

```sh
npm ci
npm run dev
```

打开 Wrangler 输出的本地地址。`npm run dev` 与 `npm run deploy` 都自动构建。

```sh
npm test                         # Worker 代理回归测试
npm run check                    # 测试 + Wrangler 部署打包预检，不部署
npm run build
npx playwright install chromium
npm run test:browser              # 真实 EPUB 的桌面 / 手机浏览器测试
```

浏览器测试通过本地 HTTP 适配器运行生产 Worker 代理逻辑，使用仓库生成的 EPUB 测试文件；不依赖外部书源或 Cloudflare 账户。

## 使用

- 首页粘贴 **HTTPS 文件直链**，点击“开始阅读”。允许 URL 下载参数，不要求路径必须以 `.epub` 结尾。
- 点击“选择本地文件”进入 Bibi，然后选择或拖入 `.epub` 文件。本地文件不会上传。
- 阅读器菜单中的“返回叶读首页”可打开另一本文档。
- 每次显示一页，使用左右箭头、方向键或触摸滑动翻页。固定排版 EPUB 的左右配对页也会逐页显示；书籍文件内部绘制的跨页大图仍作为一张原始页面展示。保留普通翻页，不提供拟真纸张卷页动画。
- 阅读模式固定为分页；旧浏览器缓存中的滚动模式不会覆盖它，原有字号、书签与阅读位置继续保留。单页显示不代表只下载一页，EPUB 的加载与排版仍由 Bibi 在浏览器中完成。
- 支持无 DRM 的 EPUB 2 / 3；登录页面、网盘分享页面、需要 Cookie 的下载及 DRM 加密书籍不支持。
- 阅读位置、书签和设置保存在同一浏览器的本地存储中。清除站点数据或更换浏览器不会同步；更换签名 URL 也可能被视为另一本书。

## 配置与边界

`wrangler.jsonc` 中可调整：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MAX_EPUB_MB` | `100` | 单本 EPUB 下载上限；同时检查响应长度、Range 总长度及实际流量 |
| `ALLOWED_HOSTS` | 空字符串 | 默认允许公网 HTTPS 域名；填写逗号分隔的域名可限制书源，重定向目标也必须匹配 |

- `/`：中文链接输入页。
- `/bibi/`：完整 Bibi 阅读器。
- `/books/<base64url>.epub`：流式代理，保留 GET / HEAD、Range、206、304、416 与文件元数据。
- 代理禁止 IP 字面量、本地名称、凭据、自定义端口及自引用地址；重定向最多 4 次，每次重新校验，单次下载 30 秒超时。不转发 Cookie、Authorization 或用户 IP。
- 此代理针对 **Cloudflare Workers 的公网 `fetch()`** 实现，不配置 VPC / 私有网络绑定。域名校验不是通用 Node 服务的 DNS 绑定防护；不要直接移植到可访问内网的服务器上。部署为公开站点时可通过 `ALLOWED_HOSTS` 收窄书源，并按需要配置 Cloudflare 流量规则。
- Worker 不将 EPUB 完整读入内存或保存到云端。首次检查 ZIP 签名，最终 EPUB 结构和解压由 Bibi 在浏览器中校验。浏览器内存及复杂排版仍会影响大文件体验。
- 禁止 EPUB 内脚本；以锁定版本的 DOMPurify 替换 Bibi 原有旧版 sanitizer，清理目录、为章节加入 iframe sandbox 和单独的 CSP。小型兼容层移除恢复阅读时对动态代码执行的依赖，不开启 `unsafe-eval`。外部嵌入资源被限制，带远程资源的书籍应先把资源打包到 EPUB 内。
- 在线书籍的阅读 URL 中包含可逆编码的原始链接，**不是加密**。不要分享含私有签名的阅读 URL；站点使用 `no-referrer`、`no-store`，默认关闭 Worker 请求日志。Cloudflare 平台与源站仍可能拥有访问日志。

## 目录

```text
public/         首页与静态响应头
reader/         Bibi 配置、外观和 sanitizer 覆盖
src/worker.js   EPUB 流式代理
scripts/        下载、校验和组装 Bibi
tests/          代理测试与真实 EPUB 浏览器测试
wrangler.jsonc  Worker、Static Assets、自定义域名
```

Bibi 的许可随构建发布在 `/licenses/Bibi.txt`，DOMPurify 许可位于 `/licenses/DOMPurify.txt`。项目自身代码采用 MIT 许可。

`reader/integration.js` 在构建阅读模型前设置 `rendition:spread=none`，移除左右配页提示。`scripts/patch-bibi.mjs` 修正 Bibi 1.2.0 在宽屏下忽略该设置的两处布局判断；补丁只应用于经过 SHA-256 校验的固定发布包，若上游代码不匹配则构建失败。
