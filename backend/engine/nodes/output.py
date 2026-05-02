from engine.nodes.base import BaseNode, PipelineContext

class OutputNode(BaseNode):
    def __init__(self, name: str = "OutputNode"):
        super().__init__(name)

    async def process(self, context: PipelineContext) -> PipelineContext:
        # Here we could format the output to JSON, COCO, etc.
        # For now, we just clean up the base64 images so the final JSON response isn't huge.
        for region in context.regions:
            if "context_bundle" in region:
                # Remove base64 strings before returning the final response
                region["context_bundle"].pop("crop_b64", None)
                region["context_bundle"].pop("full_image_thumb_b64", None)
        return context
