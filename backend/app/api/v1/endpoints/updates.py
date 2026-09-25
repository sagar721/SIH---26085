from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.runtime_store import runtime_store

router = APIRouter()


@router.websocket("/ws/updates")
async def updates(websocket: WebSocket) -> None:
    await websocket.accept()
    queue = await runtime_store.subscribe()
    try:
        await websocket.send_json({"event": "connected", "timestamp": runtime_store.now()})
        while True:
            await websocket.send_json(await queue.get())
    except WebSocketDisconnect:
        pass
    finally:
        await runtime_store.unsubscribe(queue)

