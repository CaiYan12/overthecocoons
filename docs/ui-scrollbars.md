# 自绘覆盖式纵向滚动条

2026-10-11 用户要求 MENU 覆盖整个视口，并建议使用完全自绘的滚动条解决占位冲突。本方案取代上一轮根元素 `scrollbar-gutter: stable` 的长期占位方案。

## 最终行为

- 页面与 MENU 共用 `KScrollbar.astro`，3px可见滑块、14px操作轨道，覆盖在内容右侧，不参与水平排版。不改变浏览器原生页面／菜单内容滚动容器，GSAP与目录仍读取原来的滚动位置。
- 页面滚动条从nav底边下方6px开始，层级低于nav；共用导航高度token，桌面68px、手机60px，轨道顶部相应为74px／66px。MENU内部滚动条仍从面板顶部6px开始，不受外部nav影响。
- 页面用主题 accent 滑块，MENU 用倒置配色 paper 滑块，提高菜单背景上的可读性；悬停／拖拽由3px平滑扩到6px，使用160ms ease-out横向scale，原宽固定6px，不对width做布局动画，且不覆盖JS控制的纵向translate。没有内容溢出时隐藏控件；原生 dialog 展开后页面控件隐藏，菜单控件在 dialog 面板内。
- 支持拖拽、轨道点选翻页、控件上的滚轮、ArrowUp/Down、PageUp/Down、Home/End。键盘事件保留传播，既有用户输入采样仍能识别滚动键。普通滚轮与触摸沿用原生行为，不安装平滑滚动库，不增加持久化数据。
- 可访问角色为 scrollbar，包含标签、vertical、aria-controls、0–100值域与当前百分比；控件可聚焦并有焦点轮廓。页面控制 html#k-page-scroll；菜单控制 #k-menu-scroll。
- thumb长度为轨道高度×可视高度／内容高度（最短32px），位移为可滚动比例×轨道剩余行程。scroll/resize合并到一帧更新；ResizeObserver追踪内容变化，主题／分页重排后重新测量。拖拽捕获pointer并在松开、取消、失去捕获、modal切换、pagehide时释放。
- 自定义光标监听pointermove，避免取消pointerdown默认行为后依赖兼容mousemove造成拖拽冻结。拖拽时点、圆环及标签即时采用真实指针坐标，并保持轻量可点击档；松开后恢复普通跟随与命中语义。触摸不启用该光标。

## 首绘与降级

head在PointerEvent与scrollbar-width:none可用时设置pending，CSS仅在pending/ready时隐藏原生纵向滚动条并使用auto gutter。模块成功后ready与自绘控件接管；模块被阻止／迟到时1500ms移除pending并恢复该浏览器的原生基线。无JS时不设置标记，控件保持hidden，原生滚动不受影响。

原生横向表格滚动条不在此轮范围；左右侧栏依然自然撑开页脚，无内部滚动。MENU保持280ms下拉覆盖／原路上收及退出后导航。全部动画门控裁定不变。

## 本地证据

- `tests/e2e/menu-layout.spec.ts`：独立Chromium保留原生滚动条绘制。增强页面槽位0，首页／关于页各3次开合，主内容／固定页头几何不变，MENU四角均由dialog覆盖；同浏览器无JS页面的槽位>0，证明没有把默认隐藏条当作真实占宽验证。
- `tests/e2e/scrollbars.spec.ts`：页面键盘、轨道、桌面拖拽、resize与进度；短屏MENU四角／390×500完整矩形、菜单桌面拖拽与滚轮／键盘到末主题、背景锁；模块失效及无JS降级。
- 最终与MENU动效专项联合五配置56通过、4项桌面专用适用性跳过（2.2m）；check94文件0错误/0警告（2条旧hint），build66页；Node301项通过。没有全量重跑所有e2e，没有真机／线上／FPS结论。
- 独立Chrome桌面1440×900和390×500截图已查看，菜单无右侧空白槽；控制台0错误。图片保留在用户Temp，`otc-scrollbar-page.png`、`otc-scrollbar-menu.png`、`otc-scrollbar-menu-mobile-final.png`、`otc-scrollbar-menu-bottom-final.png`。
- 初轮55通过/1失败/4跳过。Firefox本测试配置的失败模块页面与无JS原生页面都返回scrollbarWidth none；匹配作者规则仍为auto。按该浏览器原生基线比较后通过，并保留独立Chromium的非零槽位原生验证；不把这一环境结果误报为产品降级故障。

同日后续悬停／拖拽反馈修复：修改前悬停0中间帧，捕获拖拽光标与实际点偏差40.63px；修改后页面和MENU均验证悬停中间帧、3个捕获移动点在下一绘制帧内误差<1px。与既有光标跟随、离开／失焦、换页静止接管、滚动条交互／降级联合五配置30通过、10项手机不适用桌面悬停／自定义光标用例跳过（55.3s）；check94文件与build66页通过。此次未重跑Node和全部MENU动效。

nav下方定位后：新增1440/390宽度的nav底边间距与End进度验证，修复前间距-62px，修复后均6px。最终滚动条专项五配置26通过、4项手机不适用hover／自定义光标跳过（41.9s），check94文件及build66页通过。hover取帧从真实pointerenter开始，避免自动化动作等待先消耗固定采样窗口；生产动画不变。

实现：`src/client/scrollbars.ts`、`src/components/KScrollbar.astro`、KSite/KMenu/BaseLayout及kinetic.css。未提交、推送或部署。

API核查：[CSS scrollbar-width](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/scrollbar-width)、[Pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture)、[WAI-ARIA scrollbar](https://www.w3.org/TR/wai-aria-1.2/#scrollbar)。
