def get_events_near_timestamp(
    events: list[dict],
    timestamp_ms: int,
    window_ms: int = 1000
) -> list[dict]:
    """Return input events within window_ms of timestamp_ms."""
    return [
        e for e in events
        if abs(e.get("timestamp_ms", 0) - timestamp_ms) <= window_ms
    ]


def events_to_summary(events: list[dict]) -> str:
    """Convert list of input events to a human-readable summary string."""
    if not events:
        return "no user input"
    parts = []
    for e in events[:5]:  # cap at 5 events per summary
        t = e.get("event_type", "")
        if t == "click":
            btn = e.get("button", "left")
            txt = e.get("element_text", "")
            loc = f"({e.get('x', 0):.0f},{e.get('y', 0):.0f})"
            parts.append(f"{btn}-click{' on ' + repr(txt) if txt else ''} at {loc}")
        elif t == "keypress":
            parts.append(f"key:{e.get('key', '?')}")
        elif t == "scroll":
            parts.append(f"scroll {e.get('scroll_delta', 0):+.0f}")
        elif t == "drag":
            parts.append(f"drag from ({e.get('x', 0):.0f},{e.get('y', 0):.0f})")
    return "; ".join(parts)
