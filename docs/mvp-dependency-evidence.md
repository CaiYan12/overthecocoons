# 运行时与依赖查证记录

日期：2026-10-03。以下是当日只读证据，不是安装、构建或测试通过结果。

## 本机与已选工具

| 工具 | 实际版本 | 决定 |
| --- | --- | --- |
| Node | v24.18.0 | 本地/CI计划固定24.18.0 |
| pnpm | 10.26.2 | 已选，计划固定并使用pnpm-lock.yaml |
| npm | 12.0.2 | 已发现，未选为项目包管理器 |
| Corepack | 0.35.0 | 已发现，未改全局设置 |

Git origin 实际为 `https://github.com/CaiYan12/overthecocoons.git`。未发现应用源码、package.json、锁文件、构建/测试配置或工作流。
[Node官方校验清单](https://nodejs.org/dist/v24.18.0/SHASUMS256.txt) 可读取，包含 Linux x64 与 Windows x64 发行文件；未下载运行包或验证runner获取。

## 公共 registry 元数据

2026-10-03 11:03–11:04北京时间读取公共 registry；Playwright另于12:03核验。

| 包 | 所查版本 | 声明范围/结论 |
| --- | --- | --- |
| astro | 7.3.5 | Node >=22.12.0；依赖Vite ^8.0.13 |
| tailwindcss | 4.3.3 | 未返回engine，不等于已验证所有runtime |
| @tailwindcss/vite | 4.3.3 | Vite ^5.2.0或6/7/8；配套Tailwind组件精确4.3.3 |
| typescript | 7.0.2 | 当前latest，但不满足下行checker peer，不建议直接选 |
| typescript | 6.0.3 | 已查到兼容范围内版本，作为工程建议起点 |
| @astrojs/check | 0.9.10 | peer TypeScript ^5.0.0或^6.0.0 |
| rss-parser | 3.13.0 | 已查发布源码与类型，建议首源解析器 |
| @playwright/test | 1.63.0 | 已选；Node >=20，依赖playwright精确1.63.0 |
| vitest | 5.0.3 | 已查，但用户选择Node test runner，未采用 |
| tsx | 4.23.15 | 已查，是否需要未确认；Node原生TS方案可不采用 |

Node24.18满足所返回范围；Vite8.0.13与Tailwind插件/Vitest peer范围相容。以上只是metadata，最终依赖图需实际安装与锁文件验证，不统一采用latest。

## 匹配版本源码证据

- [Astro7.3.5发布包](https://registry.npmjs.org/astro/-/astro-7.3.5.tgz)：内存检查确认ClientRouter虚拟导入、getStaticPaths、site/base/output仍存在；ClientRouter不自动保存本项目筛选/页码。
- [rss-parser3.13.0发布包](https://registry.npmjs.org/rss-parser/-/rss-parser-3.13.0.tgz)：parseString支持已获取XML；GUID有属性时提取文本；description映射到content/contentSnippet；snippet不自动限制300字。
- RSS坏pubDate转换异常被忽略，原字符串可保留；不能泛化到Atom，也不能把有效isoDate当原始新闻时间可靠性证明。
- [pnpm10.26.2发布包](https://registry.npmjs.org/pnpm/-/pnpm-10.26.2.tgz)与本机help确认frozen-lockfile、approve-builds、add的allow-build；尚未确认需批准哪些依赖scripts。
- Context7部分pnpm检索返回11/12版本片段，不能把其install参数套给10.26.2。匹配源码提示项目pnpm-workspace.yaml的onlyBuiltDependencies；实际采用配置待安装证据确定，不全局放行scripts。
- 若创建pnpm-workspace.yaml仅作构建许可策略，而没有多包结构，不能因此把本项目称为多上下文系统。

## 源数据证据与限制

10:59:37与11:00:16北京时间，两次feed HTTP200、各100条。第二份全量无空/重复GUID，无重复完整link/解码wd/清理标题，9条description为空；100条GUID isPermaLink=false，100标题匹配精确热度后缀。
两次命中同一Cloudflare缓存版本，仅首部样例与末尾值核对一致，未完成全量机器差分，不能宣称100条跨更新稳定。
标题与搜索词可存在空白差异：GUID2207408的清理标题为“新能源车假日充电大考”，wd为“新能源车 假日充电大考”。
时间语义、长期GUID稳定性、来源内容公开使用范围仍未核实。当前主机可读取不证明CI或所有网络可访问。

## 官方资料入口

- [Astro路由](https://docs.astro.build/en/guides/routing/)
- [Astro客户端转场](https://docs.astro.build/en/guides/view-transitions/)
- [GitHub缓存用途](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching)
- [GitHub Pages自定义404](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-custom-404-page-for-your-github-pages-site)
- [Node24 TypeScript](https://nodejs.org/docs/latest-v24.x/api/typescript.html)
- [Playwright设备模拟](https://playwright.dev/docs/emulation)
