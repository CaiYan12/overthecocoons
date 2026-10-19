# 五个网站订阅的本地接入

2026-10-19：用户选择上一轮推荐组合并要求增加来源。本次扩展现有采集与渲染流程，不改更新频率、时间线排序、7 天公开窗口、20 条分页或视觉动效。尚未提交、推送、发布；既有线上百度来源维持其原发布状态。

## 来源与字段政策

| 来源 ID（冻结） | 名称 | RSS 地址 | 默认主题 |
| --- | --- | --- | --- |
| chinanews-society | 中新网·社会 | https://www.chinanews.com.cn/rss/society.xml | 社会 |
| chinanews-world | 中新网·国际 | https://www.chinanews.com.cn/rss/world.xml | 新闻 |
| chinanews-dxw | 中新网·东西问 | https://www.chinanews.com.cn/rss/dxw.xml | 文化 |
| geekpark | 极客公园 | https://www.geekpark.net/rss | 科技 |
| solidot | Solidot | https://www.solidot.org/index.rss | 科技 |

2026-10-19 本机实际解析分别为 30、30、7、30、17 条，均缺 GUID、缺条目分类、均提供文章链接。各条目文章域名分别为 `www.chinanews.com.cn`、`www.geekpark.net`、`www.solidot.org`；极客公园返回的文章链接为 HTTP，不擅自改写 HTTPS。默认主题只是来源级映射，不推断单篇文章分类。

百度 `baidu-aishort` 的身份、热度后缀清理与 wd 冲突规则完全沿用。新增五个来源采用固定 URL 身份策略：身份键为 `url:` 加解析后的源文章 URL，保留原始大小写、协议、路径、参数顺序，不剥除参数、不请求页面猜测 canonical、不跨来源去重；以后增加 GUID 也不切换策略。摘要优先订阅 description 纯文本，缺失时用订阅 content:encoded 纯文本，最多 300 Unicode 码点。不抓网页补全文或图片。

这是对 MVP-Q4/Q15 及 mvp-spec「身份必须来自 GUID」的**仅限上述来源的扩展**。三文件的 `guid` 字段保留历史名称以兼容已有状态：百度存原 GUID，上述五源存明确的 `url:<文章URL>` 身份键，不声称这是上游 GUID。哈希算法仍为 `SHA-256(sourceId + NUL + guid)`；旧百度台账、首次收录时间和详情 URL 无需迁移。旧来源缺 GUID 仍隔离。

新增来源的 pubDate 仅证明订阅提供了日期文本，语义尚未逐源核实；`originalTime` 保持 null，排序仍用首次收录时间。所有来源都按首次收录进入 7 天窗口，初次获取不将订阅日期伪称为首次收录日期。

## 获取与发布边界

- `runDataUpdate` 在原三文件摘要校验和时钟闸门后依次获取六个订阅、逐源 ingest；串行执行避免并发结果的 attemptedAt/succeededAt 交错。最终只按原 HEAD 前提写一次三文件；任何状态校验或并发冲突仍停写。
- 复用现有 URL 安全校验、逐跳重定向校验、有界响应体、严格 UTF-8 和两次尝试。新源空订阅、空标题、文章链接域名/协议/凭据/端口异常令该来源失败，保留可信旧内容；不伪造条目。
- 任一来源获取失败，其他来源继续；结果记为 degraded，各源成功/失败时间分别保留。CLI 输出全部来源状态。
- `PublicEntry.sourceId` 为新增公开字段，来源从权威 items 传到公开快照、数据岛、静态与增强渲染。只为旧百度快照兼容缺省来源；新快照明确携带 sourceId。不同来源的元信息与外链名称不再全部写成百度。
- 保留每日北京时间 08:00 更新。订阅容量有限，可能遗漏两次采集之间移出 feed 的文章；不承诺完整新闻归档。
- RSS 可订阅不等于公开转载许可。新增来源的标题/摘要公开展示依据须逐源核查；本次仅本地接入与验证，不将原百度许可裁定扩大到新来源。来源页明确这一边界。

2026-10-19 进一步查阅的官方声明：[中新网法律声明](https://www.chinanews.com.cn/end_navigation/12.html)要求授权使用其相关稿件，[Solidot 使用条款](https://developers.solidot.org/terms)对复制、转发作出限制；[极客公园服务条款](https://www.geekpark.net/about/)也保留知识产权约束。当前未取得新增来源公开展示标题/摘要的独立授权证据，不能以“官方有 RSS”推导授权。这是上线前待核查项，不妨碍本地开发和接口验证；未经进一步确认不发布本地真实演练数据。

## 验证与复现

1. `pnpm smoke:sources`：六源只读真实烟测，不写数据，单次主机结果不证明长期/全网可用。
2. `pnpm test`：类型检查、演示快照静态构建、Node 测试、Chromium 回归。演示快照保持原 45 条，避免将真实新闻混入自动化夹具。
3. 本地真实演练使用忽略目录 `.snapshot/multi-source-local-20261019/`，显式初始化独立台账后通过默认六源更新入口获取；首次运行 214 条、0 隔离、六源成功。该目录不属于权威 data 分支。
4. 真实预览通过 `SNAPSHOT_PATH=.snapshot/multi-source-local-20261019/snapshot.json` 注入开发服务器；不改变默认 fixture，也不将本地演练首次收录时间推到线上。

Node 测试覆盖 URL 身份稳定、摘要限长、来源字段穿透、异常域名/协议、失败重试及部分失败后继续合并。完整 `pnpm test` 已通过：check 0 error / 0 warning（2 条既有 execCommand 弃用 hint）、演示构建 66 页、Node 311/311、Chromium 188 passed + 1 触屏专用 skipped（3.5 分钟）。`pnpm smoke:sources` 六源全部成功，合计 214 条。浏览器真实多源验证另行补录，不把演示夹具回归说成真实数据浏览器验收。

真实快照另以 `pnpm exec astro build --outDir .snapshot/multi-source-dist` 构建 250 页，逐一核对六个来源的详情产物名称与外链文案，新来源没有误标为百度搜索。保留默认 dist 的 66 页演示构建不变。

独立 IAB 在 519px 视口访问带真实快照的 4322 开发服务器，实看六源／214 条 HUD、文化主题菜单筛选（客户端显示 7 条东西问）、来源文章入口、静态详情页与六源状态。来源页 DOM 实测 scrollWidth=innerWidth=519，无横向溢出。截图 `audit/multi-source-culture.png`；服务保持运行，未连接用户浏览器或声称新真机/FPS/线上验收。

独立只读代码审查未发现 Important/Critical 或需阻塞的小问题；该审查没有重跑测试或浏览器。最终预览数据岛实测 `isFixture=false`、214 条、六个来源 ID，演示提示节点为空；首页 scrollWidth=innerWidth=519。

## 2026-10-19 列表简介截断

用户指出新源长简介撑高卡片，要求用省略号截断。仅在 `src/styles/kinetic.css` 对 `.k-entry .k-summary` 加三行多行省略：静态首页、主题页、分页与客户端重渲染共用；不截断原始摘要字符串，不影响详情页。短简介自然显示，不强制填满三行。

独立 IAB 真实快照在 519px 实测：首条 300 字简介由约 281.58px 降至 76.79px，版画仍为 240px；截图 `audit/summary-clamp-after.png` 可见末行省略号。进入第二条详情核对仍为 300 字、约 230.38px、overflow visible，无列表裁剪。`pnpm run build` 66 页通过；既有筛选、摘要揭幕、减弱动态和320px版面等专项在 Chromium/Firefox/WebKit 共 21/21 通过（35.9s）。未重跑完整矩阵或线上验收，未提交发布。

## 2026-10-19 极客公园 RSS 图片

用户要求极客公园有图时使用来源图片，并明确保留现有图片区域尺寸和比例。仅解析该来源 RSS 正文/description 中第一张符合准入规则的 `img src`，不请求原文补图。当前 30/30 条含图片，图片域名为 `imgslim.geekpark.net`；其余五个订阅当前样本未发现文章图片，中新网频道 logo 不作为文章配图。

可选 `imageUrl` 从归一化、items 三文件、公开快照、客户端数据岛传到静态列表、客户端筛选/分页与详情。图片修订增加内容版本与公开摘要版本，不改变稳定 ID 或首次收录时间；旧记录无此字段继续有效。仅极客公园及上述 HTTPS 图片域名准入，拒绝凭据、非标准端口和不受信来源/协议。上游 HTML 不插入页面，仅提取并转义 URL。

现有三层 media/tilt/art 结构与所有容器宽高规则保持，新增 img 绝对定位并以 `object-fit: cover` 填充：桌面列表 4:3、桌面详情 21:9、手机维持既有 clamp 高度。列表懒加载，详情立即加载；空 alt 延续原图层装饰语义。源图盖住版画，加载失败由客户端捕获 error 或已完成的缓存失败隐藏 img，露出原版画；缺图不创建 img。浏览器直接向来源图片域名发起请求，设置 `referrerpolicy="no-referrer"`，隐私页和来源页已同步说明；新增来源图片公开使用许可仍待核查，本次仅本地开发，未提交或发布。

完整 `pnpm test` 通过：check 0 error/0 warning、2 条既有弃用 hint；演示 build 66 页；Node 314/314；Chromium 188 passed +1 触屏专用 skipped（3.9m）。新增测试覆盖 HTML 图片提取/过滤、URL 策略、图片增删修订与身份/时间保持、JSON 持久化摘要校验。独立 IAB 真实 CDN 图片成功加载，桌面列表 264×198、详情 820×351.4，390px 手机详情约350.3×202.9，无横溢出；截图 `audit/geekpark-images-list.png` / `geekpark-image-mobile.png`。真实本地演练仍为214条，其中30条含图片。

更新后的真实快照生产构建250页通过。独立产物服务上的 Chromium/Firefox/WebKit 图片专项共12项分次验证通过：1440/390/320px图框与无图条目宽高相同、客户端筛选后分页图仍为4:3、静态/动态断链回退、无JS源图展示。专项用拦截响应提供确定性图片和网络失败；真实CDN可用性由上面的IAB实看另行验证。初轮9项通过、3项因测试误假定动态创建的分页栏也有 `data-pager` 而失败；DOM/源码证明实际分页存在，改用实际的「分页」导航定位后仅重跑这3项，全部通过（8.8s），产品代码无需调整。脚本、配置和日志在忽略目录 `.snapshot/`；未宣称一次完整矩阵全绿或新真机/FPS/线上证据。
