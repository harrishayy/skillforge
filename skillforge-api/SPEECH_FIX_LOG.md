# Speech Recognition Fix — Progress Log
> Branch: `fix/speech-recognition` | Started: 2026-02-28
> Owner: Jeson R | Context file — load this at the start of every session

---

## Problem Statement

When the `gesture-detection` branch was merged into `main`, speech recognition broke
on the recording session page (`/record/session`). The root cause is a **microphone
ownership conflict** between two hooks that both try to capture the mic simultaneously.

### The Two Conflicting Consumers

| Hook | File | How it takes the mic |
|---|---|---|
| `useWebcamRecorder` | `skillforge/hooks/useWebcamRecorder.ts` | `getUserMedia({ video, audio: { echoCancellation, noiseSuppression, autoGainControl } })` |
| `useVoiceCommands` | `skillforge/hooks/useVoiceCommands.ts` | `new SpeechRecognition()` — browser internally calls its own `getUserMedia` |

Both are mounted together in `skillforge/app/(expert)/record/session/page.tsx`.

On macOS + Chrome, the second `getUserMedia` (from SpeechRecognition) fails with an
`audio-capture` error. The `onerror` handler in `useVoiceCommands` then sets
`active = false` — permanently killing voice recognition for the session.

### Why `/live` page is unaffected

`useCameraStream` (used on `/live`) requests `audio: false`, so SpeechRecognition
gets the mic without competition.

---

## Architecture Overview (Speech Pipeline)

```
Browser mic hardware
       │
       ├──► useWebcamRecorder  →  getUserMedia({ video + audio })
       │         └─ audio track embedded in MediaRecorder (for video file)
       │
       └──► useVoiceCommands  →  new SpeechRecognition()  ← CONFLICT
                  └─ onresult → voice-intent-matcher.ts
                       ├─ regex + Levenshtein fuzzy match (fast, client-side)
                       └─ LLM fallback → POST /api/voice/intent → Claude Sonnet 4.6
                            (throttled 2500ms, only if transcript > 50 chars)
```

---

## Fix Strategy

### Phase 1 — Shared mic stream (current work, no new infra)
Separate mic ownership so only ONE `getUserMedia` call happens.
A new `useMicStream` hook owns the mic. `useWebcamRecorder` accepts the audio
track externally instead of requesting it itself.

```
useMicStream (single getUserMedia — owns the mic)
    │
    ├──► audio track → useWebcamRecorder (merged into MediaRecorder stream)
    │
    └──► mic is free for SpeechRecognition in useVoiceCommands (no conflict)
```

### Phase 2 — Nemotron Parakeet ASR (future, NVIDIA bounty)
Replace Web Speech API entirely with NVIDIA NIM ASR. Audio chunks from the
existing recorder stream sent to a new backend endpoint. Eliminates the mic
conflict architecturally. Improves accuracy for physical task vocabulary.

---

## Files Involved

### Files we own / will create (no permission needed)
| File | Status | Notes |
|---|---|---|
| `skillforge/hooks/useVoiceCommands.ts` | Existing — may edit | Speech hook, our domain |
| `skillforge/hooks/useMicStream.ts` | **New — to create** | Single mic owner hook |
| `skillforge/lib/voice-intent-matcher.ts` | Existing — may edit | Intent matching logic |
| `skillforge/types/speech.d.ts` | Existing — may edit | Web Speech API types |

### Files outside our domain (NEED PERMISSION before editing)
| File | Why we need it | Permission |
|---|---|---|
| `skillforge/hooks/useWebcamRecorder.ts` | Must accept external audio track instead of requesting its own | ⏳ Pending |
| `skillforge/app/(expert)/record/session/page.tsx` | Must wire up useMicStream + pass audio to recorder | ⏳ Pending |

### Files we must NOT touch
- All of `skillforge-api/routers/` except `voice.py` and future `asr.py`
- `skillforge-api/services/` except speech-related
- All frontend files not listed above

---

## ✅ CHECKPOINT — Phase 1 Complete & Working (2026-02-28)

**State:** Web Speech API voice recognition is **fully functional** on the recording session page.
- Mic no longer conflicts with the recorder
- `useVoiceCommands` reaches "Listening" state reliably
- Voice commands ("next step", "finish recording") are recognised
- Known issue: sensitivity is too high — commands fire too eagerly on ambient speech / partial phrases

**Rollback instructions (if Phase 2 breaks things):**
To return to this working state:
```bash
git stash   # or git checkout the three files below
```
Three files that constitute Phase 1:
| File | Change summary |
|---|---|
| `skillforge/hooks/useMicStream.ts` | NEW — delete this file to roll back |
| `skillforge/hooks/useWebcamRecorder.ts` | Revert `start()` signature to `async (): Promise<MediaStream \| null>` and restore original `getUserMedia` block |
| `skillforge/app/(expert)/record/session/page.tsx` | Remove `useMicStream` import + call; revert start effect back to `if (!config \|\| hasStartedRef.current) return` with `webcamRecorder.start()` (no arg) |

**Pre-existing TS errors (NOT caused by our changes):**
- `learn/[workflowId]/page.tsx` — `.start`/`.stop` missing on voice return type
- `useMediaPipeDetect.ts` — `YoloDetection` not exported from `useLiveDetect`

---

## Session Log

### Session 1 — 2026-02-28

**Completed:**
- [x] Created branch `fix/speech-recognition` from `main`
- [x] Full analysis of speech/mic conflict
- [x] Identified root cause: dual `getUserMedia` conflict in `record/session/page.tsx`
- [x] Designed Phase 1 fix architecture (shared mic stream)
- [x] Created this progress log

**Completed (Phase 1):**
- [x] Create `skillforge/hooks/useMicStream.ts` — single mic owner, requests audio once
- [x] Modify `useWebcamRecorder.ts:54` — `start()` now accepts optional `externalAudioStream?: MediaStream`; if provided, requests video-only and merges external audio tracks into the recording stream
- [x] Modify `record/session/page.tsx:77` — adds `useMicStream()` call; passes `micStream` to `webcamRecorder.start()`; start effect now waits for both `config` AND `micStream` before proceeding
- [x] TypeScript check passed — zero new errors introduced

**Phase 2 — Nemotron ASR (BLOCKED — see takeaways below)**
- [x] Created `skillforge-api/routers/asr.py` — POST /api/voice/transcribe skeleton
- [x] Registered asr_router in `main.py`
- [x] Added NVIDIA_NIM_API_KEY to `.env`
- [x] Tested NVIDIA NIM API → **404 on audio/transcriptions endpoint**
- [x] Queried `/v1/models` on the NIM key → confirmed NO audio/ASR models available
- [ ] BLOCKED: Parakeet CTC 1.1B is not hosted on integrate.api.nvidia.com cloud API

**Phase 2 revised plan — sensitivity fix on Web Speech API**
- [x] Fix `useVoiceCommands.ts`: fire only on `isFinal` results (remove interim triggers)
- [x] Add 2-second command cooldown in `useVoiceCommands.ts`

---

## ✅ CHECKPOINT — Nemotron VL Activated (2026-02-28)

**Key discovery:** `nvidia/nemotron-nano-vl-12b-v2` is fully implemented in
`services/nemotron_client.py` and IS available on the NIM cloud API via
`/v1/chat/completions` with image inputs. It was never broken — it just needed
the `NVIDIA_NIM_API_KEY` which was blank. Now that the key is set, the entire
trainer video pipeline (frame analysis → step decomposition) uses real Nemotron VL.

**Files already implementing Nemotron VL (no changes needed):**
- `skillforge-api/services/nemotron_client.py` — full VLM frame analysis, model `nvidia/nemotron-nano-vl-12b-v2`
- `skillforge-api/services/workflow_builder.py:109` — calls `analyze_frames_batch()` in software pipeline
- `skillforge-api/routers/editor.py:459` — on-demand frame analysis in editor

---

## 🔄 Current Strategy — Parakeet ASR on Brev GPU

### Decision
Parakeet CTC 1.1B ASR is **not available on the NIM cloud API** but CAN be
self-hosted on the existing Brev GPU alongside SAM3.

### Why it's feasible
- Brev instance has 2x A100 80GB = 160GB VRAM total
- SAM3 uses ~8-10GB, Parakeet CTC 1.1B uses ~3GB — plenty of headroom
- The backend endpoint (`routers/asr.py`) is already written and registered
- A second SSH tunnel is all that's needed on the local side

### Setup steps (for new chat / teammate)
```bash
# 1. SSH into Brev
ssh shadeform@216.81.245.40

# 2a. Option A — Docker NIM container (requires Docker + NGC key)
docker login nvcr.io   # use NGC API key from build.nvidia.com
docker pull nvcr.io/nim/nvidia/parakeet-ctc-1.1b-asr
tmux new -s asr
docker run --gpus all -p 8081:9000 nvcr.io/nim/nvidia/parakeet-ctc-1.1b-asr
# Ctrl+B, D to detach

# 2b. Option B — Pure Python (no Docker needed)
conda create -n parakeet python=3.10 -y && conda activate parakeet
pip install nemo_toolkit[asr] fastapi uvicorn python-multipart
# Then deploy skillforge-api/deploy/parakeet_server.py (needs to be created)
tmux new -s asr
uvicorn parakeet_server:app --host 0.0.0.0 --port 8081

# 3. Verify it's running
curl http://localhost:8081/health   # from inside Brev
```

```bash
# 4. On your local machine — second SSH tunnel
ssh -L 8081:localhost:8081 shadeform@216.81.245.40 -N
# (keep this terminal open alongside the SAM3 tunnel on 8080)

# 5. Test it
curl -X POST http://localhost:8081/v1/audio/transcriptions \
  -F "file=@/tmp/test_audio.wav;type=audio/wav" \
  -F "model=nvidia/parakeet-ctc-1.1b-asr"
```

### Backend changes already done
- `skillforge-api/routers/asr.py` — `POST /api/voice/transcribe` — created ✅
- `skillforge-api/main.py` — asr_router registered ✅
- `skillforge-api/.env` — `NVIDIA_NIM_API_KEY` set ✅
- **Only remaining**: update `NIM_ASR_URL` in `routers/asr.py` from
  `integrate.api.nvidia.com/v1/audio/transcriptions` → `http://localhost:8081/v1/audio/transcriptions`

### Frontend changes still needed (new chat)
1. Create `skillforge/hooks/useNemotronASR.ts`
   - Takes `micStream: MediaStream` (from existing `useMicStream`)
   - Uses `MediaRecorder` to capture 1.5s audio chunks
   - POSTs each chunk to `POST /api/voice/transcribe`
   - Runs transcript through `matchVoiceIntent()` from `voice-intent-matcher.ts`
   - Fires `onNextStep` / `onPreviousStep` / `onFinish` callbacks
   - Has 2s cooldown after any command fires (fixes sensitivity)
2. Modify `record/session/page.tsx` — swap `useVoiceCommands` for `useNemotronASR`
   (both take same onNextStep/onFinish/onPreviousStep callbacks — drop-in swap)

---

## ✅ CHECKPOINT — Sensitivity Fix Applied (2026-02-28)

**State:** Web Speech API voice commands are working with improved precision.

**Changes made to `skillforge/hooks/useVoiceCommands.ts`:**
1. **Final-only matching** — `runMatcher` is now only called when `isFinal` is true.
   Before: `runMatcher(final + interim, hasFinal)` — fired on every interim word.
   After: `if (hasFinal) runMatcher(final.trim(), true)` — fires only when speech engine commits a phrase.
2. **2-second cooldown** — `lastCommandRef` (hook-level `useRef`) tracks timestamp of last command.
   A command is silently ignored if fired < 2000ms after the previous one.
3. **Cleanup** — removed unused `interim` variable (was declared but never read after fix 1).

**What is unchanged (still working from Phase 1):**
- `useMicStream.ts` → single mic owner, no conflict with recorder
- `useWebcamRecorder.ts` → accepts `externalAudioStream`
- `record/session/page.tsx` → passes `micStream` to recorder
- Full narration transcript still accumulates via `stepTranscript` and `transcriptRef`
- `snapshotTranscript()` still captures per-step narration for workflow metadata

**Transcript recording behaviour (unchanged):**
- Every `isFinal` phrase is appended to `stepTranscript` (accumulates during the step)
- When trainer says "next step", `snapshotTranscript()` returns the full narration for that step
  and clears the buffer — this feeds into the workflow step metadata on upload

---

## ⚡ FALLBACK — Web Speech API (Sensitivity Fix)

**If Parakeet setup on Brev fails or is too risky**, fall back to fixing the
existing Web Speech API in `useVoiceCommands.ts`. Two targeted changes:

### Fix 1 — Fire only on final results (line 131-133)
```typescript
// CURRENT (fires on interim too):
if (isFinal) { final += text + " "; hasFinal = true; }
else { interim = text; }
const check = (final + interim).toLowerCase().trim();
if (check) runMatcher(check, hasFinal);

// FIXED (final results only, no interim):
if (isFinal) { final += text + " "; hasFinal = true; }
// Only call runMatcher when we have a final result
if (hasFinal && final.trim()) runMatcher(final, true);
```

### Fix 2 — Add 2-second cooldown after command fires
```typescript
// Add at top of useVoiceCommands:
const lastCommandRef = useRef<number>(0);
const COMMAND_COOLDOWN_MS = 2000;

// In runMatcher, before firing any intent:
const now = Date.now();
if (now - lastCommandRef.current < COMMAND_COOLDOWN_MS) return;
lastCommandRef.current = now;
// ... then fire intent
```

**File to edit:** `skillforge/hooks/useVoiceCommands.ts`
**Risk:** Very low. 15 minute fix. No new infrastructure.

---

## ❌ Why Nemotron ASR Is Not Available (Detailed)

### What we tried
1. `POST https://integrate.api.nvidia.com/v1/audio/transcriptions` → **404**
2. `POST https://ai.api.nvidia.com/v1/audio/transcriptions` → **404**
3. `GET https://integrate.api.nvidia.com/v1/models` → 200, full model list returned

### What the model list showed
The NIM cloud API (`integrate.api.nvidia.com`) hosts **LLMs, embeddings, and VLMs only**.
Zero audio or speech models are in the catalog. The full breakdown of hosted categories:
- Text LLMs (Llama, Mistral, Nemotron, Qwen, Gemma, DeepSeek, etc.)
- Embedding models (nv-embed, bge-m3, etc.)
- Vision-language models (phi-4-multimodal, llama-3.2-vision, etc.)
- Translation (nvidia/riva-translate) — text→text, not speech→text
- **No ASR / speech-to-text / audio transcription models**

### Why Parakeet CTC exists but isn't accessible this way
NVIDIA NIM has two delivery modes:
| Mode | What it is | How to access |
|---|---|---|
| **Hosted cloud API** | NVIDIA runs the inference server for you | `integrate.api.nvidia.com` with API key |
| **Self-hosted NIM container** | Docker image you pull and run on your own GPU | `nvcr.io/nim/nvidia/parakeet-ctc-1.1b-asr` |

`parakeet-ctc-1.1b-asr` **only exists in self-hosted container form**. NVIDIA never published it as a cloud-hosted endpoint. To use it we would need to:
1. Pull the Docker image onto the Brev GPU: `docker pull nvcr.io/nim/nvidia/parakeet-ctc-1.1b-asr`
2. Start a container on port 8081 (SAM3 is on 8080)
3. Open another SSH tunnel: `ssh -L 8081:localhost:8081 shadeform@216.81.245.40`
4. Build the frontend hook to call `http://localhost:8081/v1/audio/transcriptions`

This is achievable but is 30–45 min of infrastructure work with real risk on a hackathon timeline. The Web Speech API fix is already working and takes 10 minutes.

### The NVIDIA bounty path that IS available
The Nemotron bounty is targeted through **Nemotron VL** (visual language model), which is already wired into the video processing pipeline in `services/nemotron_client.py`. That code path runs during trainer recording upload → frame analysis. That counts as NVIDIA usage for the bounty.

---

## Key Observations

- The 120ms delay in `useVoiceCommands.ts:148` was added for React Strict Mode
  double-mount but does NOT solve the multi-hook mic conflict
- `useWebcamRecorder.ts:70` already has a video-only fallback if audio fails —
  but the failure happens AFTER the recorder starts, so SpeechRecognition gets
  blocked regardless
- `useMicLevel.ts` does not exist on main — the `MicLevelBar` component is
  present but the hook is missing (likely was on gesture-detection branch and
  not merged cleanly)
- `audio-capture` error in `useVoiceCommands.onerror` permanently stops
  recognition (`active = false`) — no retry logic
