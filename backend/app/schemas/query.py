from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    sql: str = Field(..., min_length=1, max_length=2000)


class QueryResponse(BaseModel):
    columns: list[str]
    rows: list[list]  # each row is a list of values
