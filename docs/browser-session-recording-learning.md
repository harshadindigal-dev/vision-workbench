# Browser session recording → learned UI actions

This branch explores turning **screen recordings of real browser navigation** into **structured knowledge about what the user clicked**—so agents can replay, generalize, or be supervised from demonstrations.

It builds directly on Vision Workbench’s idea: **decompose** the visual stream, attach **spatial context**, run **VLMs for reasoning**, and emit **graphs / JSON** instead of opaque “model guessed it.”

### Implemented MVP (core functionality)

In the app today:

- **Backend:** `POST /api/browser-session/analyze` accepts a screen recording (`mp4`, `webm`, `mov`, …), samples frames on an interval, runs **YOLO** per sample (optional **`detector_model`** path resolved under `backend/`), computes **pairwise frame-diff scores** for hints, optionally calls **OpenAI** on frame pairs (`use_vlm=true`, requires `OPENAI_KEY`). Multipart field **`pointer_events_json`** merges logged **`pointerdown`** positions + **`target_rect`** into **`ground_truth_pointer_events`** (viewport coordinates scaled to each sampled frame).
- **Frontend:** Tab **Session learning** — upload video, optional pointer JSON, toggle VLM, inspect **ground-truth alignment**, hypotheses, raw JSON.
- **Chrome extension:** **`extensions/pointer-logger`** — MV3 helper; **Align clock** → start screen recording aligned to `performance.now()` → **`pointerdown`** + **`getBoundingClientRect`** → **Export JSON**.

Remaining gaps: cursor overlay inside the pixels-only recording path (without compositing), multi-monitor scaling, and richer DOM roles beyond rects/tag/text—those belong in the next iteration.

---

## Why this fits Vision Workbench

| Piece today | Role for browser demos |
|-------------|-------------------------|
| Detection / segmentation | Locate buttons, links, inputs, chrome vs page content |
| Per-region crops + coords | Tie each moment in the video to stable targets |
| VLM step | Describe controls, labels, intent (“user submitted form”) |
| Graph output | Represent flows as navigation graphs or action traces |

Screen recordings add **time**: we care about **when** affordances appear, **what moved** (cursor, hover, scroll), and **which region received** the apparent click.

---

## User story

1. User clicks **Record** (browser tab or desktop capture).
2. User performs a task normally (search → filter → checkout, internal admin workflow, etc.).
3. User stops recording.
4. The system produces:
   - A **timeline** of frames (or keyframes).
   - **Candidate UI elements** per frame (boxes / masks).
   - **Inferred click targets** aligned with cursor peaks / DOM sync if available.
   - An **action trace**: ordered steps like `{ type: 'click', target: 'Add to cart', bbox_norm: [...], url: ..., frame_t: ... }`.
5. Optional: **fine-tune or prompt** an agent policy from these traces—same workspace, composable steps.

---

## Learning “what buttons were clicked”

“Learning” can mean several complementary outputs:

- **Demonstration labeling:** Each clip yields labeled (region, action, timestamp) tuples—training data for imitation or RL from pixels.
- **Skill extraction:** Merge repeated demos into a generalized recipe (“always click Sign in with this SSO tile”).
- **Selector grounding:** Map visual boxes to accessibility roles / text when DOM or AX snapshots exist.

Pure vision path (no extension): infer clicks from **cursor appearance**, motion discontinuities, and **post-click UI changes** (modal opens, route change). Higher ambiguity; VLMs help interpret transitions.

Strong signal path (recommended hybrid): lightweight **browser extension** logs `pointerdown`, `element` descriptors (role, name, bbox), and URL—aligned with video timestamps for calibration.

---

## Proposed pipeline extensions (conceptual)

Rough ordering—not prescriptive:

```text
Video ingest → Frame sampler / sync metadata
       → UI decomposition (YOLO/SAM/custom UI detector)
       → Cursor / motion estimation (specialized head or classical CV)
       → Optional DOM↔video alignment (extension channel)
       → Event inference (rules + VLM over before/after pairs)
       → Action trace JSON + provenance graph
       → Export (Skills.jsonl, Playwright scaffold, agent prompt pack)
```

Each stage maps cleanly to **nodes** in the existing workflow metaphor.

---

## MVP milestones

1. **Ingest:** Upload `.webm` / `.mp4`; extract frames + timestamps.
2. **Detect:** Run UI-element detection on sampled frames (reuse Training Studio patterns for custom UI classes later).
3. **Associate:** Simple heuristic first—nearest box to cursor hotspot at click-like motion dip—plus VLM sanity check on crop pairs.
4. **Emit:** Action trace schema Version 0 + visualization overlay (reuse graph JSON mindset).

Later: extension for DOM fusion, multi-session merging, evaluation harness against replay success rate.

---

## Privacy & ethics

Screen recordings may contain credentials, tokens, or PII. Any shipping design needs:

- Explicit consent and clear retention policy.
- Optional redaction passes (blur regions, OCR detection of secrets).
- Local-first processing option.

---

## Contributing on this branch

Open questions worth prototyping:

- Optimal frame rate vs inference cost for long sessions.
- Alignment metric between DOM rects and video projection when scaling/zoom differs.
- Teaching signals beyond clicks (keyboard, drag, scroll depth).

Merge back to `main` only after there is an MVP ingest path + documented schema—until then this branch is the **North Star** for “demonstrations → structured UI intelligence.”
