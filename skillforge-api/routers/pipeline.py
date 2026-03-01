import asyncio
import json
import time
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from models.database import fetchall
from app_ws.pipeline_ws import register, unregister, broadcast

router = APIRouter(tags=["pipeline"])


@router.get("/api/pipeline/{workflow_id}/status")
async def pipeline_status_sse(workflow_id: str):
    """SSE fallback for pipeline status."""
    async def event_stream():
        sent_ids: set[str] = set()
        for _ in range(300):  # poll for up to 5 minutes
            logs = await fetchall(
                "SELECT * FROM pipeline_logs WHERE workflow_id=? ORDER BY created_at",
                (workflow_id,),
            )
            for log in logs:
                if log["id"] not in sent_ids:
                    sent_ids.add(log["id"])
                    data = json.dumps({
                        "type": "pipeline_log",
                        "stage": log["stage"],
                        "message": log["message"],
                        "progress": log["progress"],
                        "timestamp": log["created_at"],
                    })
                    yield f"data: {data}\n\n"

            # Check if complete or failed
            last = logs[-1] if logs else None
            if last and last["stage"] in ("complete", "error"):
                break

            await asyncio.sleep(1)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.websocket("/ws/pipeline/{workflow_id}")
async def pipeline_ws(websocket: WebSocket, workflow_id: str):
    await websocket.accept()
    register(workflow_id, websocket)

    # Send existing log history immediately on connect
    try:
        logs = await fetchall(
            "SELECT * FROM pipeline_logs WHERE workflow_id=? ORDER BY created_at",
            (workflow_id,),
        )
        for log in logs:
            await websocket.send_text(json.dumps({
                "type": "pipeline_log",
                "stage": log["stage"],
                "message": log["message"],
                "progress": log["progress"],
                "timestamp": log["created_at"],
            }))

        # If the pipeline already finished, send the complete/error event
        # so reconnecting clients can navigate away
        if logs:
            last = logs[-1]
            if last["stage"] == "complete":
                await websocket.send_text(json.dumps({
                    "type": "complete",
                    "workflow_id": workflow_id,
                }))
            elif last["stage"] == "error":
                await websocket.send_text(json.dumps({
                    "type": "error",
                    "message": last["message"],
                }))

        # Keep connection alive until client disconnects
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                # Send ping
                await websocket.send_text(json.dumps({"type": "ping"}))

    except WebSocketDisconnect:
        pass
    finally:
        unregister(workflow_id, websocket)
