from typing import List, Type
from engine.nodes.base import BaseNode, PipelineContext

class Pipeline:
    def __init__(self, nodes: List[BaseNode]):
        self.nodes = nodes

    async def run(self, context: PipelineContext) -> PipelineContext:
        current_context = context
        for node in self.nodes:
            print(f"Running node: {node.name}")
            current_context = await node.process(current_context)
        return current_context
