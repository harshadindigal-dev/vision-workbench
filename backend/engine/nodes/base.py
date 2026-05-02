from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class Geometry(BaseModel):
    type: str = "bbox"
    coords: Dict[str, float]
    normalized: Dict[str, float] = Field(default_factory=dict)


class ValidationResult(BaseModel):
    status: str = "unvalidated"
    errors: List[str] = Field(default_factory=list)


class VisualNode(BaseModel):
    id: str
    kind: str = "object"
    label: str
    confidence: float = 0.0
    geometry: Geometry
    attributes: Dict[str, Any] = Field(default_factory=dict)
    provenance: Dict[str, Any] = Field(default_factory=dict)
    validation: ValidationResult = Field(default_factory=ValidationResult)


class VisualEdge(BaseModel):
    source: str
    target: str
    relation: str
    confidence: float = 1.0
    attributes: Dict[str, Any] = Field(default_factory=dict)


class VisualGraph(BaseModel):
    nodes: List[VisualNode] = Field(default_factory=list)
    edges: List[VisualEdge] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class PipelineContext(BaseModel):
    image_data: bytes
    image_width: int
    image_height: int
    regions: List[Dict[str, Any]] = Field(default_factory=list)
    graph: VisualGraph = Field(default_factory=VisualGraph)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class BaseNode(ABC):
    def __init__(self, name: str):
        self.name = name

    @abstractmethod
    async def process(self, context: PipelineContext) -> PipelineContext:
        pass
