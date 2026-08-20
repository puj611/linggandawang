# Checklist

- [x] src 全库 grep 无 `backdrop-blur` / `backdrop-filter` 残留（OnboardingOverlay 已去毛玻璃）
- [x] tokens.css 与 tailwind.config.ts 的 window/popover 阴影值一致，且均不含 `0 0 0 1px` 描边环
- [x] 浮层（Ball 菜单、模式下拉、设置、项目面板、扫描面板、隐私弹窗、跳过确认、引导卡片）边框为 border-light（0.10）
- [x] 弹层（Ball 菜单、模式下拉、灵感菜单、引导卡片）带 animate-pop-in 入场动画
- [x] 分段控件（场景/模式）选中态为 bg-surface-3，比容器 bg-surface-2 更亮
- [x] 截图拖入区、图片拆解按钮、参考图上传区均为实线边框，无 dashed 残留（grep 确认）
- [x] 用户可见文本无 9/10/11px 字号（grep `text-\[(9|10|11)px\]` 确认）
- [x] 全局 button 与热路径组件不再使用 `transition: all` / `transition-all`（grep 确认）
- [x] `tsc -b && vite build` 构建通过，dist 已重建
- [x] 浏览器验证：面板/浮层边缘清晰、无双重灰边、无毛玻璃、文字清晰、动画流畅、console 无 CSS 错误
- [x] 桌面端 release exe 重新编译并启动验证新样式生效