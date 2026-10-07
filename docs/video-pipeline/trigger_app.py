"""Proxy-auth trigger for the cloud lesson-video pipeline.

Deployed together with the orchestrator (``modal deploy
docs/video-pipeline/modal_app.py``), which imports this module to register the
endpoint on the shared ``uff-lesson-video`` app.

Modal imports the module that *defines* a function inside that function's
container. The trigger container installs only ``fastapi[standard]``, so this
module must import nothing from the heavy pipeline (no moviepy/cv2/modal
deps): the orchestrator is reached by name at call time instead.
"""

from __future__ import annotations

import modal
from fastapi import HTTPException

# Same app name as before, so the deployed URL (MODAL_RENDER_URL) is unchanged.
app = modal.App("uff-lesson-video")

trigger_image = modal.Image.debian_slim(python_version="3.12").pip_install("fastapi[standard]")


@app.function(image=trigger_image)
@modal.fastapi_endpoint(method="POST", requires_proxy_auth=True)
def trigger(spec: dict):
    """Validate a render request and spawn the orchestrator (returns immediately)."""
    if not isinstance(spec, dict) or not spec.get("jobId") or not spec.get("files"):
        raise HTTPException(status_code=400, detail="spec requires jobId and files")
    # Resolve the orchestrator by name: this module cannot import its definition
    # (the orchestrator image carries the pipeline; this one only has fastapi).
    modal.Function.from_name("uff-lesson-video", "orchestrator").spawn(spec)
    return {"jobId": spec["jobId"]}
