from fastapi import FastAPI, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import json
from engine import Pipeline
from engine.nodes.base import PipelineContext
from engine.nodes.decompose import DecomposeNode
from engine.nodes.context import ContextNode
from engine.nodes.llm import LLMNode
from engine.nodes.output import OutputNode
from PIL import Image
import io

from fastapi.staticfiles import StaticFiles
from routers import training

app = FastAPI(title="CV+LLM Pipeline Builder API")

app.include_router(training.router)

import os
os.makedirs("datasets/current/images/train", exist_ok=True)
app.mount("/datasets/images/train", StaticFiles(directory="datasets/current/images/train"), name="dataset_images")

def dump_model(model):
    if hasattr(model, "model_dump"):
        return model.model_dump()
    return model.dict()


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/pipeline/run")
async def run_pipeline(
    file: UploadFile = File(...),
    pipeline_config: str = Form(...)
):
    config = json.loads(pipeline_config)
    
    # Read image
    image_bytes = await file.read()
    image = Image.open(io.BytesIO(image_bytes))
    w, h = image.size
    
    context = PipelineContext(
        image_data=image_bytes,
        image_width=w,
        image_height=h
    )
    
    nodes = []
    # Build pipeline from config (simplified for now)
    for node_cfg in config.get("nodes", []):
        node_type = node_cfg.get("type")
        if node_type == "decompose":
            nodes.append(DecomposeNode(
                model_name=node_cfg.get("model", "yolov8n.pt"),
                confidence=node_cfg.get("confidence", 0.5)
            ))
        elif node_type == "context":
            nodes.append(ContextNode())
        elif node_type == "llm":
            output_schema = None
            schema_raw = node_cfg.get("schema")
            if schema_raw:
                output_schema = json.loads(schema_raw) if isinstance(schema_raw, str) else schema_raw
            nodes.append(LLMNode(
                prompt_template=node_cfg.get("prompt", "Describe this object."),
                output_schema=output_schema
            ))
        elif node_type == "output":
            nodes.append(OutputNode())
            
    # Default pipeline if none provided
    if not nodes:
        nodes = [
            DecomposeNode(confidence=0.5),
            ContextNode(),
            LLMNode(),
            OutputNode()
        ]
        
    print("\n" + "="*50)
    print(f"[DEBUG] Received request to run pipeline with {len(nodes)} nodes.")
    print("="*50)

    try:
        pipeline = Pipeline(nodes)
        print("[DEBUG] Starting pipeline execution...")
        result = await pipeline.run(context)
        print("[DEBUG] Pipeline execution completed successfully.")
        return {
            "status": "success",
            "regions": result.regions,
            "graph": dump_model(result.graph)
        }
    except Exception as e:
        import traceback
        print(f"\n[ERROR] Pipeline execution failed:")
        traceback.print_exc()
        return {
            "status": "error",
            "message": str(e)
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
