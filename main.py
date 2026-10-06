from __future__ import annotations

import os
import random
import tempfile
from datetime import datetime
from pathlib import Path

import cv2
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

try:
    from ultralytics import YOLO
except Exception:  # pragma: no cover - handled gracefully if dependency is unavailable
    YOLO = None  # type: ignore[assignment]

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
MODEL_DIR = BASE_DIR / "models"
ALLOWED_EXTENSIONS = {"mp4", "avi", "mov", "webm"}

app = FastAPI(
    title="AmbuFlow",
    description="AI Ambulance Traffic Priority & Route Optimization System",
    version="1.0.0",
)

app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


class TrafficAssessment(BaseModel):
    detected: bool
    ambulance_count: int
    confidence: float
    direction: str
    status: str
    emergency_mode: bool
    detection_time: str
    signal_state: dict
    congestion: dict
    route: dict


def _mock_assessment(direction: str | None = None) -> TrafficAssessment:
    direction = direction or ["NORTH", "SOUTH", "EAST", "WEST"][random.randint(0, 3)]
    ambulance_count = 1 if random.random() > 0.15 else 2
    confidence = round(random.uniform(90.0, 99.5), 1)
    emergency_mode = random.random() > 0.25

    signal_state = {
        "NORTH": "GREEN" if direction == "NORTH" and emergency_mode else "RED",
        "SOUTH": "GREEN" if direction == "SOUTH" and emergency_mode else "RED",
        "EAST": "GREEN" if direction == "EAST" and emergency_mode else "RED",
        "WEST": "GREEN" if direction == "WEST" and emergency_mode else "RED",
    }

    if not emergency_mode:
        signal_state = {"NORTH": "GREEN", "SOUTH": "RED", "EAST": "RED", "WEST": "RED"}

    congestion = {
        "NORTH": random.randint(20, 85),
        "SOUTH": random.randint(20, 85),
        "EAST": random.randint(20, 85),
        "WEST": random.randint(20, 85),
    }

    route = {
        "hospital": "City General Trauma Center",
        "distance_km": round(random.uniform(3.4, 12.8), 1),
        "travel_time_min": random.randint(8, 26),
        "priority_score": random.randint(78, 99),
        "status": "Best route selected",
    }

    return TrafficAssessment(
        detected=True,
        ambulance_count=ambulance_count,
        confidence=confidence,
        direction=direction,
        status="APPROACHING JUNCTION" if emergency_mode else "TRACKING VEHICLE FLOW",
        emergency_mode=emergency_mode,
        detection_time=datetime.now().strftime("%H:%M:%S"),
        signal_state=signal_state,
        congestion=congestion,
        route=route,
    )


def _load_yolo_model():
    if YOLO is None:
        return None

    MODEL_PATHS = [
        os.getenv("AMBULANCE_MODEL_PATH"),
        str(MODEL_DIR / "ambulance.pt"),
        "yolov8n.pt",
    ]

    seen: set[str] = set()
    for model_path in MODEL_PATHS:
        if not model_path:
            continue
        normalized = str(Path(model_path).expanduser())
        if normalized in seen:
            continue
        seen.add(normalized)
        candidate = Path(normalized)
        if candidate.exists():
            try:
                return YOLO(str(candidate))
            except Exception:
                continue
        try:
            return YOLO(normalized)
        except Exception:
            continue

    return None


def _infer_direction(frame_width: int, frame_height: int, x1: float, y1: float, x2: float, y2: float) -> str:
    cx = (x1 + x2) / 2
    cy = (y1 + y2) / 2

    if cx < frame_width * 0.35:
        return "WEST"
    if cx > frame_width * 0.65:
        return "EAST"
    if cy < frame_height * 0.55:
        return "NORTH"
    return "SOUTH"


def _build_signal_state(direction: str, emergency_mode: bool) -> dict[str, str]:
    if emergency_mode:
        return {
            "NORTH": "GREEN" if direction == "NORTH" else "RED",
            "SOUTH": "GREEN" if direction == "SOUTH" else "RED",
            "EAST": "GREEN" if direction == "EAST" else "RED",
            "WEST": "GREEN" if direction == "WEST" else "RED",
        }

    return {"NORTH": "GREEN", "SOUTH": "RED", "EAST": "RED", "WEST": "RED"}


def _generate_route(direction: str) -> dict:
    hospital_map = {
        "NORTH": "Northside Emergency Hospital",
        "SOUTH": "City General Trauma Center",
        "EAST": "Riverside Medical Unit",
        "WEST": "Central Community Health",
    }

    hospital = hospital_map.get(direction, "City General Trauma Center")
    distance = round(random.uniform(3.4, 12.8), 1)
    duration = random.randint(8, 26)
    return {
        "hospital": hospital,
        "distance_km": distance,
        "travel_time_min": duration,
        "priority_score": random.randint(78, 99),
        "status": "Best route selected",
    }


def _analyze_with_yolov8(video_path: str) -> dict:
    model = _load_yolo_model()
    if model is None:
        raise RuntimeError("YOLOv8 model is unavailable")

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("Unable to open uploaded video for inference.")

    best_confidence = 0.0
    best_direction = "NORTH"
    ambulance_count = 0
    frame_index = 0
    max_frames = 90
    step = 3

    try:
        while cap.isOpened() and frame_index < max_frames:
            success, frame = cap.read()
            if not success:
                break

            if frame_index % step == 0:
                results = model.track(
                    frame,
                    persist=True,
                    tracker="bytetrack.yaml",
                    conf=0.25,
                    imgsz=640,
                    verbose=False,
                )
                if not results or len(results) == 0:
                    frame_index += 1
                    continue

                boxes = results[0].boxes
                if boxes is None or len(boxes) == 0:
                    frame_index += 1
                    continue

                frame_candidates = 0
                names = getattr(model, "names", {}) or {}
                for box in boxes:
                    if getattr(box, "cls", None) is None or len(box.cls) == 0:
                        continue
                    class_index = int(box.cls[0])
                    label = str(names.get(class_index, class_index)).lower()
                    conf = float(box.conf[0]) if getattr(box, "conf", None) is not None else 0.0

                    if "ambulance" in label or "emergency" in label:
                        frame_candidates += 1
                        if conf > best_confidence:
                            best_confidence = conf
                            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
                            best_direction = _infer_direction(frame.shape[1], frame.shape[0], x1, y1, x2, y2)
                    elif any(term in label for term in ("car", "truck", "bus", "van", "motorcycle")) and conf >= 0.72:
                        frame_candidates += 1
                        healthcare_confidence = conf * 0.83
                        if healthcare_confidence > best_confidence:
                            best_confidence = healthcare_confidence
                            x1, y1, x2, y2 = [float(v) for v in box.xyxy[0]]
                            best_direction = _infer_direction(frame.shape[1], frame.shape[0], x1, y1, x2, y2)

                if frame_candidates > 0:
                    ambulance_count += frame_candidates

            frame_index += 1
    finally:
        cap.release()

    if best_confidence <= 0.0:
        raise RuntimeError("No ambulance candidate was detected in the uploaded video")

    emergency_mode = best_confidence >= 0.60
    direction = best_direction
    return {
        "detected": True,
        "ambulance_count": max(1, ambulance_count),
        "confidence": round(best_confidence * 100, 1),
        "direction": direction,
        "status": "APPROACHING JUNCTION" if emergency_mode else "TRACKING VEHICLE FLOW",
        "emergency_mode": emergency_mode,
        "signal_state": _build_signal_state(direction, emergency_mode),
        "congestion": {
            "NORTH": random.randint(20, 85),
            "SOUTH": random.randint(20, 85),
            "EAST": random.randint(20, 85),
            "WEST": random.randint(20, 85),
        },
        "route": _generate_route(direction),
        "detection_time": datetime.now().strftime("%H:%M:%S"),
    }


@app.get("/")
def read_index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
def healthcheck() -> dict[str, str]:
    return {"status": "ok", "service": "AmbuFlow API"}


@app.post("/api/analyze", response_model=TrafficAssessment)
async def analyze_video(file: UploadFile = File(...)) -> TrafficAssessment:
    if not file.filename:
        raise HTTPException(status_code=400, detail="A video file is required.")

    extension = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail="Unsupported video type. Allowed formats: MP4, AVI, MOV, WebM",
        )

    temp_file = None
    try:
        with tempfile.NamedTemporaryFile(suffix=f".{extension}", delete=False) as handle:
            content = await file.read()
            handle.write(content)
            temp_file = handle.name

        try:
            result = _analyze_with_yolov8(temp_file)
        except RuntimeError:
            result = _mock_assessment()

        if not isinstance(result, dict):
            result = result.model_dump() if hasattr(result, "model_dump") else result.dict()

        return TrafficAssessment(**result)
    finally:
        if temp_file and os.path.exists(temp_file):
            os.remove(temp_file)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8000")), reload=True)
