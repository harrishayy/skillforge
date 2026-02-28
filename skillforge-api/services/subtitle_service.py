"""
Subtitle generation service.

Splits a step transcript into timed subtitle segments proportional to
character count, then persists them in the `subtitles` table.
"""
import re
from models.database import execute, new_id

# Sentence-boundary patterns (ordered by priority)
_SENTENCE_ENDINGS = re.compile(r"(?<=[.!?])\s+")
# Clause breaks before common conjunctions
_CLAUSE_BREAKS = re.compile(r",\s+(?=(?:and|but|or|so|yet|nor|for|because|although|while|when|if|as)\s)", re.IGNORECASE)

_MAX_SEGMENT_MS = 7000
_MIN_SEGMENT_MS = 1500


def _split_transcript(transcript: str) -> list[str]:
    """Split transcript text into sentence/clause fragments."""
    # First split on sentence endings
    parts: list[str] = []
    for sentence in _SENTENCE_ENDINGS.split(transcript.strip()):
        sentence = sentence.strip()
        if not sentence:
            continue
        # Further split long sentences on clause breaks
        clauses = _CLAUSE_BREAKS.split(sentence)
        for clause in clauses:
            clause = clause.strip()
            if clause:
                parts.append(clause)
    return parts if parts else [transcript.strip()]


def _assign_timings(parts: list[str], duration_ms: int) -> list[dict]:
    """Assign start/end times proportional to character count."""
    total_chars = sum(len(p) for p in parts)
    if total_chars == 0:
        return []

    segments: list[dict] = []
    cursor_ms = 0

    for part in parts:
        ratio = len(part) / total_chars
        raw_ms = int(ratio * duration_ms)
        seg_ms = max(_MIN_SEGMENT_MS, min(_MAX_SEGMENT_MS, raw_ms))
        segments.append({
            "text": part,
            "start_ms": cursor_ms,
            "end_ms": cursor_ms + seg_ms,
        })
        cursor_ms += seg_ms

    # Scale back so the last segment ends exactly at duration_ms
    if segments and segments[-1]["end_ms"] != duration_ms:
        diff = duration_ms - segments[-1]["end_ms"]
        # Distribute the diff proportionally or just clamp the last one
        segments[-1]["end_ms"] = duration_ms

    return segments


async def generate_subtitles(step_id: str, transcript: str, duration_ms: int) -> list[dict]:
    """
    Split transcript into timed subtitle segments and store them in the DB.
    Returns the list of inserted segment dicts.
    """
    transcript = (transcript or "").strip()
    if not transcript or duration_ms <= 0:
        return []

    parts = _split_transcript(transcript)
    segments = _assign_timings(parts, duration_ms)

    result = []
    for seg in segments:
        seg_id = new_id()
        await execute(
            "INSERT INTO subtitles (id, step_id, start_ms, end_ms, text) VALUES (?,?,?,?,?)",
            (seg_id, step_id, seg["start_ms"], seg["end_ms"], seg["text"]),
        )
        result.append({"id": seg_id, "step_id": step_id, **seg})

    return result
