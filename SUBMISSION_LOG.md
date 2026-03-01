# SkillForge — Submission Framing Log
> Started: 2026-03-01 | Context: Competition submission prep, framing against YC Spring 2026 RFS

---

## Research Summary — YC Spring 2026 Request for Startups

YC released its Spring 2026 RFS in early February 2026. One of the **top 10 priority areas** is titled:

> **"AI Guidance for Physical Workers"**

Their framing (verbatim):
> "You know that scene in The Matrix, where Neo plugs a cable into the back of his head and wakes up a while later? Physical work is about to get something similar — not through brain implants, but through real-time AI guidance. Imagine wearing a small camera while an AI sees what you see and talks you through the job: 'turn off that valve', 'use the ⅜ inch wrench', 'that part looks worn, replace it.' Instead of needing months or years of training, workers can become effective immediately."

**Three converging forces YC cites:**
1. Multimodal models can now see and reason about real-world situations reliably
2. The hardware is already everywhere — phones, AirPods, Smart Glasses
3. Skilled labor shortages make this economically urgent

**YC's suggested approaches:**
- Build the guidance system and sell to companies with existing workforces
- Pick a vertical (HVAC, nursing) and go full-stack
- Build a platform where anyone can sign up, receive AI guidance, and immediately start working

SkillForge maps **directly and specifically** onto all three of these. This is the strongest validation we have for the problem space.

---

## What SkillForge Actually Does (Codebase-Verified)

From reading the full codebase:

### Expert Recording Flow
1. Expert navigates to `/record`, selects a mode (software/hardware task)
2. Records via webcam + voice narration; says "next step" or double-taps to advance
3. On finish: AI pipeline runs automatically
   - **NVIDIA Nemotron VL** (`nemotron_client.py`) — frame-by-frame visual analysis
   - **Claude Sonnet** (`claude_orchestrator.py`) — step decomposition into structured JSON
   - **MediaPipe Hands** — hand tracking, fingertip pointing extraction
4. Expert lands in a canvas editor (`/editor/[id]`) to refine steps, add bounding box / arrow / text annotations, and publish

### Trainee Learning Flow
1. Trainee browses `/library`, opens a workflow at `/learn/[id]`
2. Watches per-step video with AI-drawn overlays (bounding boxes, arrows, highlights)
3. Built-in Claude copilot (`useCopilotChat`) answers questions in context of the current step
4. Can request "elaborate" to break a step into detailed subtasks (session-only, no DB write)
5. **Training mode**: turns on their own camera
   - **SAM 3 segmentation** (`sam3_service.py`) detects relevant objects in trainee's camera feed
   - **MediaPipe** detects hands + fingertip positions
   - Backend compares to expected state → `suggest_complete` signal shown as banner
   - Trainee confirms via voice ("next"), gesture (double-tap pinch), or button

### Live Camera Detection (`/live`)
- Standalone mode: no workflow needed
- Point any camera (laptop or phone via ngrok QR code) → real-time overlays
- Toggleable detectors: Hand tracking, SAM 3 segmentation, Custom prompt (Grounding DINO / Claude)
- Phone-as-camera fully working via WebSocket proxy (`server.mjs`)

### AI/ML Stack
| Model | Purpose |
|---|---|
| NVIDIA Nemotron VL (`nvidia/nemotron-nano-vl-12b-v2`) | Frame-level visual analysis during recording pipeline |
| Claude Sonnet 4.6 | Step decomposition, copilot chat, voice intent classification |
| Meta SAM 3 (NVIDIA Brev GPU) | Concept segmentation — detects objects by text prompt on trainee camera |
| MediaPipe Hands | Real-time hand landmark detection (21 keypoints per hand) |
| Grounding DINO 1.5 | Open-vocabulary object detection (optional, Claude fallback) |
| NVIDIA Parakeet CTC 1.1B | ASR (self-hosted on Brev, replaces Web Speech API) |

---

## Problem Statement Options

### Option A — One sentence (most punchy)
> Physical skills can't be transferred at scale: an expert can only teach one person at a time, and when they step back, decades of hands-on knowledge disappear with them.

### Option B — Two sentences (adds urgency)
> Most of the world's most valuable work — surgery, equipment repair, lab procedures, manufacturing — requires skills you can only learn by doing with an expert watching your hands. Video tutorials show the steps. They can't tell you if you're doing them right.

### Option C — Problem + size (for data-driven judges)
> 2.1 million skilled manufacturing jobs will go unfilled by 2030 (Deloitte). The bottleneck isn't labor supply — it's that physical skills require in-person mentorship, and mentors don't scale.

**Recommended for competition: Option B** — it is concrete, uses the contrast between current state ("show steps") and missing capability ("can't verify"), and sets up our solution in one beat.

---

## Project Description (Full Version)

**SkillForge** is an AI-powered knowledge transfer platform for physical and procedural skills.

**The expert side — capture tacit knowledge:**
Experts record themselves performing any task with voice narration and step-by-step annotations. Our AI pipeline (NVIDIA Nemotron VL + Claude Sonnet) automatically decomposes the recording into structured, time-indexed steps with visual annotations — bounding boxes, arrows, text labels. Experts refine in a canvas editor and publish. One 10-minute recording becomes a structured, replayable curriculum.

**The trainee side — close the feedback loop:**
Trainees watch step-by-step replays with AI-drawn overlays and a built-in Claude copilot for real-time Q&A. When ready to practice, they activate their camera — SkillForge uses SAM 3 concept segmentation and MediaPipe hand tracking to watch their hands, identify the relevant objects in the scene, and signal when each step is complete. Trainees can navigate entirely hands-free via voice commands and gesture detection, which is critical when your hands are occupied with the actual task.

**The core insight:**
Physical guidance requires closing the loop between "watch" and "do." Current tools — videos, SOPs, PDFs — are one-way. SkillForge creates a two-way feedback loop: the system watches you work and tells you when you've got it right, without requiring an expert in the room.

---

## Project Description (Short Version — 100 words, for character-limited fields)

SkillForge is an AI platform for transferring physical and procedural skills at scale. Experts record themselves working with voice narration; our AI pipeline (NVIDIA Nemotron VL + Claude) auto-decomposes recordings into structured, annotated step-by-step workflows. Trainees watch with AI overlays and a live copilot, then switch to practice mode: they turn on their camera and SkillForge uses real-time computer vision (SAM 3 segmentation + hand tracking) to watch their hands, detect task-relevant objects, and confirm when each step is complete. Hands-free via voice and gesture. One expert recording scales to unlimited trainees with real-time verification.

---

## Why This Wins on the YC RFS Framing

| YC Criterion | SkillForge Response |
|---|---|
| "Multimodal AI can see and reason about real situations" | Nemotron VL analyzes expert frames; SAM 3 + MediaPipe watches trainee in real time |
| "Hardware already everywhere — phones" | Phone-as-camera fully implemented (WebSocket proxy, QR code pairing, ngrok) |
| "Skilled labor shortages make this urgent" | Platform is vertical-agnostic; works for any physical/procedural task |
| "Not replacing workers, increasing their capability" | Expert knowledge is preserved and scaled; AI coaches, not replaces |
| "Sell to companies with existing workforces" | Expert → publish → trainee library is exactly this model |

---

## Differentiators (What Judges Will Ask)

**Q: How is this different from a YouTube tutorial?**
YouTube shows you steps. SkillForge watches you do them and tells you when you've got it right. That's the entire gap between passive learning and actual skill transfer.

**Q: How is this different from AR headset products (Magic Leap, HoloLens)?**
No specialized hardware required. Works with any phone or webcam. The intelligence is in the software stack, not the device.

**Q: Why does the expert workflow matter?**
Most real-time guidance systems assume someone has already structured the knowledge. SkillForge solves the upstream problem: it captures unstructured expert recordings and turns them into structured, machine-readable curricula automatically. That's the moat.

**Q: What makes the AI verification trustworthy?**
SAM 3 identifies objects by text description (e.g., "the red valve is open"), not by brittle template matching. Combined with hand proximity detection, it can assess whether the trainee is interacting with the right object in the right way — not just whether the object is visible.

---

## Key Numbers / Stats to Have Ready

- Deloitte: 2.1M unfilled skilled manufacturing jobs by 2030
- McKinsey: 87% of companies report skill gaps or expect them within a few years
- Average cost of on-the-job training per employee: $1,200–$4,000+ for hands-on skilled roles
- Knowledge transfer from retiring workers is cited as the #1 risk by 60%+ of manufacturers

---

## Open Questions for Team

1. **What vertical are we demoing?** Judges respond better to a concrete demo than a generic platform. Options: lab procedure, equipment assembly, cooking technique, medical skill. Pick one, make the demo crisp.
2. **Do we have a live demo ready?** The recording → pipeline → learn flow should be end-to-end demoable. Is the NVIDIA Brev GPU server running?
3. **Competition-specific bounties?** The codebase mentions an NVIDIA bounty path via Nemotron VL + Parakeet. Confirm what the specific bounty criteria are and whether we've hit them.
4. **What is the competition?** If it's a hackathon with specific judges, knowing their background (technical vs. investor vs. domain expert) will let us tune which differentiators to lead with.

---

## Suggested Slide / Pitch Structure (if needed)

1. **Hook** — "Most valuable work in the world is physical. AI can't do it yet. But it can coach the human who does."
2. **Problem** — The tacit knowledge gap. Video shows steps; nothing tells you if you're doing them right.
3. **Solution** — SkillForge: capture expert knowledge → verify trainee execution, in real time.
4. **Demo** — Expert records 60-second task → AI generates structured steps → Trainee watches → Trainee does with camera on → System confirms.
5. **Tech Stack** — Nemotron VL + Claude + SAM 3 + MediaPipe + any phone as camera.
6. **Market** — YC Spring 2026 RFS calls this out explicitly. Skilled labor shortage is $1T+ problem.
7. **Why us** — Working end-to-end system. Phone camera support. Hands-free interaction. Vertical-agnostic.
