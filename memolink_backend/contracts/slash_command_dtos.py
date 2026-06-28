import base64
import binascii
from typing import Optional
from pydantic import BaseModel, Field, field_validator

class SlashCommandRequestDTO(BaseModel):
    command: str                         # full text, e.g. "/Improve All"
    user_id: Optional[int] = None
    conversation_id: Optional[int] = None
    workspace_id: Optional[int] = None
    model: Optional[str] = None


class EquationSolveRequestDTO(BaseModel):
    note_id: int
    model: Optional[str] = None
    drawing_image_data_url: Optional[str] = Field(default=None, max_length=2_000_000)
    drawing_spacing_lines: int = Field(default=0, ge=0, le=80)

    @field_validator("drawing_image_data_url")
    @classmethod
    def validate_drawing_image(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        if not value.startswith(("data:image/png;base64,", "data:image/jpeg;base64,")):
            raise ValueError("Drawing image must be a PNG or JPEG data URL")
        try:
            base64.b64decode(value.split(",", 1)[1], validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("Drawing image contains invalid base64 data") from exc
        return value
