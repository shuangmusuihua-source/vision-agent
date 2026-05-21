---
name: slides
description: Create beautiful HTML presentations with smooth animations, exportable to PPTX
version: 1.0.0
---

# Slides Skill — Vision Agent

Create stunning HTML presentations that can be previewed in the browser and exported to PPTX.

## When to Use

- User asks to create a presentation, slides, or PPT
- User wants to present ideas, proposals, reports, or pitches in slide format
- User says "做个PPT", "创建演示文稿", "make slides", "create presentation"

## Workflow

### Step 1: Clarify Requirements

Before generating slides, confirm with the user:

1. **Topic & purpose** — What is the presentation about?
2. **Audience** — Who will view it?
3. **Page count** — How many slides? (default: 6-10)
4. **Style** — Refer to [STYLE_PRESETS.md](STYLE_PRESETS.md) for options (default: `minimal`)
5. **Language** — Chinese or English? (default: follow user's language)
6. **Export** — Need PPTX export? (default: yes)

### Step 2: Generate HTML Presentation

Create a single self-contained HTML file with:

- All CSS inline (no external dependencies)
- Smooth slide transitions and animations
- Responsive layout (16:9 aspect ratio)
- Keyboard navigation (arrow keys, space)
- Progress indicator
- Speaker notes support

**Template reference**: See [TEMPLATES.md](TEMPLATES.md) for the base HTML structure.

**Key rules**:
- Use CSS custom properties for theming (easy to restyle)
- Each slide is a `<section class="slide">` element
- Animations use CSS `@keyframes` — no JS animation libraries
- Images: use SVG inline or CSS gradients, never external URLs
- Chinese text: use `font-family: "PingFang SC", "Microsoft YaHei", sans-serif`
- English text: use `font-family: "Inter", system-ui, sans-serif`

### Step 3: Output HTML

Output the complete HTML presentation as a single fenced code block with the language tag `skill-output`:

```skill-output
<!DOCTYPE html>
... (complete HTML content)
```

**Important rules**:
- Do NOT use the Write tool to save the file. Only output the HTML via text message.
- Use `skill-output` as the fenced code block language tag so the app can detect and display it.
- The HTML must be self-contained (all CSS/JS inline).
- After the code block, add a short sentence: "演示文稿已生成，点击下载按钮保存到本地。"

### Step 4: PPTX Export (if requested)

If the user needs PPTX export, first complete Step 3 to output the HTML. Then in a follow-up turn, you may use Write/Bash tools to create and run a PPTX conversion script.

**PPTX mapping rules**:
- `title-slide` layout → PPTX title slide
- `content-slide` layout → PPTX title + content
- `two-column` layout → PPTX two-column text
- `image-slide` layout → PPTX picture with caption
- `end-slide` layout → PPTX blank with centered text

## Style Presets

See [STYLE_PRESETS.md](STYLE_PRESETS.md) for available presets:
- `minimal` — Clean, white background, minimal decoration
- `dark` — Dark background, light text, gradient accents
- `gradient` — Colorful gradient backgrounds
- `corporate` — Professional, blue tones, structured layout

## Tips

- Keep text concise — slides are for key points, not paragraphs
- Use visual hierarchy: large titles, medium subtitles, small body
- Limit to 3-5 bullet points per slide
- Use consistent spacing and alignment
- Add slide numbers for reference
- Include a final "Thank You" or "Q&A" slide
