import io
import cv2
import numpy as np
from PIL import Image
from engine.nodes.base import BaseNode, Geometry, PipelineContext, VisualGraph, VisualNode
from ultralytics import YOLO


class DecomposeNode(BaseNode):
    def __init__(self, name: str = "DecomposeNode", model_name: str = "yolov8n.pt", confidence: float = 0.5):
        super().__init__(name)
        self.model_name = model_name
        self.confidence = confidence
        print(f"[DEBUG] Loading model: {model_name} (Confidence: {confidence})")
        try:
            if "sam" in model_name.lower():
                from ultralytics import SAM
                actual_model = "sam2-n.pt" if model_name == "sam2" else model_name
                print(f"[DEBUG] Initializing SAM model with {actual_model}")
                self.model = SAM(actual_model)
            else:
                print(f"[DEBUG] Initializing YOLO model with {model_name}")
                self.model = YOLO(model_name)
        except Exception as e:
            print(f"[ERROR] Failed to load model {model_name}. Error: {str(e)}")
            print("[DEBUG] Falling back to yolov8n.pt")
            self.model_name = "yolov8n.pt"
            self.model = YOLO("yolov8n.pt")

    async def process(self, context: PipelineContext) -> PipelineContext:
        image = Image.open(io.BytesIO(context.image_data)).convert("RGB")
        image_np = np.array(image)
        image_cv2 = cv2.cvtColor(image_np, cv2.COLOR_RGB2BGR)

        results = self.model(image_cv2, conf=self.confidence)
        regions = []
        nodes = []

        for result in results:
            boxes = result.boxes
            for i, box in enumerate(boxes):
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = box.conf[0].item()
                cls = int(box.cls[0].item())
                label = self.model.names[cls]
                node_id = f"object_{len(nodes)}"
                coords = {"x1": x1, "y1": y1, "x2": x2, "y2": y2}
                normalized = {
                    "x1": x1 / context.image_width,
                    "y1": y1 / context.image_height,
                    "x2": x2 / context.image_width,
                    "y2": y2 / context.image_height,
                    "center_x": ((x1 + x2) / 2) / context.image_width,
                    "center_y": ((y1 + y2) / 2) / context.image_height,
                    "relative_area": ((x2 - x1) * (y2 - y1)) / (context.image_width * context.image_height),
                }

                region = {
                    "id": i,
                    "node_id": node_id,
                    "label": label,
                    "confidence": conf,
                    "coords": coords,
                }
                regions.append(region)
                nodes.append(
                    VisualNode(
                        id=node_id,
                        kind="object",
                        label=label,
                        confidence=conf,
                        geometry=Geometry(type="bbox", coords=coords, normalized=normalized),
                        provenance={"source": "cv", "node": self.name, "model": self.model_name},
                    )
                )

        context.regions = regions
        context.graph = VisualGraph(
            nodes=nodes,
            edges=context.graph.edges,
            metadata={
                **context.graph.metadata,
                "image_width": context.image_width,
                "image_height": context.image_height,
                "detector_model": self.model_name,
            },
        )
        return context
