# AmbuFlow

AmbuFlow is a responsive prototype for an AI ambulance traffic priority and route optimization dashboard. It combines an interactive traffic-signal dashboard with a FastAPI backend that runs YOLOv8-based object detection on uploaded traffic videos.

## Features

- Traffic video upload for MP4, AVI, MOV, and WebM videos
- Real YOLOv8 inference using ByteTrack tracking for candidate vehicle detections
- Ambulance detection summary with confidence, count, and direction
- Simulated four-way traffic signal logic
- Emergency priority activation for 30 seconds, followed by a normal cycle with each direction green for 60 seconds
- Visible countdown until the active signal phase changes
- Live Tracking route simulation with continuous ambulance movement, junction geofences, and green-corridor priority
- Congestion monitoring by lane
- Route optimization view for hospital selection

## Live route simulation

In the Live Tracking panel, use **DISPATCH AMBULANCE** to run the same deterministic route from START through four junctions to City General Hospital. The ambulance marker is interpolated on each route leg with `requestAnimationFrame` at a configurable 40 km/h. Junction priority activates 100 m before each junction using the direction of the route segment, releases after crossing, and is restored to normal at arrival. **STOP** pauses the trip and releases priority; **RESET** returns the ambulance to START so the route can be demonstrated again.

## YOLOv8 setup

The backend attempts to use a custom ambulance model if you provide one at `models/ambulance.pt` or through the `AMBULANCE_MODEL_PATH` environment variable. If that model is not present, it falls back to the standard `yolov8n.pt` model for general vehicle detection and keeps the app functional in demo mode.

## Run locally

1. Create and activate a virtual environment (optional but recommended)
2. Install dependencies:

   pip install -r requirements.txt

3. Start the server:

   python main.py

4. Open the app in a browser:

   http://localhost:8000/

## API

- GET /health – health check
- POST /api/analyze – uploads a traffic video and returns YOLOv8-assisted detection metadata

## Notes

This is a software-only prototype. For production-grade ambulance detection, replace the default model with a specialized ambulance dataset and tune the confidence thresholds for your camera geometry and traffic conditions.
