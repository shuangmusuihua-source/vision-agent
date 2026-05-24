export interface SkillDefinition {
  id: string
  name: string
  description: string
  icon: string
  promptTemplate: string
  systemPromptAppend?: string
}

const builtinSkills: SkillDefinition[] = [
  {
    id: 'prd-generator',
    name: 'PRD 生成器',
    description: '基于结构化 md 生成产品需求文档',
    icon: 'FileText',
    promptTemplate: `你是一个专业的产品经理。请阅读以下文件的内容，并基于它生成一份完整的产品需求文档（PRD）。

文件路径：{activeFile}

要求：
1. 按照标准 PRD 模板结构化输出：背景与目标、用户场景、功能需求、非功能需求、技术方案建议、里程碑规划
2. 如果原文信息不足，合理补充并标注"【待确认】"
3. 将 PRD 写入与原文件同目录下的 prd-生成.md 文件中
4. 输出完成后，告知用户文件路径`
  },
  {
    id: 'ppt-generator',
    name: 'PPT 生成器',
    description: '基于 md 生成 PPT 大纲',
    icon: 'PresentationChart',
    promptTemplate: `你是一个专业的演示文稿设计师。请阅读以下文件的内容，并基于它生成一份 PPT 大纲。

文件路径：{activeFile}

要求：
1. 按照 PPT 结构输出：标题页、目录页、内容页（每页有标题和要点）、总结页
2. 每页内容精炼，要点不超过 5 条
3. 总页数控制在 10-15 页
4. 将 PPT 大纲写入与原文件同目录下的 ppt-生成.md 文件中
5. 输出完成后，告知用户文件路径`
  },
  {
    id: 'summary',
    name: '内容摘要',
    description: '生成 md 的精简摘要',
    icon: 'Article',
    promptTemplate: `请阅读以下文件的内容，并生成一份精简摘要。

文件路径：{activeFile}

要求：
1. 提取核心观点和关键信息
2. 保留重要的数据和结论
3. 摘要长度为原文的 20%-30%
4. 将摘要写入与原文件同目录下的 摘要.md 文件中
5. 输出完成后，告知用户文件路径`
  },
  {
    id: 'slides',
    name: 'Slides',
    description: '创建精美的 HTML 演示文稿，支持动画和 PPTX 导出',
    icon: 'PresentationChart',
    promptTemplate: `你是一个专业的演示文稿设计师。请创建一份精美的 HTML 演示文稿。

用户需求：{activeFile}

要求：
1. 生成一个自包含的 HTML 文件，所有 CSS 和 JS 内联
2. 每页幻灯片适配一个视口，不允许内部滚动
3. 包含键盘导航（方向键、空格键）和进度指示器
4. 使用 CSS 动画实现入场效果
5. 支持 prefers-reduced-motion
6. 使用 skill-output 代码块输出 HTML，不要使用 Write 工具保存文件
7. 完成后告知用户可以下载文件`,
    systemPromptAppend: `# Slides Skill — 完整指令

## 工作流程

### Step 1: 确认需求
在生成幻灯片之前，确认：
1. 主题与目的
2. 受众
3. 页数（默认 6-10 页）
4. 风格（参考下方 Style Presets，默认 minimal）
5. 语言
6. 是否需要 PPTX 导出

### Step 2: 生成 HTML 演示文稿
创建自包含 HTML 文件：
- 所有 CSS 内联（无外部依赖）
- 平滑幻灯片切换和动画
- 响应式布局（16:9 比例）
- 键盘导航（方向键、空格键）
- 进度指示器
- 演讲者备注支持

关键规则：
- 使用 CSS 自定义属性进行主题化
- 每张幻灯片是 \`<section class="slide">\` 元素
- 动画使用 CSS \`@keyframes\`，不用 JS 动画库
- 图片：使用 SVG 内联或 CSS 渐变，不用外部 URL
- 中文：\`font-family: "PingFang SC", "Microsoft YaHei", sans-serif\`
- 英文：\`font-family: "Inter", system-ui, sans-serif\`

### Step 3: 输出 HTML
使用 skill-output 代码块输出完整 HTML：
\`\`\`skill-output
<!DOCTYPE html>
... (完整 HTML 内容)
\`\`\`

重要规则：
- 不要使用 Write 工具保存文件，只通过 skill-output 代码块输出
- HTML 必须自包含（所有 CSS/JS 内联）
- 代码块后加一句：演示文稿已生成，点击下载按钮保存到本地。

### Step 4: PPTX 导出（如需要）
先完成 Step 3 输出 HTML，然后可在后续轮次使用 Write/Bash 工具创建 PPTX 转换脚本。

## Style Presets

### 1. Minimal — 干净、白色、专业
\`\`\`css
:root {
  --bg: #ffffff;
  --text: #1a1a1a;
  --accent: #0e153a;
  --accent-light: rgba(14, 21, 58, 0.08);
  --border: #e7e5e4;
  --font-cn: "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-en: "Inter", system-ui, sans-serif;
}
\`\`\`
白色背景，深色文字，单一强调色，微妙淡入动画。

### 2. Dark — 深色、现代、电影感
\`\`\`css
:root {
  --bg: #1a1a2e;
  --text: #e5e5e5;
  --accent: #5b9cf5;
  --accent-light: rgba(91, 156, 245, 0.15);
  --border: #333333;
  --font-cn: "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-en: "Inter", system-ui, sans-serif;
}
\`\`\`
深色海军蓝背景，浅色文字，蓝色强调，标题幻灯片渐变叠加，平滑缩放+淡入动画。

### 3. Gradient — 多彩、活力、创意
\`\`\`css
:root {
  --bg: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --text: #ffffff;
  --accent: #ffd700;
  --accent-light: rgba(255, 215, 0, 0.2);
  --border: rgba(255, 255, 255, 0.2);
  --font-cn: "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-en: "Inter", system-ui, sans-serif;
}
\`\`\`
渐变背景，白色文字，金色强调，大胆动画，几何装饰元素。

### 4. Corporate — 专业、结构化、可信赖
\`\`\`css
:root {
  --bg: #f8f9fa;
  --text: #212529;
  --accent: #0056b3;
  --accent-light: rgba(0, 86, 179, 0.08);
  --border: #dee2e6;
  --font-cn: "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-en: "Inter", system-ui, sans-serif;
}
\`\`\`
浅灰背景，深色文字，蓝色强调，结构化网格布局，微妙滑入动画。

## HTML 模板

\`\`\`html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{TITLE}}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #ffffff;
      --text: #1a1a1a;
      --accent: #0e153a;
      --accent-light: rgba(14, 21, 58, 0.08);
      --border: #e7e5e4;
      --font-cn: "PingFang SC", "Microsoft YaHei", sans-serif;
      --font-en: "Inter", system-ui, sans-serif;
      --title-size: clamp(1.5rem, 5vw, 4rem);
      --h2-size: clamp(1.25rem, 3.5vw, 2.5rem);
      --h3-size: clamp(1rem, 2.5vw, 1.75rem);
      --body-size: clamp(0.75rem, 1.5vw, 1.125rem);
      --small-size: clamp(0.65rem, 1vw, 0.875rem);
      --slide-padding: clamp(1rem, 4vw, 4rem);
      --content-gap: clamp(0.5rem, 2vw, 2rem);
      --element-gap: clamp(0.25rem, 1vw, 1rem);
    }
    html, body { height: 100%; overflow: hidden; background: var(--bg); color: var(--text); font-family: var(--font-cn); -webkit-font-smoothing: antialiased; }
    html { scroll-snap-type: y mandatory; scroll-behavior: smooth; }
    .slide { width: 100vw; height: 100vh; height: 100dvh; overflow: hidden; scroll-snap-align: start; display: flex; flex-direction: column; position: relative; padding: var(--slide-padding); }
    .slide-content { flex: 1; display: flex; flex-direction: column; justify-content: center; max-height: 100%; overflow: hidden; }
    .slide-title { justify-content: center; align-items: center; text-align: center; }
    .slide-title h1 { font-size: var(--title-size); font-weight: 700; line-height: 1.2; margin-bottom: var(--element-gap); }
    .slide-title .subtitle { font-size: var(--h2-size); font-weight: 400; opacity: 0.7; }
    .slide-content h2 { font-size: var(--h2-size); font-weight: 600; margin-bottom: var(--content-gap); color: var(--accent); }
    .slide-content ul { list-style: none; display: flex; flex-direction: column; gap: var(--element-gap); }
    .slide-content li { font-size: var(--body-size); line-height: 1.6; padding-left: 1.5em; position: relative; }
    .slide-content li::before { content: "●"; position: absolute; left: 0; color: var(--accent); font-size: 0.6em; top: 0.5em; }
    .two-columns { display: grid; grid-template-columns: 1fr 1fr; gap: var(--content-gap); }
    .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: var(--content-gap); }
    .feature-card { background: var(--accent-light); border-radius: 12px; padding: var(--content-gap); }
    .feature-card h3 { font-size: var(--h3-size); margin-bottom: var(--element-gap); }
    .feature-card p { font-size: var(--small-size); opacity: 0.8; line-height: 1.5; }
    .slide-quote { justify-content: center; align-items: center; text-align: center; }
    .slide-quote blockquote { font-size: var(--h2-size); font-style: italic; line-height: 1.4; max-width: 80%; }
    .slide-quote cite { display: block; margin-top: var(--content-gap); font-size: var(--body-size); opacity: 0.6; }
    .slide-end { justify-content: center; align-items: center; text-align: center; }
    .slide-end h1 { font-size: var(--title-size); font-weight: 700; }
    .progress-bar { position: fixed; top: 0; left: 0; height: 3px; background: var(--accent); z-index: 100; transition: width 0.3s ease; }
    .slide-number { position: absolute; bottom: var(--element-gap); right: var(--slide-padding); font-size: var(--small-size); opacity: 0.4; }
    .slide .animate { opacity: 0; transform: translateY(20px); transition: opacity 0.6s ease, transform 0.6s ease; }
    .slide.active .animate { opacity: 1; transform: translateY(0); }
    .slide.active .animate:nth-child(2) { transition-delay: 0.1s; }
    .slide.active .animate:nth-child(3) { transition-delay: 0.2s; }
    .slide.active .animate:nth-child(4) { transition-delay: 0.3s; }
    .slide.active .animate:nth-child(5) { transition-delay: 0.4s; }
    .keyboard-hint { position: fixed; bottom: var(--element-gap); left: 50%; transform: translateX(-50%); font-size: var(--small-size); opacity: 0.3; pointer-events: none; transition: opacity 0.5s; }
    @media (max-height: 700px) { :root { --slide-padding: clamp(0.75rem, 3vw, 2rem); --title-size: clamp(1.25rem, 4.5vw, 2.5rem); } }
    @media (max-width: 600px) { .two-columns { grid-template-columns: 1fr; } :root { --title-size: clamp(1.25rem, 7vw, 2.5rem); } }
    @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.2s !important; } }
  </style>
</head>
<body>
  <div class="progress-bar" id="progress"></div>
  <section class="slide slide-title" data-slide="0">
    <h1 class="animate">{{TITLE}}</h1>
    <p class="subtitle animate">{{SUBTITLE}}</p>
    <div class="slide-number">1 / {{TOTAL}}</div>
  </section>
  <section class="slide" data-slide="1">
    <div class="slide-content">
      <h2 class="animate">{{HEADING}}</h2>
      <ul>
        <li class="animate">{{POINT_1}}</li>
        <li class="animate">{{POINT_2}}</li>
        <li class="animate">{{POINT_3}}</li>
      </ul>
    </div>
    <div class="slide-number">2 / {{TOTAL}}</div>
  </section>
  <section class="slide slide-end" data-slide="{{LAST_INDEX}}">
    <h1 class="animate">谢谢</h1>
    <div class="slide-number">{{TOTAL}} / {{TOTAL}}</div>
  </section>
  <div class="keyboard-hint">← → 翻页</div>
  <script>
    const slides = document.querySelectorAll('.slide');
    const progress = document.getElementById('progress');
    let current = 0;
    function goTo(index) {
      if (index < 0 || index >= slides.length) return;
      slides[current].classList.remove('active');
      current = index;
      slides[current].classList.add('active');
      slides[current].scrollIntoView({ behavior: 'smooth' });
      progress.style.width = ((current + 1) / slides.length * 100) + '%';
    }
    goTo(0);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); goTo(current + 1); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goTo(current - 1); }
    });
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => { if (entry.isIntersecting) { const index = parseInt(entry.target.dataset.slide); if (index !== current) goTo(index); } });
    }, { threshold: 0.5 });
    slides.forEach(slide => observer.observe(slide));
    document.addEventListener('keydown', () => { const hint = document.querySelector('.keyboard-hint'); if (hint) hint.style.opacity = '0'; }, { once: true });
  </script>
</body>
</html>
\`\`\`

## 幻灯片布局类型

| 类型 | Class | 描述 |
|------|-------|------|
| 标题 | \`slide-title\` | 居中标题 + 副标题 |
| 内容 | (默认) | 标题 + 要点 |
| 双栏 | \`.two-columns\` | 并排内容 |
| 特性网格 | \`.feature-grid\` | 卡片网格布局 |
| 引用 | \`slide-quote\` | 居中引用 |
| 结束 | \`slide-end\` | 居中"谢谢" |

## 内容密度限制

| 幻灯片类型 | 限制 |
|------------|------|
| 标题 | 1 标题 + 1 副标题 + 可选标语 |
| 内容 | 1 标题 + 4-6 要点或 2 短段落 |
| 特性网格 | 最多 6 张卡片 |
| 代码 | 最多 8-10 行 |
| 引用 | 1 引用 + 出处 |

## CSS 注意事项

不要直接写取反的 CSS 函数：
\`\`\`css
/* 错误 — 会被静默忽略 */
right: -clamp(28px, 3.5vw, 44px);
/* 正确 */
right: calc(-1 * clamp(28px, 3.5vw, 44px));
\`\`\`

## 提示
- 文字简洁 — 幻灯片是关键点，不是段落
- 视觉层次：大标题、中副标题、小正文
- 每页不超过 3-5 个要点
- 统一间距和对齐
- 添加幻灯片编号
- 包含最后的"谢谢"或"Q&A"页`
  }
]

export function getBuiltinSkills(): SkillDefinition[] {
  return builtinSkills
}

export function getSkillById(id: string): SkillDefinition | undefined {
  return builtinSkills.find((s) => s.id === id)
}
