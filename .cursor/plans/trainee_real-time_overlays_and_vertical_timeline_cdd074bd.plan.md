---
name: Trainee real-time overlays and vertical timeline
overview: Add real-time detection overlays (hands + SAM3 segments) on the trainee camera feed, a vertical git-style timeline on the left showing stages in descending order, and keep the existing poll that checks completion and suggests progress (user still confirms to advance).
todos: []
isProject: false
---

# Trainee real-time detections and vertical timeline

## Goals

1. **Real-time detections on camera** — Trainee sees hands and relevant objects (SAM3 segments) drawn live on their camera feed.
2. **Vertical timeline (left)** — Git-tree style: stages listed top-to-bottom with names, vertical connector line, current stage highlighted; system keeps checking the feed and suggests when a stage is complete (user confirms to progress).

---

## 1. Backend: Return detection result for overlay

**File:** [skillforge-api/routers/trainee.py](skillforge-api/routers/trainee.py)

- Extend `CheckStepSuggestResponse` to include optional `hands` and `sam3_segments` (same shape as [live_detect DetectFrameResponse](skillforge-api/routers/live_detect.py): `hands` dict, `sam3_segments` list of `{ mask_base64?, bbox, score }`).
- In `check_step_suggest`: after running SAM3 and MediaPipe, include them in the response every time (not only when suggest_complete). This gives the frontend one source of truth for both (a) drawing the overlay and (b) suggest message.
- No change to the suggest heuristic (suggest_complete + message); only add fields to the response.

**Schema (e.g. in [models/schemas.py](skillforge-api/models/schemas.py) or inline in trainee.py):** Add optional `hands: dict | None = None`, `sam3_segments: list[dict] = []` to the response model.

---

## 2. Frontend: Store detection result and draw overlay on camera

**Files:** [skillforge/components/player/LearnView.tsx](skillforge/components/player/LearnView.tsx), new overlay component or inline canvas.

- **State:** Add `lastDetectionResult: { hands: ...; sam3_segments: ... } | null` (or reuse the type from live page). Set it from the existing suggest poll: when calling `checkStepSuggest`, the API will now return `hands` and `sam3_segments`; store that in state (and keep using `suggest_complete` / `message` for the banner).
- **API client:** Update [lib/api-client.ts](skillforge/lib/api-client.ts) so the return type of `checkStepSuggest` includes optional `hands` and `sam3_segments` (and the backend is actually returning them as in step 1).
- **Overlay canvas:** When in training mode, render a canvas positioned over the camera `<video>` (same approach as [live/page.tsx](skillforge/app/live/page.tsx): absolute-positioned canvas, sync size to video, requestAnimationFrame loop). In the loop:
  - If `lastDetectionResult` is set:
    - Draw **hands**: use `renderHandLandmarks(ctx, lastDetectionResult.hands.hands, width, height, time)` from [lib/annotation-renderer.ts](skillforge/lib/annotation-renderer.ts) (hands use 0–100 coords; the renderer divides by 100).
    - Draw **SAM3 segments**: same as live page — bbox stroke + optional mask overlay. Reuse the drawing logic from [live/page.tsx](skillforge/app/live/page.tsx) (lines ~338–380): bbox in normalized coords, label with step’s `sam3_prompt` and score. Optional: cache mask base64 → ImageBitmap for smooth mask drawing (as on live page).
  - If no result yet, clear canvas.
- **Poll:** Keep the existing 2s (or 1.5s) interval. After the backend change, the same request returns `suggest_complete`, `message`, `hands`, and `sam3_segments`; on response, set both suggest state and `lastDetectionResult` so the overlay updates.

Result: trainee sees hands and detected objects in real time on their camera feed, with the system still checking completion and showing the “Step looks complete” banner when appropriate.

---

## 3. Vertical timeline component (git-tree style)

**New file:** e.g. `skillforge/components/player/StepTimelineVertical.tsx` (or `VerticalStepTimeline.tsx`).

- **Props:** `steps: Step[]`, `currentStepIndex: number`, `subtasksByStep`, `currentSubtaskIndexByStep`, optional `onStepClick(index)`, optional `onSubtaskClick(stepId, index)`.
- **Layout:** Vertical list, **descending order** (step 1 at top, step 2 below, …, last step at bottom). Each row:
  - A vertical line segment (left edge, e.g. 2px wide) connecting to the next row.
  - A **node**: circle/dot on the line (e.g. 10px) — completed steps one style (e.g. filled green/lime), current step another (e.g. purple or accent), upcoming steps muted.
  - Step **name** (and optional subtask count or current subtask) to the right of the node.
- **Visual:** Similar to VS Code source control / git graph: vertical line on the left, nodes on the line, labels to the right. Use flex column; each step is a row with `flex items-center gap-2`; the “line” can be a left border or a narrow div between nodes.
- **Optional:** If a step has elaborated subtasks, show a small indented sub-list under that step (subtask titles) with the current subtask highlighted.

**Reference:** [StepProgressBar](skillforge/components/player/StepProgressBar.tsx) already reads `currentStepIndex`, `subtasksByStep`, `currentSubtaskIndexByStep` from the store; the vertical component can do the same and optionally accept click handlers to match.

---

## 4. Layout: Add vertical timeline on the left

**File:** [skillforge/components/player/LearnView.tsx](skillforge/components/player/LearnView.tsx)

- **When to show:** Prefer showing the vertical timeline whenever the trainee is on the learn page (so they always see “current stages” in order). Alternatively, show it only when “Start training” is active; the plan can assume “always on learn” for consistency.
- **Layout change:** Main content area becomes a row: `[Vertical timeline (fixed width, e.g. 200–220px)] [Current content (top bar + video area + camera + banner)] [Copilot (existing 80px)]`. So:
  - Left: `<StepTimelineVertical steps={workflow.steps} currentStepIndex={...} ... />` in a fixed-width column, scrollable if many steps.
  - Center: existing flex column (optional: hide or simplify the horizontal StepProgressBar when the vertical timeline is present to avoid duplication; or keep both with horizontal for quick scrub and vertical for “stages”).
  - Right: existing Copilot panel.
- Ensure the vertical timeline shows **current** stage clearly and keeps the same “check feed → suggest complete → user confirms → progress” behavior (no change to that logic).

---

## 5. Keep checking and progress (no change)

- The existing poll (e.g. every 2s) that calls `check-step-suggest` (or the same endpoint returning detection + suggest) continues to run when in training mode with a current step that has `sam3_prompt`.
- When the backend sets `suggest_complete: true`, the frontend shows the “Step looks complete” banner; the user confirms via voice (“next”), button (Continue), or gesture (double-tap) to advance. No automatic advance unless you explicitly add an optional “auto-advance after N seconds when suggest_complete” later.

---

## 6. Implementation order

1. Backend: extend trainee `check-step-suggest` response with `hands` and `sam3_segments`; update response model.
2. Frontend API client: update `checkStepSuggest` return type and store the full response; in LearnView set `lastDetectionResult` from the same response.
3. LearnView: add overlay canvas over the camera feed when in training mode; in a requestAnimationFrame loop draw `lastDetectionResult` (hands + SAM3 segments) using existing render helpers and live-page-style SAM3 drawing.
4. New component: `StepTimelineVertical` with git-tree layout, descending steps, current/completed/upcoming styling.
5. LearnView layout: insert vertical timeline as left sidebar; optionally hide or simplify top horizontal bar when timeline is visible.

---

## 7. Files to add or touch


| Area         | Files                                                                                                                                                                                              |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend      | [skillforge-api/routers/trainee.py](skillforge-api/routers/trainee.py) (response model + return hands/sam3_segments)                                                                               |
| Frontend API | [skillforge/lib/api-client.ts](skillforge/lib/api-client.ts) (checkStepSuggest response type)                                                                                                      |
| Overlay      | [skillforge/components/player/LearnView.tsx](skillforge/components/player/LearnView.tsx) (state for lastDetectionResult, canvas over camera, draw loop reusing renderHandLandmarks + SAM3 drawing) |
| Timeline     | New [skillforge/components/player/StepTimelineVertical.tsx](skillforge/components/player/StepTimelineVertical.tsx)                                                                                 |
| Layout       | [skillforge/components/player/LearnView.tsx](skillforge/components/player/LearnView.tsx) (left sidebar with StepTimelineVertical, adjust flex layout)                                              |


Reuse from existing code: [lib/annotation-renderer.ts](skillforge/lib/annotation-renderer.ts) `renderHandLandmarks`; SAM3 bbox/mask drawing pattern from [app/live/page.tsx](skillforge/app/live/page.tsx) (lines 338–380, mask cache optional).