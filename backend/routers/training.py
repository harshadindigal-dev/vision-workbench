from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import os
import shutil
import uuid
import json
import asyncio
import base64
import glob
import time
from pathlib import Path
from ultralytics import YOLO
import yaml
from dotenv import load_dotenv
from openai import AsyncOpenAI
from PIL import Image
import io

PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(PROJECT_ROOT / "backend" / ".env")

router = APIRouter(prefix="/api/training", tags=["training"])

training_status = {
    "status": "idle",
    "progress": 0.0,
    "message": "",
    "model_name": None
}

DATASET_DIR = os.path.abspath("datasets/current")
MODELS_DIR = os.path.abspath("custom_models")
AUTO_LABEL_MIN_INTERVAL_SECONDS = 1.0
_auto_label_lock = asyncio.Lock()
_last_auto_label_at = 0.0


def setup_dirs():
    os.makedirs(os.path.join(DATASET_DIR, "images", "train"), exist_ok=True)
    os.makedirs(os.path.join(DATASET_DIR, "labels", "train"), exist_ok=True)
    os.makedirs(MODELS_DIR, exist_ok=True)


setup_dirs()


class AnnotationBox(BaseModel):
    x_center: float
    y_center: float
    width: float
    height: float
    class_name: str
    confidence: Optional[float] = None
    source: Optional[str] = None


class AnnotationRequest(BaseModel):
    image_filename: str
    boxes: List[AnnotationBox]


class AutoAnnotateRequest(BaseModel):
    image_filename: str
    box: AnnotationBox


class PreAnnotateRequest(BaseModel):
    image_filename: str
    model_name: Optional[str] = None
    confidence: float = 0.25


def _safe_dataset_image_path(filename: str) -> str:
    safe_name = os.path.basename(filename)
    path = os.path.abspath(os.path.join(DATASET_DIR, "images", "train", safe_name))
    image_root = os.path.abspath(os.path.join(DATASET_DIR, "images", "train"))
    if not path.startswith(image_root + os.sep):
        raise HTTPException(status_code=400, detail="Invalid image filename")
    return path


def _get_openai_client():
    load_dotenv(PROJECT_ROOT / ".env", override=True)
    load_dotenv(PROJECT_ROOT / "backend" / ".env", override=True)
    api_key = os.environ.get("OPENAI_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="OPENAI_KEY is required for auto-labeling. Add it to the project root .env file.")
    return AsyncOpenAI(api_key=api_key)


async def _wait_for_auto_label_slot():
    global _last_auto_label_at
    async with _auto_label_lock:
        elapsed = time.monotonic() - _last_auto_label_at
        wait_for = AUTO_LABEL_MIN_INTERVAL_SECONDS - elapsed
        if wait_for > 0:
            await asyncio.sleep(wait_for)
        _last_auto_label_at = time.monotonic()


def _default_detector_model() -> str:
    custom_models = glob.glob(os.path.join(MODELS_DIR, "*", "weights", "best.pt"))
    if custom_models:
        return sorted(custom_models)[-1]
    return "yolov8n.pt"


@router.post("/dataset/upload")
async def upload_image(file: UploadFile = File(...)):
    try:
        filename = os.path.basename(file.filename or f"{uuid.uuid4()}.jpg")
        file_path = os.path.join(DATASET_DIR, "images", "train", filename)
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
        return {"status": "success", "filename": filename}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/dataset/images")
def list_dataset_images():
    image_dir = os.path.join(DATASET_DIR, "images", "train")
    label_dir = os.path.join(DATASET_DIR, "labels", "train")
    if not os.path.exists(image_dir):
        return []

    result = []
    for f in os.listdir(image_dir):
        if f.lower().endswith((".png", ".jpg", ".jpeg")):
            txt_file = os.path.splitext(f)[0] + ".txt"
            is_annotated = os.path.exists(os.path.join(label_dir, txt_file))
            result.append({"filename": f, "annotated": is_annotated})

    return result


@router.get("/dataset/classes")
def get_classes():
    classes_file = os.path.join(DATASET_DIR, "classes.json")
    if os.path.exists(classes_file):
        with open(classes_file, "r") as f:
            return json.load(f)
    return {}


@router.get("/dataset/annotations/{filename}")
def get_annotations(filename: str):
    txt_filename = os.path.splitext(os.path.basename(filename))[0] + ".txt"
    txt_path = os.path.join(DATASET_DIR, "labels", "train", txt_filename)

    if not os.path.exists(txt_path):
        return {"boxes": []}

    classes_file = os.path.join(DATASET_DIR, "classes.json")
    if os.path.exists(classes_file):
        with open(classes_file, "r") as f:
            class_map = json.load(f)
    else:
        class_map = {}

    id_to_class = {str(v): k for k, v in class_map.items()}

    boxes = []
    with open(txt_path, "r") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) == 5:
                cid, x, y, w, h = parts
                boxes.append({
                    "id": str(uuid.uuid4()),
                    "class_name": id_to_class.get(cid, "unknown"),
                    "x_center": float(x),
                    "y_center": float(y),
                    "width": float(w),
                    "height": float(h),
                    "source": "human"
                })

    return {"boxes": boxes}


@router.post("/dataset/annotate")
def save_annotations(request: AnnotationRequest):
    classes_file = os.path.join(DATASET_DIR, "classes.json")

    if os.path.exists(classes_file):
        with open(classes_file, "r") as f:
            class_map = json.load(f)
    else:
        class_map = {}

    next_class_id = len(class_map)
    txt_filename = os.path.splitext(os.path.basename(request.image_filename))[0] + ".txt"
    txt_path = os.path.join(DATASET_DIR, "labels", "train", txt_filename)

    lines = []
    for box in request.boxes:
        cname = box.class_name.lower().strip()
        if not cname:
            continue
        if cname not in class_map:
            class_map[cname] = next_class_id
            next_class_id += 1

        cid = class_map[cname]
        lines.append(f"{cid} {box.x_center} {box.y_center} {box.width} {box.height}")

    with open(txt_path, "w") as f:
        f.write("\n".join(lines))

    with open(classes_file, "w") as f:
        json.dump(class_map, f)

    return {"status": "success", "classes": class_map}


@router.post("/dataset/pre-annotate")
def pre_annotate(request: PreAnnotateRequest):
    file_path = _safe_dataset_image_path(request.image_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Image not found")

    model_name = request.model_name or _default_detector_model()
    try:
        image = Image.open(file_path).convert("RGB")
        w, h = image.size
        model = YOLO(model_name)
        results = model(file_path, conf=request.confidence)
        boxes = []
        for result in results:
            for box in result.boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = box.conf[0].item()
                cls = int(box.cls[0].item())
                boxes.append({
                    "id": str(uuid.uuid4()),
                    "x_center": ((x1 + x2) / 2) / w,
                    "y_center": ((y1 + y2) / 2) / h,
                    "width": (x2 - x1) / w,
                    "height": (y2 - y1) / h,
                    "class_name": model.names[cls],
                    "confidence": conf,
                    "source": "model"
                })
        return {"status": "success", "model": model_name, "boxes": boxes}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/dataset/auto-annotate")
async def auto_annotate(request: AutoAnnotateRequest):
    file_path = _safe_dataset_image_path(request.image_filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Image not found")

    await _wait_for_auto_label_slot()

    try:
        image = Image.open(file_path).convert("RGB")
        w, h = image.size

        x_center = request.box.x_center * w
        y_center = request.box.y_center * h
        width = request.box.width * w
        height = request.box.height * h

        left = max(0, int(x_center - width / 2))
        top = max(0, int(y_center - height / 2))
        right = min(w, int(x_center + width / 2))
        bottom = min(h, int(y_center + height / 2))

        crop = image.crop((left, top, right, bottom))

        buf = io.BytesIO()
        crop.save(buf, format="JPEG")
        crop_bytes = buf.getvalue()

        client = _get_openai_client()
        prompt = "Extract the text from this image crop to determine the room type or object class. Reply ONLY with the brief classification (e.g., 'Master Bedroom', 'Door', 'Stairs'). Do not use punctuation."
        crop_data_url = f"data:image/jpeg;base64,{base64.b64encode(crop_bytes).decode('utf-8')}"

        response = await client.responses.create(
            model="gpt-4o-mini",
            input=[
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": prompt},
                        {"type": "input_image", "image_url": crop_data_url, "detail": "auto"},
                    ],
                }
            ],
            max_output_tokens=30,
        )

        label = (response.output_text or "").strip().lower()
        return {"status": "success", "label": label}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


def _run_training(model_name: str, epochs: int):
    global training_status
    try:
        training_status["status"] = "running"
        training_status["message"] = "Generating dataset.yaml..."

        classes_file = os.path.join(DATASET_DIR, "classes.json")
        if not os.path.exists(classes_file):
            raise Exception("No annotations found. Cannot start training.")

        with open(classes_file, "r") as f:
            class_map = json.load(f)

        names_dict = {v: k for k, v in class_map.items()}

        yaml_path = os.path.join(DATASET_DIR, "dataset.yaml")
        yaml_content = {
            "path": DATASET_DIR,
            "train": "images/train",
            "val": "images/train",
            "names": names_dict
        }

        with open(yaml_path, "w") as f:
            yaml.dump(yaml_content, f, default_flow_style=False)

        training_status["message"] = f"Training YOLOv8 on {len(names_dict)} classes for {epochs} epochs..."
        model = YOLO("yolov8n.pt")
        model.train(
            data=yaml_path,
            epochs=epochs,
            imgsz=640,
            project=MODELS_DIR,
            name=model_name,
            exist_ok=True
        )

        training_status["status"] = "completed"
        training_status["message"] = f"Training completed. Model saved as {model_name}."

    except Exception as e:
        import traceback
        traceback.print_exc()
        training_status["status"] = "error"
        training_status["message"] = str(e)


@router.post("/start")
async def start_training(model_name: str = Form("custom_model"), epochs: int = Form(50)):
    global training_status
    if training_status["status"] == "running":
        raise HTTPException(status_code=400, detail="Training already in progress.")

    training_status["model_name"] = model_name
    loop = asyncio.get_event_loop()
    loop.run_in_executor(None, _run_training, model_name, epochs)

    return {"status": "started", "model_name": model_name}


@router.get("/status")
def get_training_status():
    return training_status


@router.get("/models")
def list_custom_models():
    models = []
    search_path = os.path.join(MODELS_DIR, "*", "weights", "best.pt")
    for pt_file in glob.glob(search_path):
        parts = pt_file.split(os.sep)
        if len(parts) >= 3:
            model_name = parts[-3]
            models.append({"id": model_name, "path": pt_file})
    return models
