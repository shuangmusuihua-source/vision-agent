# HTML Slide Template

Base template for generating presentations. Customize with style presets from [STYLE_PRESETS.md](STYLE_PRESETS.md).

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{{TITLE}}</title>
  <style>
    /* ── Reset & Base ─────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      /* Colors — override per preset */
      --bg: #ffffff;
      --text: #1a1a1a;
      --accent: #0e153a;
      --accent-light: rgba(14, 21, 58, 0.08);
      --border: #e7e5e4;

      /* Typography */
      --font-cn: "PingFang SC", "Microsoft YaHei", sans-serif;
      --font-en: "Inter", system-ui, sans-serif;
      --title-size: clamp(1.5rem, 5vw, 4rem);
      --h2-size: clamp(1.25rem, 3.5vw, 2.5rem);
      --h3-size: clamp(1rem, 2.5vw, 1.75rem);
      --body-size: clamp(0.75rem, 1.5vw, 1.125rem);
      --small-size: clamp(0.65rem, 1vw, 0.875rem);

      /* Spacing */
      --slide-padding: clamp(1rem, 4vw, 4rem);
      --content-gap: clamp(0.5rem, 2vw, 2rem);
      --element-gap: clamp(0.25rem, 1vw, 1rem);
    }

    html, body {
      height: 100%;
      overflow: hidden;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-cn);
      -webkit-font-smoothing: antialiased;
    }

    html {
      scroll-snap-type: y mandatory;
      scroll-behavior: smooth;
    }

    /* ── Slide Container ──────────────────────── */
    .slide {
      width: 100vw;
      height: 100vh;
      height: 100dvh;
      overflow: hidden;
      scroll-snap-align: start;
      display: flex;
      flex-direction: column;
      position: relative;
      padding: var(--slide-padding);
    }

    .slide-content {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: center;
      max-height: 100%;
      overflow: hidden;
    }

    /* ── Slide Types ──────────────────────────── */

    /* Title slide */
    .slide-title {
      justify-content: center;
      align-items: center;
      text-align: center;
    }
    .slide-title h1 {
      font-size: var(--title-size);
      font-weight: 700;
      line-height: 1.2;
      margin-bottom: var(--element-gap);
    }
    .slide-title .subtitle {
      font-size: var(--h2-size);
      font-weight: 400;
      opacity: 0.7;
    }

    /* Content slide */
    .slide-content h2 {
      font-size: var(--h2-size);
      font-weight: 600;
      margin-bottom: var(--content-gap);
      color: var(--accent);
    }
    .slide-content ul {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: var(--element-gap);
    }
    .slide-content li {
      font-size: var(--body-size);
      line-height: 1.6;
      padding-left: 1.5em;
      position: relative;
    }
    .slide-content li::before {
      content: "●";
      position: absolute;
      left: 0;
      color: var(--accent);
      font-size: 0.6em;
      top: 0.5em;
    }

    /* Two-column layout */
    .two-columns {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--content-gap);
    }

    /* Feature grid */
    .feature-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: var(--content-gap);
    }
    .feature-card {
      background: var(--accent-light);
      border-radius: 12px;
      padding: var(--content-gap);
    }
    .feature-card h3 {
      font-size: var(--h3-size);
      margin-bottom: var(--element-gap);
    }
    .feature-card p {
      font-size: var(--small-size);
      opacity: 0.8;
      line-height: 1.5;
    }

    /* Quote slide */
    .slide-quote {
      justify-content: center;
      align-items: center;
      text-align: center;
    }
    .slide-quote blockquote {
      font-size: var(--h2-size);
      font-style: italic;
      line-height: 1.4;
      max-width: 80%;
    }
    .slide-quote cite {
      display: block;
      margin-top: var(--content-gap);
      font-size: var(--body-size);
      opacity: 0.6;
    }

    /* End slide */
    .slide-end {
      justify-content: center;
      align-items: center;
      text-align: center;
    }
    .slide-end h1 {
      font-size: var(--title-size);
      font-weight: 700;
    }

    /* ── Progress Bar ─────────────────────────── */
    .progress-bar {
      position: fixed;
      top: 0;
      left: 0;
      height: 3px;
      background: var(--accent);
      z-index: 100;
      transition: width 0.3s ease;
    }

    /* ── Slide Number ─────────────────────────── */
    .slide-number {
      position: absolute;
      bottom: var(--element-gap);
      right: var(--slide-padding);
      font-size: var(--small-size);
      opacity: 0.4;
    }

    /* ── Animations ───────────────────────────── */
    .slide .animate {
      opacity: 0;
      transform: translateY(20px);
      transition: opacity 0.6s ease, transform 0.6s ease;
    }
    .slide.active .animate {
      opacity: 1;
      transform: translateY(0);
    }
    .slide.active .animate:nth-child(2) { transition-delay: 0.1s; }
    .slide.active .animate:nth-child(3) { transition-delay: 0.2s; }
    .slide.active .animate:nth-child(4) { transition-delay: 0.3s; }
    .slide.active .animate:nth-child(5) { transition-delay: 0.4s; }

    /* ── Keyboard Hint ────────────────────────── */
    .keyboard-hint {
      position: fixed;
      bottom: var(--element-gap);
      left: 50%;
      transform: translateX(-50%);
      font-size: var(--small-size);
      opacity: 0.3;
      pointer-events: none;
      transition: opacity 0.5s;
    }

    /* ── Responsive ───────────────────────────── */
    @media (max-height: 700px) {
      :root {
        --slide-padding: clamp(0.75rem, 3vw, 2rem);
        --title-size: clamp(1.25rem, 4.5vw, 2.5rem);
      }
    }

    @media (max-width: 600px) {
      .two-columns { grid-template-columns: 1fr; }
      :root { --title-size: clamp(1.25rem, 7vw, 2.5rem); }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        transition-duration: 0.2s !important;
      }
    }
  </style>
</head>
<body>
  <div class="progress-bar" id="progress"></div>

  <!-- Slide 1: Title -->
  <section class="slide slide-title" data-slide="0">
    <h1 class="animate">{{TITLE}}</h1>
    <p class="subtitle animate">{{SUBTITLE}}</p>
    <div class="slide-number">1 / {{TOTAL}}</div>
  </section>

  <!-- Slide 2: Content -->
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

  <!-- Slide N: End -->
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

    // Init
    goTo(0);

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        goTo(current + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        goTo(current - 1);
      }
    });

    // Scroll snap fallback
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const index = parseInt(entry.target.dataset.slide);
          if (index !== current) goTo(index);
        }
      });
    }, { threshold: 0.5 });

    slides.forEach(slide => observer.observe(slide));

    // Hide keyboard hint after first interaction
    let hintTimeout;
    document.addEventListener('keydown', () => {
      const hint = document.querySelector('.keyboard-hint');
      if (hint) hint.style.opacity = '0';
      clearTimeout(hintTimeout);
    }, { once: true });
  </script>
</body>
</html>
```

## Slide Layout Types

| Type | Class | Description |
|------|-------|-------------|
| Title | `slide-title` | Centered heading + subtitle |
| Content | (default) | Heading + bullet points |
| Two-column | `.two-columns` | Side-by-side content |
| Feature grid | `.feature-grid` | Card grid layout |
| Quote | `slide-quote` | Centered blockquote |
| End | `slide-end` | Centered "Thank You" |

## Adding New Slides

1. Copy a `<section class="slide">` block
2. Update `data-slide` index
3. Update `slide-number` text
4. Add `class="animate"` to elements that should fade in
5. Update `{{TOTAL}}` in all slide numbers
