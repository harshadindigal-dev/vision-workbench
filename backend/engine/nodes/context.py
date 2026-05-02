import io
from PIL import Image
import base64
from engine.nodes.base import BaseNode, PipelineContext

class ContextNode(BaseNode):
    def __init__(self, name: str = "ContextNode", thumbnail_size: int = 256):
        super().__init__(name)
        self.thumbnail_size = thumbnail_size

    def _image_to_base64(self, img: Image.Image) -> str:
        buffered = io.BytesIO()
        img.save(buffered, format="JPEG")
        return base64.b64encode(buffered.getvalue()).decode('utf-8')

    async def process(self, context: PipelineContext) -> PipelineContext:
        image = Image.open(io.BytesIO(context.image_data)).convert("RGB")
        w, h = image.size
        
        # Create full image thumbnail
        thumb = image.copy()
        thumb.thumbnail((self.thumbnail_size, self.thumbnail_size))
        thumb_b64 = self._image_to_base64(thumb)
        
        # Add context to each region
        for region in context.regions:
            coords = region["coords"]
            # Crop region
            crop = image.crop((coords["x1"], coords["y1"], coords["x2"], coords["y2"]))
            crop_b64 = self._image_to_base64(crop)
            
            # Normalized coordinates
            norm_coords = {
                "x1": coords["x1"] / w,
                "y1": coords["y1"] / h,
                "x2": coords["x2"] / w,
                "y2": coords["y2"] / h,
                "center_x": ((coords["x1"] + coords["x2"]) / 2) / w,
                "center_y": ((coords["y1"] + coords["y2"]) / 2) / h,
                "relative_area": ((coords["x2"] - coords["x1"]) * (coords["y2"] - coords["y1"])) / (w * h)
            }
            
            region["context_bundle"] = {
                "crop_b64": crop_b64,
                "full_image_thumb_b64": thumb_b64,
                "spatial_coords": norm_coords,
                "region_index": region["id"],
                "total_regions": len(context.regions)
            }
        
        return context
