"""
Extract timelines from browser screen recordings, surface interaction hints via frame differencing,
and optionally ask a VLM which UI element likely changed between consecutive samples.
"""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np
from dotenv import load_dotenv
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from openai import AsyncOpenAI
from ultralytics import YOLO

PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(BACKEND_ROOT / ".env")

router = APIRouter(prefix="/api/browser-session", tags=["browser-session"])

SESSION_ROOT = BACKEND_ROOT / "tmp_browser_sessions"
SESSION_ROOT.mkdir(parents=True, exist_ok=True)

MAX_DURATION_SEC = 180.0
MAX_SAMPLES = 72
DEFAULT_SAMPLE_INTERVAL = 0.45

_yolo_singleton: Tuple[Optional[YOLO], Optional[str]] = (None, None)


def _get_yolo(model_name: str = "yolov8n.pt") -> YOLO:
    global _yolo_singleton
    model, cached = _yolo_singleton
    if model is None or cached != model_name:
        model = YOLO(model_name)
        _yolo_singleton = (model, model_name)
    return model


def _jpeg_data_url(frame_bgr: np.ndarray, max_side: int = 960) -> str:
    import base64

    h, w = frame_bgr.shape[:2]
    scale = min(1.0, max_side / max(h, w))
    if scale < 1.0:
        frame_bgr = cv2.resize(frame_bgr, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", frame_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 82])
    if not ok:
        raise RuntimeError("failed to encode jpeg")
    b64 = base64.standard_b64encode(buf.tobytes()).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def _run_detector_on_frame(frame_bgr: np.ndarray, model_name: str, confidence: float) -> Tuple[List[Dict[str, Any]], int, int]:
    model = _get_yolo(model_name)
    h, w = frame_bgr.shape[:2]
    results = model(frame_bgr, conf=confidence, verbose=False)
    detections: List[Dict[str, Any]] = []
    for result in results:
        boxes = result.boxes
        if boxes is None:
            continue
        for box in boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            conf = float(box.conf[0].item())
            cls = int(box.cls[0].item())
            label = model.names[cls]
            detections.append(
                {
                    "label": label,
                    "confidence": conf,
                    "bbox_xyxy": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)],
                    "bbox_norm": {
                        "x1": round(x1 / w, 5),
                        "y1": round(y1 / h, 5),
                        "x2": round(x2 / w, 5),
                        "y2": round(y2 / h, 5),
                    },
                }
            )
    return detections, w, h


def _sample_gray_small(frame_bgr: np.ndarray, side: int = 160) -> np.ndarray:
    gray = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2GRAY)
    return cv2.resize(gray, (side, side), interpolation=cv2.INTER_AREA)


def _pair_diff_score(a_bgr: np.ndarray, b_bgr: np.ndarray) -> float:
    ga = _sample_gray_small(a_bgr).astype(np.float32) / 255.0
    gb = _sample_gray_small(b_bgr).astype(np.float32) / 255.0
    return float(np.mean(np.abs(ga - gb)))


async def _explain_transition_vlm(
    client: AsyncOpenAI,
    model: str,
    before_url: str,
    after_url: str,
    detections_before: List[Dict[str, Any]],
    detections_after: List[Dict[str, Any]],
) -> Dict[str, Any]:
    schema = {
        "type": "object",
        "properties": {
            "likely_clicked_description": {"type": "string"},
            "confidence_0_to_1": {"type": "number"},
            "change_summary": {"type": "string"},
            "matched_detection_label_after": {"type": ["string", "null"]},
        },
        "required": ["likely_clicked_description", "confidence_0_to_1", "change_summary"],
    }
    ctx = json.dumps({"detections_before": detections_before[:40], "detections_after": detections_after[:40]})[:12000]
    prompt = (
        "Two consecutive frames from a screen recording (browser UI). "
        "Infer what interactive element was most likely clicked or activated between BEFORE and AFTER. "
        "Use the detection lists only as hints (generic detector labels may be wrong for UI). "
        f"Context JSON (truncated):\n{ctx}\n\n"
        "Respond with JSON only via schema."
    )

    response = await client.responses.create(
        model=model,
        input=[
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_text", "text": "BEFORE"},
                    {"type": "input_image", "image_url": before_url, "detail": "high"},
                    {"type": "input_text", "text": "AFTER"},
                    {"type": "input_image", "image_url": after_url, "detail": "high"},
                ],
            }
        ],
        text={
            "format": {
                "type": "json_schema",
                "name": "click_inference",
                "schema": schema,
                "strict": False,
            }
        },
    )
    raw = response.output_text or "{}"
    try:
        return json.loads(raw.strip())
    except json.JSONDecodeError:
        start, end = raw.find("{"), raw.rfind("}")
        if start != -1 and end > start:
            return json.loads(raw[start : end + 1])
        return {"likely_clicked_description": raw.strip(), "confidence_0_to_1": 0.0, "change_summary": "parse_error"}


@router.post("/analyze")
async def analyze_recording(
    file: UploadFile = File(...),
    sample_interval_seconds: float = Form(DEFAULT_SAMPLE_INTERVAL),
    detector_model: str = Form("yolov8n.pt"),
    detector_confidence: float = Form(0.35),
    use_vlm: str = Form("false"),
    max_vlm_hints: int = Form(6),
    vlm_model: str = Form("gpt-4o-mini"),
):
    """
    Upload a screen recording (mp4/webm/mov). Returns sampled timeline with generic detections,
    frame-diff interaction hints, and optional VLM explanations for the strongest transitions.
    """
    use_vlm_flag = str(use_vlm).lower() in ("true", "1", "yes", "on")

    suffix = Path(file.filename or "recording.bin").suffix.lower()
    if suffix not in {".mp4", ".webm", ".mov", ".mkv", ".avi"}:
        raise HTTPException(status_code=400, detail=f"Unsupported video type {suffix or '(none)'}")

    raw = await file.read()
    if len(raw) > 450 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Video too large (max ~450MB for this MVP).")

    session_id = uuid.uuid4().hex
    session_dir = SESSION_ROOT / session_id
    session_dir.mkdir(parents=True, exist_ok=True)
    video_path = session_dir / f"video{suffix}"
    video_path.write_bytes(raw)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail="Could not open video (codec/path).")

    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = frame_count / fps if fps > 0 else 0.0
    if duration > MAX_DURATION_SEC:
        cap.release()
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(
            status_code=400,
            detail=f"Video longer than {MAX_DURATION_SEC}s not supported in this MVP (got ~{duration:.1f}s).",
        )

    interval = max(0.15, min(3.0, float(sample_interval_seconds)))
    frame_stride = max(1, int(round(fps * interval)))

    timeline: List[Dict[str, Any]] = []
    frames_cache: List[np.ndarray] = []

    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % frame_stride == 0:
            if len(frames_cache) >= MAX_SAMPLES:
                break
            t = idx / fps if fps > 0 else 0.0
            frames_cache.append(frame.copy())
            det, fw, fh = _run_detector_on_frame(frame, detector_model, detector_confidence)
            timeline.append(
                {
                    "t_seconds": round(t, 4),
                    "frame_index_sample": len(timeline),
                    "width": fw,
                    "height": fh,
                    "detections": det,
                }
            )
        idx += 1

    cap.release()

    if len(timeline) < 2:
        shutil.rmtree(session_dir, ignore_errors=True)
        raise HTTPException(status_code=400, detail="Not enough frames sampled — video may be too short.")

    scores: List[float] = []
    for i in range(len(frames_cache) - 1):
        scores.append(_pair_diff_score(frames_cache[i], frames_cache[i + 1]))

    order = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)
    top_k = min(max(1, int(max_vlm_hints)), len(scores))
    hint_limit = min(16, len(scores))

    interaction_hints: List[Dict[str, Any]] = []
    for i in order[:hint_limit]:
        interaction_hints.append(
            {
                "pair_index": i,
                "t_before": timeline[i]["t_seconds"],
                "t_after": timeline[i + 1]["t_seconds"],
                "frame_diff_score": round(float(scores[i]), 6),
            }
        )

    learned_events: List[Dict[str, Any]] = []

    if use_vlm_flag:
        api_key = os.environ.get("OPENAI_KEY")
        if not api_key:
            shutil.rmtree(session_dir, ignore_errors=True)
            raise HTTPException(status_code=400, detail="OPENAI_KEY is required when use_vlm=true.")
        client = AsyncOpenAI(api_key=api_key)
        sem = asyncio.Semaphore(3)

        async def run_one(pair_idx: int) -> Dict[str, Any]:
            async with sem:
                before = frames_cache[pair_idx]
                after = frames_cache[pair_idx + 1]
                before_url = _jpeg_data_url(before)
                after_url = _jpeg_data_url(after)
                det_b = timeline[pair_idx]["detections"]
                det_a = timeline[pair_idx + 1]["detections"]
                try:
                    vlm = await _explain_transition_vlm(client, vlm_model, before_url, after_url, det_b, det_a)
                    status = "ok"
                except Exception as e:
                    vlm = {"error": str(e)}
                    status = "error"
                return {
                    "t_before": timeline[pair_idx]["t_seconds"],
                    "t_after": timeline[pair_idx + 1]["t_seconds"],
                    "pair_index": pair_idx,
                    "frame_diff_score": round(float(scores[pair_idx]), 6),
                    "vlm_status": status,
                    "vlm": vlm,
                }

        tasks = [run_one(i) for i in order[:top_k]]
        learned_events = await asyncio.gather(*tasks)

    # Persist thumbnails for debugging / future endpoints
    thumbs_dir = session_dir / "thumbs"
    thumbs_dir.mkdir(exist_ok=True)
    for i, frame in enumerate(frames_cache):
        cv2.imwrite(str(thumbs_dir / f"{i:04d}.jpg"), frame)

    meta_path = session_dir / "timeline_meta.json"
    meta_path.write_text(json.dumps({"timeline": timeline, "interaction_hints": interaction_hints}, indent=2))

    return {
        "status": "success",
        "session_id": session_id,
        "duration_seconds": round(duration, 3),
        "fps": round(fps, 4),
        "sample_interval_seconds": round(interval, 4),
        "frame_stride": frame_stride,
        "samples": len(timeline),
        "detector_model": detector_model,
        "timeline": timeline,
        "interaction_hints": interaction_hints,
        "learned_events": learned_events,
        "notes": (
            "Hints rank visual discontinuity — not ground-truth clicks. "
            "Pair with DOM logs or cursor tracking later for supervision. "
            "YOLO labels are generic (COCO); VLM explanations aim at UI semantics."
        ),
    }


@router.delete("/session/{session_id}")
async def delete_session(session_id: str):
    """Remove extracted frames for a session."""
    safe = "".join(c for c in session_id if c in "abcdef0123456789")
    if len(safe) != len(session_id) or len(safe) < 16:
        raise HTTPException(status_code=400, detail="Invalid session id")
    path = SESSION_ROOT / safe
    if path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
        return {"status": "deleted", "session_id": safe}
    raise HTTPException(status_code=404, detail="Session not found")
