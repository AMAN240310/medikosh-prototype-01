"""
Stage 1 prompt: turns raw extracted text (from documents and/or voice
transcripts) into the structured JSON the rest of the pipeline consumes.

The prompt text below is used verbatim - only the {{EXTRACTED_TEXT}}
placeholder is substituted. Keeping the literal OUTPUT template inside the
prompt (rather than relying solely on the Gemini responseSchema) means the
prompt is still fully self-describing if a call ever has to fall back to
plain JSON mode without a schema (see GeminiClient._call_once).
"""

STRUCTURING_PROMPT_TEMPLATE = """You are a Medical Data Structuring Assistant.
Convert the provided extracted text from patient documents and voice transcripts into structured medical information.
Rules:

* Use only information clearly present in the provided text.
* Do not guess, invent, or complete missing information.
* If information is unclear, use null.
* Keep patient-reported information separate from document-extracted information.
* For attached documents and lab reports, thoroughly extract every lab investigation, test name, numerical value with units, reference range, and diagnostic observation as individual entries under 'document_extracted.findings' and under 'facts' (with field='recent_lab' or field='document_finding' and source_type='DOCUMENT').
* Correctly detect negations such as "no history of diabetes".
* Correctly identify whether information belongs to the patient or a family member.
* Do not make a diagnosis.
* For every extracted fact, include the exact supporting evidence from the source text.
* Extract medicine names separately so they can be validated using RxNorm.
* Return only valid JSON.

INPUT:
{{EXTRACTED_TEXT}}
OUTPUT:
{
"patient_reported": {
"symptoms": [],
"medical_history": [],
"current_medications": []
},
"document_extracted": {
"findings": [],
"medical_history": [],
"medications": []
},
"medicines_to_validate": [
{
"raw_name": "",
"dosage": null,
"frequency": null,
"evidence": ""
}
],
"uncertain_information": [],
"facts": [
{
"field": "",
"value": null,
"source_type": "VOICE | DOCUMENT",
"evidence": ""
}
]
}"""


def build_structuring_prompt(extracted_text: str) -> str:
    """Substitute the extracted text into the structuring prompt.

    Uses a plain string replace (not str.format) because the prompt's
    OUTPUT template is full of literal { } braces that would otherwise
    need escaping.
    """
    return STRUCTURING_PROMPT_TEMPLATE.replace("{{EXTRACTED_TEXT}}", extracted_text)
