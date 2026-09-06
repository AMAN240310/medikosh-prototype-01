"""
Gemini `responseSchema` for the stage-1 structuring call, matching
StructuredExtraction exactly. Passing this alongside responseMimeType:
application/json makes Gemini's JSON-mode decoding conform to this exact
shape instead of just "some valid JSON".

Gemini Developer API schemas use upper-case type names (STRING, OBJECT,
ARRAY, ...) - this differs from the lower-case OpenAPI-style types used by
Vertex AI's REST surface, so don't reuse this schema as-is if you ever
switch from generativelanguage.googleapis.com to calling Vertex instead.
"""

_STRING = {"type": "STRING"}
_NULLABLE_STRING = {"type": "STRING", "nullable": True}
_STRING_ARRAY = {"type": "ARRAY", "items": _STRING}

STRUCTURING_RESPONSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "patient_reported": {
            "type": "OBJECT",
            "properties": {
                "symptoms": _STRING_ARRAY,
                "medical_history": _STRING_ARRAY,
                "current_medications": _STRING_ARRAY,
            },
            "required": ["symptoms", "medical_history", "current_medications"],
        },
        "document_extracted": {
            "type": "OBJECT",
            "properties": {
                "findings": _STRING_ARRAY,
                "medical_history": _STRING_ARRAY,
                "medications": _STRING_ARRAY,
            },
            "required": ["findings", "medical_history", "medications"],
        },
        "medicines_to_validate": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "raw_name": _STRING,
                    "dosage": _NULLABLE_STRING,
                    "frequency": _NULLABLE_STRING,
                    "evidence": _STRING,
                },
                "required": ["raw_name", "evidence"],
            },
        },
        "uncertain_information": _STRING_ARRAY,
        "facts": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "field": _STRING,
                    "value": _NULLABLE_STRING,
                    "source_type": {"type": "STRING", "enum": ["VOICE", "DOCUMENT"]},
                    "evidence": _STRING,
                },
                "required": ["field", "source_type", "evidence"],
            },
        },
    },
    "required": [
        "patient_reported",
        "document_extracted",
        "medicines_to_validate",
        "uncertain_information",
        "facts",
    ],
}
