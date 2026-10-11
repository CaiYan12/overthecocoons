import test from "node:test";
import assert from "node:assert/strict";
import { pageWindow, pagerHtml } from "../../src/lib/pager.ts";

test("页码窗口在首尾/中间合并，省略号不替代单个缺页", () => {
  assert.deepEqual(pageWindow(20, 40), [1, 2, 3, "gap", 19, 20, 21, "gap", 38, 39, 40]);
  assert.deepEqual(pageWindow(1, 40), [1, 2, 3, "gap", 38, 39, 40]);
  assert.deepEqual(pageWindow(40, 40), [1, 2, 3, "gap", 38, 39, 40]);
  assert.deepEqual(pageWindow(5, 9), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("少量页完整显示，百万页仍是有界输出且包含当前页", () => {
  for (let total = 1; total <= 7; total++) {
    assert.deepEqual(pageWindow(1, total), Array.from({ length: total }, (_, i) => i + 1));
  }
  for (const [edges, radius] of [[3, 1], [1, 1], [1, 0]]) {
    for (const current of [1, 5, 500_000, 999_999, 1_000_000]) {
      const tokens = pageWindow(current, 1_000_000, edges, radius);
      const pages = tokens.filter((p): p is number => typeof p === "number");
      assert.ok(tokens.length <= 13);
      assert.ok(pages.includes(current) && pages.includes(1) && pages.includes(1_000_000));
      assert.equal(pages.length, new Set(pages).size);
    }
  }
});

test("静态与增强分页共享页码和转义链接；每页只有一个数字链接", () => {
  const html = pagerHtml(20, 40, (p) => `/overthecocoons/topics/news/page/${p}/?a="&b=<`);
  assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
  assert.ok(html.includes('&quot;&amp;b=&lt;'));
  assert.ok(html.includes('max="40"'));
  assert.ok(html.includes('data-page-jump hidden'));
  assert.equal(pagerHtml(20, 40, p => `/${p}`, true).includes('data-page-jump hidden'), false);
  assert.equal((html.match(/aria-label="第 20 页"/g) ?? []).length, 1);
});
