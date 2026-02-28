import json
from fastapi import WebSocket

# workflow_id → set of connected WebSocket clients
_connections: dict[str, set[WebSocket]] = {}


def register(workflow_id: str, ws: WebSocket):
    _connections.setdefault(workflow_id, set()).add(ws)


def unregister(workflow_id: str, ws: WebSocket):
    if workflow_id in _connections:
        _connections[workflow_id].discard(ws)
        if not _connections[workflow_id]:
            del _connections[workflow_id]


async def broadcast(workflow_id: str, event: dict):
    dead = set()
    for ws in _connections.get(workflow_id, set()):
        try:
            await ws.send_text(json.dumps(event))
        except Exception:
            dead.add(ws)
    for ws in dead:
        unregister(workflow_id, ws)
