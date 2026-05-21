# Style Presets

## Viewport Fit — Mandatory

Every slide must fit one viewport. No internal scrolling.

```css
html, body {
  height: 100%;
  overflow: hidden;
}

html {
  scroll-snap-type: y mandatory;
  scroll-behavior: smooth;
}

.slide {
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  overflow: hidden;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  position: relative;
}

.slide-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  max-height: 100%;
  overflow: hidden;
  padding: var(--slide-padding);
}
```

## Typography Scale

```css
:root {
  --title-size: clamp(1.5rem, 5vw, 4rem);
  --h2-size: clamp(1.25rem, 3.5vw, 2.5rem);
  --h3-size: clamp(1rem, 2.5vw, 1.75rem);
  --body-size: clamp(0.75rem, 1.5vw, 1.125rem);
  --small-size: clamp(0.65rem, 1vw, 0.875rem);
  --slide-padding: clamp(1rem, 4vw, 4rem);
  --content-gap: clamp(0.5rem, 2vw, 2rem);
  --element-gap: clamp(0.25rem, 1vw, 1rem);
}
```

## Presets

### 1. Minimal

Clean, white, professional. Best for: reports, documentation, technical talks.

```css
:root {
  --bg: #ffffff;
  --text: #1a1a1a;
  --accent: #0e153a;
  --accent-light: rgba(14, 21, 58, 0.08);
  --border: #e7e5e4;
  --font-cn: "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-en: "Inter", system-ui, sans-serif;
}
```

- White background, dark text
- Single accent color for highlights
- Minimal decoration, strong typography hierarchy
- Subtle fade-in animations

### 2. Dark

Dark, modern, cinematic. Best for: product launches, tech talks, demos.

```css
:root {
  --bg: #1a1a2e;
  --text: #e5e5e5;
  --accent: #5b9cf5;
  --accent-light: rgba(91, 156, 245, 0.15);
  --border: #333333;
  --font-cn: "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-en: "Inter", system-ui, sans-serif;
}
```

- Dark navy background, light text
- Blue accent for emphasis
- Gradient overlays on title slides
- Smooth scale + fade animations

### 3. Gradient

Colorful, energetic, creative. Best for: pitches, creative work, brand presentations.

```css
:root {
  --bg: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  --text: #ffffff;
  --accent: #ffd700;
  --accent-light: rgba(255, 215, 0, 0.2);
  --border: rgba(255, 255, 255, 0.2);
  --font-cn: "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-en: "Inter", system-ui, sans-serif;
}
```

- Gradient backgrounds (different per slide)
- White text, gold accent
- Bold, playful animations
- Geometric decorative elements

### 4. Corporate

Professional, structured, trustworthy. Best for: business reports, strategy, finance.

```css
:root {
  --bg: #f8f9fa;
  --text: #212529;
  --accent: #0056b3;
  --accent-light: rgba(0, 86, 179, 0.08);
  --border: #dee2e6;
  --font-cn: "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-en: "Inter", system-ui, sans-serif;
}
```

- Light gray background, dark text
- Blue accent (trustworthy)
- Structured grid layouts
- Subtle slide-in animations

## Content Density Limits

| Slide type | Limit |
|------------|-------|
| Title | 1 heading + 1 subtitle + optional tagline |
| Content | 1 heading + 4-6 bullets or 2 short paragraphs |
| Feature grid | 6 cards max |
| Code | 8-10 lines max |
| Quote | 1 quote + attribution |
| Image | 1 image constrained by viewport |

## Responsive Breakpoints

```css
@media (max-height: 700px) {
  :root {
    --slide-padding: clamp(0.75rem, 3vw, 2rem);
    --title-size: clamp(1.25rem, 4.5vw, 2.5rem);
  }
}

@media (max-height: 600px) {
  :root {
    --slide-padding: clamp(0.5rem, 2.5vw, 1.5rem);
    --title-size: clamp(1.1rem, 4vw, 2rem);
  }
}

@media (max-width: 600px) {
  :root { --title-size: clamp(1.25rem, 7vw, 2.5rem); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.2s !important;
  }
}
```

## CSS Gotchas

Never write negated CSS functions directly:
```css
/* WRONG — silently ignored */
right: -clamp(28px, 3.5vw, 44px);

/* CORRECT */
right: calc(-1 * clamp(28px, 3.5vw, 44px));
```
