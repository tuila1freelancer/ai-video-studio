# QUALITY BAR — @TuiLa1Freelancer Channel

> Image & content quality standard for AI Video Studio, synthesized from 4 independent analyses of 4 videos from the channel (two 23-minute videos, one 17-minute video, one 15-minute video). A rule is only added to the checklist when it appears consistently across ≥3/4 videos; a rule seen in only 1–2 videos is marked **(optional)**.

---

## 1. Visual Signature

The channel has a **"dark cyber HUD on a navy cosmic background"** style: the entire video plays out over a near-black deep-navy background (#0A0E1A ± tint), never a bright background scene. Each scene is a minimalist "system screen" with **exactly 1 focal element** — a giant glowing neon UPPERCASE keyword, an oversized hero number, or a line-art diagram — surrounded by wide negative space (≥50–60% of the frame) that is always "alive" thanks to drifting particles, slowly breathing glow blobs, a faint perspective grid, and a light scanline. Text is strictly split into 3 tiers: a small wide-tracked monospace kicker (prefixed with `//`, `[ ]`, `01 /`) → a giant extrabold sans heading (1 accent-colored emphasis word mid-line) → a gray subtext of 1–2 lines. Color carries **fixed semantics** (cyan = AI/neutral, pink = risk/warning, green = correct/success, yellow = money/goal, red = critical error). Faded English SNAKE_CASE HUD text scattered in the corners, a thin bar hugging the bottom edge, an always-on channel watermark — together creating the sense that the viewer is looking at the interface of a running AI system, while a warm Southern Vietnamese voice addressing the audience as "mình – các bạn" speaks fast at ~270 syllables/minute.

---

## 2. Concrete SPEC

### 2.1 Palette (hard-locked across the whole video)

| Role | Color | Standard hex (accepted range) | Semantics |
|---|---|---|---|
| Main background | Deep-navy | `#0A0E1A` → `#131A33` (vignette toward `#070812`) | Every scene; no white background |
| Secondary background (nebula/tint) | Faint purple/pink/teal | opacity 15–20% radial | Keeps the background from looking flat |
| Primary accent (~50–60%) | Cyan | `#22D3EE`–`#38C8F5` | AI / solution / neutral / heading |
| Accent 2 | Magenta/pink | `#FF2E88`–`#EC4899` | Risk / emotion / mild warning / Subscribe button |
| Accent 3 | Purple | `#7B5CFF`–`#8B5CF6` | Support / gradient / branding / avatar |
| Accent 4 | Neon green | `#22C55E`–`#34E87B` | ONLY for correct / achieved / ✓ / success / profit |
| Accent 5 | Amber/gold yellow | `#FBBF24`–`#FFC43D` | Money / goal / value (use sparingly) |
| Heavy warning | Red | `#EF4444`–`#FF3B4E` | ONLY for critical error/risk scenes; the whole scene shifts to a red tone |
| Primary text | Cool white | `#EAEAF5`–`#F5F7FF` | Heading |
| Subtext | Blue-gray | `#8B93B0`–`#B8BCD0` | Body/description |
| Card | Lighter navy | `#151A30`, 1px faint accent border | Grid card, panel |

**Rule:** numbered lists cycle colors in sequence (01 cyan → 02 pink/purple → 03 green). The background tint is allowed to change temporarily per chapter (red for error chapters, warm for money chapters) then return to navy.

### 2.2 Typography

| Tier | Font | Size | Rule |
|---|---|---|---|
| T1 Hero heading | Geometric sans ExtraBold/Black (Montserrat / Be Vietnam Pro) | 90–160px (single hero word/number: up to 250–400px) | ALWAYS UPPERCASE, max 2 lines; 1 word/line accent-colored emphasis; neon outer-glow blur 15–25px in the same hue; no serif |
| T2 Kicker/HUD | Monospace (JetBrains Mono / Space Mono) | 14–24px | UPPERCASE, letter-spacing ≥0.2em; prefix `//`, `[ ]`, `01 /`, `SYS_`, `PROMPT N`; placed right above the heading |
| T3 Subtext/body | Regular sans | 18–32px | ≤2–3 short lines, gray; keywords bolded + accent-colored |
| Hero number | Bold display digits | 150–400px | Cyan (or chapter accent) + glow; can be a faded 8–12% ghost number sitting behind the content |

**Text effects:** faint scanline over large headings; glitch/RGB-split ONLY for error scenes; gradient fill (cyan→purple, orange→yellow) and metallic/chrome for hero words **(optional)**. On-screen text is always a **2–6 word keyword pulled from the dialogue**, never a full sentence. Vietnamese diacritics render 100% at every size/weight/font (test Ắ Ậ Ữ Ỡ Ề Ệ).

### 2.3 Ambient (mandatory in every scene)

- Star dust/particles drifting slowly across the background
- ≥1 slowly "breathing" glow blob/nebula in a corner
- A faint perspective grid or a bright bezier line running through the background (per scene)
- Very light film grain/CRT scanline over the whole frame
- Decorative HUD: `[ ]` brackets in the frame corners, a spinning dashed circle, an orbit/radar line

### 2.4 Layout patterns (7 unified templates)

| # | Template | Description |
|---|---|---|
| L1 | **Hero-center** | 1 giant word/number in the center + kicker above + mono label below (~40% of scenes) |
| L2 | **Text-left – image-right** | Kicker + heading + body left-aligned (~40%) + prop/icon/diagram/avatar on the right (or reversed) |
| L3 | **Numbered vertical list** | 3–5 items 01–05, cycling color numbers, vertical connector dot/line |
| L4 | **A\|B comparison** | 2 symmetric cards/panels joined by a center line; pass = green ✓ border, fail = pink ✗ border |
| L5 | **2–4 column card grid** | `#151A30` cards with a 1px accent border, each card = number + icon + keyword |
| L6 | **Horizontal timeline/stepper** | 5–7 nodes, active node glowing, mono label below |
| L7 | **Radial hub-spoke** | Central core icon + 4–8 satellites connected by neon wires |

Each scene has **exactly 1 focal element**, negative space ≥50%, with the bottom of the frame left empty (~120px if subtitles are present).

### 2.5 Motion language

- **Entrance:** heading fade + slide ~20px or scale-in with a glow burst that then settles; list items stagger in sequence; numbers count up via counter; line-art icons draw on via stroke; typewriter for terminals
- **Scene pacing:** average 6–12s/scene, no scene stays static >15s without a new build/motion
- **Density:** 1 main animation + 2–3 small ambient effects simultaneously; never >2 large moving elements at once; camera static or slow push-in
- **Transitions:** fast cuts, a bright flash <0.5s or a glow wipe
- **Signature FX:** a thin 3–6px bar hugging the bottom edge; voice-driven equalizer **(optional)**; diagonal light-sweep, red laser scan in risk chapters

### 2.6 Branding

- **Watermark:** the "TIF AI + tuila1 freelancer" logo (round purple-cyan gradient icon + wordmark), ~140px wide, visible 100% of the runtime, opacity ~80%, never overlapped (position: see the Conflicts section)
- **English HUD text** in SNAKE_CASE (`SYSTEM: ACTIVE`, `STATUS_ERROR`, `TARGET_LOCKED`, `AGENT_STATE 100%`) in ≥50% of scenes, size <24px, opacity 30–50%, placed in a corner, not competing with the focal element
- **3D host avatar** (black hoodie with purple-cyan neon trim): appears in ~15–35% of scenes, full-body, standing in the left or right third, ~1/3 of the frame height, never covering text; with context-appropriate props **(optional)**
- **Intro:** NO logo intro — cold-open straight into the hook from second 0; channel greeting at ~second 50–57
- **Outro:** subscribe CTA (pink pill button or YouTube-style 3D red button) + avatar + neon "CẢM ƠN / HẸN GẶP LẠI" card

---

## 3. Scene Taxonomy

| Scene type | Layout | When to use |
|---|---|---|
| **S1. Hook/Pain** | White+pink heading left-aligned or center icon + a giant faded word behind; pink warning prop (X, triangle, ? mark) | First 0–60s, hitting the audience's pain point |
| **S2. Promise/Number hero** | Giant cyan glowing number in the center + spinning HUD ring + benefit badges floating around | Right after the pain: promising value with a concrete number |
| **S3. Chapter title** | Mono kicker (`// SECTION`, `PHẦN 05`, `PROMPT 3`) + 2-color left-aligned heading + prop/ghost number on the right | Opening each chapter/step, short 4–6s |
| **S4. Hero keyword punch** | 1–2 giant words filling the screen, glow/gradient/italic | Emphasizing a high-value keyword in the dialogue |
| **S5. Numbered vertical list** | 3–5 items 01–05 with cycling colors + connector, avatar on the right (~50%) | Listing steps/mistakes/criteria |
| **S6. A vs B comparison** | 2 symmetric cards/panels, VS chip in the middle; or a diagonal split with a light streak; pass ✓ green vs fail ✗ pink | Comparing 2 options, before/after, good sample/bad sample |
| **S7. Horizontal card grid** | 2–4 equal frosted-glass cards, number + icon + keyword | Checklist, parallel processes, comparing multiple milestones |
| **S8. Timeline/stepper** | Horizontal progress dots with 5–7 nodes, active node glowing | Roadmap (7-day plan, 5-step process), recap |
| **S9. Diagram/data** | Radar, pyramid, bar/pie, curve, hub-spoke, branching mindmap — each diagram in its own scene | Visualizing a concept/statistic |
| **S10. Terminal/prompt** | Neon-bordered code window, mono typed via typewriter + blinking cursor, traffic-light dots | Any time discussing an AI prompt/command |
| **S11. Warning/Error** | Whole scene shifts to a red tone, glitch text, red mono banner, laser scan, red shield/triangle | Serious mistakes, risks, errors |
| **S12. Icon/prop hero** | 1 self-drawn neon line-art icon or a glossy 3D prop in the center + mono label | Metaphors (scale, shield, key, hourglass) |
| **S13. Avatar spotlight** | 3D character standing at the edge/inside a dashed circle + heading opposite | Personal advice, host's examples |
| **S14. Mid-video CTA** | Pink SUBSCRIBE pill button + bell + avatar + cyan like icon | ~50% of the video runtime |
| **S15. Outro** | 2 cards "CẢM ƠN" → "HẸN GẶP LẠI" neon + subscribe button + a comment-baiting question | Final 60–90s |

---

## 4. QUALITY BAR CHECKLIST

### A. Visual (background – color – layout)

- ☐ A1. Every scene's background is deep-navy within the range `#05080F`–`#141A33`; 0 white/bright background scenes (only a transition flash <0.5s is allowed).
- ☐ A2. The whole video uses only the hard-locked accent system: cyan, magenta/pink, purple, green, amber yellow (+ red reserved for errors); no color outside the system appears.
- ☐ A3. Color semantics are invariant: green ONLY for correct/achieved/✓; pink for mistake/warning/✗; red ONLY for critical error/risk; yellow for money/goal; cyan for AI/neutral.
- ☐ A4. Each scene has exactly 1 main focal element; no 2 competing adjacent headings in the same frame.
- ☐ A5. Negative space ≥50% of the frame area in every scene.
- ☐ A6. Warning/error scenes shift the whole scene tone to the red/pink family, then return to navy in the very next scene.
- ☐ A7. Numbered lists use 2-digit numbers (01/02/03…) cycling colors in the sequence cyan → pink/purple → green.
- ☐ A8. Illustration icons are self-drawn neon line-art (stroke draw-on) or neon 3D in the same palette; no stock photos/system emoji.

### B. Motion

- ☐ B1. Ambient is alive in 100% of scenes: drifting particles + ≥1 slowly breathing glow + light grain/scanline.
- ☐ B2. Each scene has exactly 1 main animation (fade+slide / scale-in+glow / draw-on / typewriter / counter) + at most 2–3 small ambient effects; never >2 large moving elements simultaneously.
- ☐ B3. Average scene duration 6–12s; no scene stays static >15s without a new build/motion.
- ☐ B4. Camera static or slow push-in; no hard zoom/pan.
- ☐ B5. A thin 3–6px bar running along the bottom edge of the screen appears in ≥90% of scenes (cyan→magenta gradient or progress by chapter accent — see Conflict M3).
- ☐ B6. Glitch/RGB-split only appears in error/warning scenes, not used as arbitrary decoration.

### C. Typography

- ☐ C1. Headings are always UPPERCASE geometric sans ExtraBold 90–160px (single hero up to 400px), with neon glow; absolutely no serif.
- ☐ C2. The 3-tier structure is mandatory: mono kicker UPPERCASE 14–24px letter-spacing ≥0.2em (prefix `//`, `[ ]`, `01 /`) → large heading → subtext ≤2–3 gray lines.
- ☐ C3. Each heading has exactly 1 accent-colored word/phrase or a second line; do not accent more than 1 position/heading.
- ☐ C4. On-screen text is a 2–6 word keyword pulled from the dialogue; never display a full spoken sentence on the canvas.
- ☐ C5. Vietnamese diacritics render 100% correctly at every size/weight/font including mono uppercase and 160px+ headings (test: Ắ Ậ Ữ Ỡ Ề Ệ Ấ Đ).
- ☐ C6. English mono SNAKE_CASE HUD text (`SYSTEM:`, `STATUS_`, `DATA_`) in ≥50% of scenes, size <24px, opacity 30–50%, placed in a corner, not overlapping the focal element.
- ☐ C7. Code/terminal windows are always typed via typewriter with a blinking cursor; macOS 3-dot chrome + syntax highlighting ≥3 colors **(optional — only clearly seen in 1 video)**.

### D. Script

- ☐ D1. Cold-open straight into the hook from second 0, no logo intro; the pain→promise hook is wrapped up in the first 35–60s.
- ☐ D2. The promise states concrete value (a number, a framework) before minute 1:30; a short ~10s channel greeting inserted after the hook.
- ☐ D3. Content divided into clearly numbered chapters/steps; the number spoken aloud ("second step", "fourth mistake") matches 100% the number shown on-screen.
- ☐ D4. A mid-video CTA at ~50% of the runtime (save/subscribe/comment) and a final CTA in the 60–90s before the end (like + comment bait + subscribe).
- ☐ D5. A specific comment-baiting question at the outro (promising to use the comments as content for a future video).
- ☐ D6. Fixed address terms "mình – bạn/các bạn" throughout the video (see Conflict M5), warm mentor tone, short sentences, lots of numbered lists.
- ☐ D7. Standard outro: subscribe CTA + "CẢM ƠN" → "HẸN GẶP LẠI" cards; no long blank endcard.

### E. Voice & Subtitles

- ☐ E1. Voice-over speed 260–280 syllables/minute, steady, almost no long pauses.
- ☐ E2. The burned-in subtitle decision must be consistent across the whole video: either NONE (information conveyed via on-screen keywords), or karaoke chunks of 2–6 words at the bottom center (~92% of the height), bold sans ~44–52px in a single uniform color with a dark outline, switching chunks every 1–2s (see Conflict M1).
- ☐ E3. If subtitles are present: leave a bottom safe zone ~120px, no scene element intrudes into it; Vietnamese diacritics in the subtitles are 100% correct.

### F. Technical & Branding

- ☐ F1. The channel logo watermark is visible 100% of the runtime, ~140px wide, opacity ~80%, not overlapped by any element (position: see Conflict M2).
- ☐ F2. A ~15–23 minute video has ~100–140 distinct scenes (density ≥5–6 scenes/minute).
- ☐ F3. The 3D host avatar appears periodically (at least once every 8–10 scenes), standing in the left/right third, not covering the focal element/text.
- ☐ F4. Text/background contrast is always very high (white/neon text on a near-black background, target ≥7:1).
- ☐ F5. No pastel tones, no soft drop-shadow of the bright-UI kind — all depth is created with glow/neon borders.

---

## 5. Conflicts between the 4 analyses — REQUIRES A HUMAN DECISION

| # | Issue | What the analyses say | Suggested handling |
|---|---|---|---|
| **M1** | **Burned-in subtitles** | Videos 1 & 2 (23'): NO bottom subtitles (only YouTube auto-captions). Video 3 (17'): HAS karaoke chunks in **cyan #38BDF8**. Video 4 (15'): HAS karaoke chunks in **gold yellow #FFC43D**. | The channel is changing style. Pick 1 standard for the app: recommended to make it a **toggle on/off**, defaulting to the most recent video (with subtitles); if on, must pick 1 fixed color (cyan or gold?). |
| **M2** | **Watermark position** | Videos 1, 2, 4: **TOP-RIGHT** corner. Video 3: **BOTTOM-RIGHT** corner. | Pick top-right (3/4 videos); and if bottom subtitles are on, top-right also avoids conflict better. |
| **M3** | **Bottom-edge bar** | Video 1: a **static decorative cyan→magenta gradient** line. Videos 3 & 4: a **progress bar running left→right, changing color by chapter accent**. Video 2: not clearly mentioned. | Decide: a static decorative bar or a real progress bar tracking chapter progress? (A progress bar is more useful for retention.) |
| **M4** | **Cut pacing** | Videos 1 & 2 (23'): average 8–14s/scene. Videos 3 & 4 (15–17'): 5–10s/scene, noticeably faster. | May be a function of video length — shorter videos cut faster. Consider a rule based on duration rather than 1 hard number. |
| **M5** | **Address terms** | Videos 1, 2, 4: "mình – các bạn". Video 3: "tui" ("TUI là 1 Freelancer"). | Pick "mình" as the default (3/4); use "tui" only for wordplay on the channel name. |
| **M6** | **Number of accents per scene** | Analysis 3: each scene locks exactly **1 accent color**, no mixing ≥3. Analyses 1 & 2: lists/cards within a scene use **3 cycling colors** (01 cyan/02 pink/03 green). | Possible reconciliation: hero/keyword scenes lock 1 accent; only list/grid scenes are allowed to cycle color by number. Needs confirmation. |
| **M7** | **Bright "polarity-flip" background scenes** | Analyses 1, 2, 3: absolutely no bright background. Analysis 4: allows 2–3 punch scenes with a yellow/cream background, <5% of the runtime. | Decide whether to allow bright "punch scenes" as an accent or forbid them entirely. |
| **M8** | **Icon/prop style** | Video 1: pure neon line-art stroke draw-on. Videos 2–4: added **3D glossy/gradient glassy** icons (key, trophy, pyramid). | The channel is evolving toward 3D. Pick 1 of the 2, or allow both but don't mix within a single scene. |
| **M9** | **Body structure** | Video 2 has a "fast-spoken table of contents of 14 parts" in the first 3 minutes before going deep — not seen in the other 3 videos. | Treat as **optional** for roadmap/multi-part videos, not mandatory. |
| **M10** | **Green & cyan hex values differ** | Green: #22C55E / #34E87B / #34D399 / #2EE6A8; cyan: #22D3EE / #2EE6D6 / #38BDF8 / #38C8F5. | Color measurement error from compressed frames. Lock 1 token/color for the design system (proposed: cyan `#22D3EE`, green `#34D399`) and allow a ±10% range. |
