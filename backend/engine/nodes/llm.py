import asyncio
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv
from engine.nodes.base import BaseNode, PipelineContext, ValidationResult
from openai import AsyncOpenAI

PROJECT_ROOT = Path(__file__).resolve().parents[3]
load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(PROJECT_ROOT / "backend" / ".env")


def _extract_json_object(text: str) -> Any:
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.lower().startswith("json"):
            stripped = stripped[4:].strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        start = stripped.find("{")
        end = stripped.rfind("}")
        if start != -1 and end != -1 and end > start:
            return json.loads(stripped[start:end + 1])
        raise


def _matches_type(value: Any, expected_type: str) -> bool:
    if expected_type == "object":
        return isinstance(value, dict)
    if expected_type == "array":
        return isinstance(value, list)
    if expected_type == "string":
        return isinstance(value, str)
    if expected_type == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected_type == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected_type == "boolean":
        return isinstance(value, bool)
    if expected_type == "null":
        return value is None
    return True


def _validate_schema(value: Any, schema: Dict[str, Any], path: str = "$") -> List[str]:
    errors: List[str] = []
    expected_type = schema.get("type")
    if isinstance(expected_type, list):
        if not any(_matches_type(value, t) for t in expected_type):
            errors.append(f"{path} must be one of {expected_type}")
            return errors
    elif expected_type and not _matches_type(value, expected_type):
        errors.append(f"{path} must be {expected_type}")
        return errors

    if isinstance(value, dict):
        for required_key in schema.get("required", []):
            if required_key not in value:
                errors.append(f"{path}.{required_key} is required")
        properties = schema.get("properties", {})
        for key, child_schema in properties.items():
            if key in value and isinstance(child_schema, dict):
                errors.extend(_validate_schema(value[key], child_schema, f"{path}.{key}"))
    elif isinstance(value, list) and isinstance(schema.get("items"), dict):
        for idx, item in enumerate(value):
            errors.extend(_validate_schema(item, schema["items"], f"{path}[{idx}]"))

    enum = schema.get("enum")
    if enum and value not in enum:
        errors.append(f"{path} must be one of {enum}")
    return errors


class LLMNode(BaseNode):
    def __init__(
        self,
        name: str = "LLMNode",
        model: str = "gpt-4o-mini",
        prompt_template: str = "",
        output_schema: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(name)
        self.model = model
        self.prompt_template = prompt_template or "Describe the object in this crop and its spatial context."
        self.output_schema = output_schema

        load_dotenv(PROJECT_ROOT / ".env", override=True)
        load_dotenv(PROJECT_ROOT / "backend" / ".env", override=True)
        api_key = os.environ.get("OPENAI_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_KEY is required for VLM analysis. Add it to the project root .env file.")
        self.client = AsyncOpenAI(api_key=api_key)

    async def _process_region(self, region: dict):
        ctx = region.get("context_bundle")
        if not ctx:
            return region

        crop_data_url = f"data:image/jpeg;base64,{ctx['crop_b64']}"
        thumb_data_url = f"data:image/jpeg;base64,{ctx['full_image_thumb_b64']}"
        schema_instruction = ""
        if self.output_schema:
            schema_instruction = (
                "\nReturn ONLY valid JSON matching this JSON Schema. "
                "Do not include markdown or explanatory text.\n"
                f"Schema: {json.dumps(self.output_schema)}"
            )

        user_prompt = f"""
You are a spatial reasoning assistant. Analyze the image crop given its context.

{self.prompt_template}{schema_instruction}

Spatial coordinates (normalized 0-1):
X1: {ctx['spatial_coords']['x1']:.2f}, Y1: {ctx['spatial_coords']['y1']:.2f}
X2: {ctx['spatial_coords']['x2']:.2f}, Y2: {ctx['spatial_coords']['y2']:.2f}
Center: ({ctx['spatial_coords']['center_x']:.2f}, {ctx['spatial_coords']['center_y']:.2f})
Relative area: {ctx['spatial_coords']['relative_area']:.2%}%
This is region {ctx['region_index']} of {ctx['total_regions']}.
"""

        try:
            print(f"[DEBUG] Sending region {ctx['region_index']} to OpenAI...")
            text_format = {"type": "text"}
            if self.output_schema:
                text_format = {
                    "type": "json_schema",
                    "name": "visual_region_analysis",
                    "schema": self.output_schema,
                    "strict": False,
                }

            response = await self.client.responses.create(
                model=self.model,
                input=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "input_text", "text": user_prompt},
                            {"type": "input_image", "image_url": crop_data_url, "detail": "auto"},
                            {"type": "input_text", "text": "Here is the full thumbnail for broader context:"},
                            {"type": "input_image", "image_url": thumb_data_url, "detail": "low"},
                        ],
                    }
                ],
                text={"format": text_format},
            )
            text = response.output_text or ""
            if self.output_schema:
                structured = _extract_json_object(text)
                validation_errors = _validate_schema(structured, self.output_schema)
                region["semantic_attributes"] = structured
                region["validation"] = {
                    "status": "valid" if not validation_errors else "invalid",
                    "errors": validation_errors,
                }
            else:
                region["semantic_attributes"] = {"summary": text.strip()}
                region["validation"] = {"status": "unvalidated", "errors": []}
            region["llm_analysis"] = text
        except Exception as e:
            import traceback
            print(f"[ERROR] OpenAI request failed for region {ctx['region_index']}:")
            traceback.print_exc()
            region["semantic_attributes"] = {}
            region["validation"] = {"status": "error", "errors": [str(e)]}
            region["llm_analysis"] = f"Error: {str(e)}"

        return region

    async def process(self, context: PipelineContext) -> PipelineContext:
        print(f"[DEBUG] Starting LLM Node with OpenAI model: {self.model}")
        tasks = [self._process_region(region) for region in context.regions]
        context.regions = await asyncio.gather(*tasks)

        region_by_node_id = {region.get("node_id"): region for region in context.regions}
        for node in context.graph.nodes:
            region = region_by_node_id.get(node.id)
            if not region:
                continue
            node.attributes["semantics"] = region.get("semantic_attributes", {})
            node.provenance["semantic_source"] = {"source": "vlm", "node": self.name, "model": self.model}
            validation = region.get("validation") or {"status": "unvalidated", "errors": []}
            node.validation = ValidationResult(**validation)
        return context
