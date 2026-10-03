import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";

// GitHub Pages 子路径部署：所有页面与资源位于 /overthecocoons/ 前缀下。
export default defineConfig({
  site: "https://caiyan12.github.io",
  base: "/overthecocoons",
  output: "static",
  vite: {
    plugins: [tailwindcss()],
  },
});
