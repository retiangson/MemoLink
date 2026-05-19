from sqlalchemy.types import UserDefinedType


class VectorType(UserDefinedType):
    def __init__(self, dim: int):
        self.dim = dim

    def get_col_spec(self, **kw):
        return f"vector({self.dim})"

    def bind_processor(self, dialect):
        def process(value):
            if value is None:
                return None
            return "[" + ",".join(str(v) for v in value) + "]"
        return process

    def result_processor(self, dialect, coltype):
        def process(value):
            if value is None:
                return None
            value = value.strip("[]")
            return [float(x) for x in value.split(",")]
        return process
