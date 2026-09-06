#!/usr/bin/env python3
"""
Vertex Meal Iteration Orchestrator

Workflow:
1. Loads Vertex SA credentials from ~/.config/aider/vertex.env.
2. Runs Playwright soak test for LIVE_MEAL_EDIT using meal photo /workspace/meal-tawar-nilai-web.jpg.
3. Downloads / archives debug artifacts into /workspace/gemini38-meal-review-round3/.
4. Diagnoses failure points / structural issues via gemini-3.5-flash-lite on Vertex AI.
5. Applies structural fixes using Aider configured with gemini-2.5-flash on Vertex AI.
6. Re-soaks test with Playwright to verify resolution.
7. Produces an executive SUMMARY via gemini-3.8-flash on Vertex AI.
8. Commits and pushes verified changes to git.
"""

import glob
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional

# Constants
VERTEX_ENV_PATH = Path.home() / ".config" / "aider" / "vertex.env"
MEAL_PHOTO_PATH = Path("/workspace/meal-tawar-nilai-web.jpg")
DEBUG_DIR = Path("/workspace/gemini38-meal-review-round3")
DIAGNOSTIC_MODEL = "gemini-3.5-flash-lite"
AIDER_MODEL = "vertex_ai/gemini-2.5-flash"
SUMMARY_MODEL = "gemini-3.8-flash"


def load_env_file(env_path: Path) -> Dict[str, str]:
    """Parse key=value pairs from env file and update os.environ."""
    loaded = {}
    if not env_path.exists():
        print(f"[WARN] Environment file not found at {env_path}")
        return loaded

    print(f"[INFO] Loading Vertex configuration from {env_path}")
    with open(env_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, val = line.split("=", 1)
                key = key.strip()
                val = val.strip().strip("\"'")
                os.environ[key] = val
                loaded[key] = val
    return loaded


def run_command(
    cmd: List[str],
    cwd: Optional[Path] = None,
    capture_output: bool = True,
    check: bool = False,
    env: Optional[Dict[str, str]] = None,
) -> subprocess.CompletedProcess:
    """Run a shell command with logging."""
    print(f"[CMD] {' '.join(cmd)} (cwd={cwd or Path.cwd()})")
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)

    result = subprocess.run(
        cmd,
        cwd=cwd,
        capture_output=capture_output,
        text=True,
        check=check,
        env=merged_env,
    )
    if result.stdout:
        print(f"[STDOUT]\n{result.stdout.strip()}")
    if result.stderr:
        print(f"[STDERR]\n{result.stderr.strip()}", file=sys.stderr)
    return result


def init_vertex_client():
    """Initialize Vertex AI / Google GenAI client based on environment."""
    project = os.environ.get("VERTEXAI_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT")
    location = os.environ.get("VERTEXAI_LOCATION") or os.environ.get("GOOGLE_CLOUD_REGION", "us-central1")
    sa_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")

    if not sa_path or not Path(sa_path).exists():
        fallback_sa = Path.home() / ".config" / "gcloud" / "application_default_credentials.json"
        if fallback_sa.exists():
            os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(fallback_sa)
            sa_path = str(fallback_sa)

    print(f"[INFO] Initializing Vertex with Project: {project}, Region: {location}, Creds: {sa_path}")

    # Check available SDK: google-genai or google.cloud.aiplatform
    try:
        from google import genai
        client = genai.Client(vertexai=True, project=project, location=location)
        return {"type": "google-genai", "client": client}
    except Exception as e:
        print(f"[DEBUG] google-genai client init skipped: {e}")

    try:
        import vertexai
        from vertexai.generative_models import GenerativeModel
        vertexai.init(project=project, location=location)
        return {"type": "vertexai", "model_factory": GenerativeModel}
    except Exception as e:
        print(f"[DEBUG] vertexai client init skipped: {e}")

    return None


def generate_content(client_info: Optional[dict], model_name: str, prompt: str) -> str:
    """Invoke generative model on Vertex AI using available client or gcloud/curl fallback."""
    if client_info:
        try:
            if client_info["type"] == "google-genai":
                response = client_info["client"].models.generate_content(
                    model=model_name,
                    contents=prompt,
                )
                return getattr(response, "text", str(response))
            elif client_info["type"] == "vertexai":
                model = client_info["model_factory"](model_name)
                response = model.generate_content(prompt)
                return getattr(response, "text", str(response))
        except Exception as e:
            print(f"[WARN] Direct SDK call failed for {model_name}: {e}. Falling back to curl.")

    # Fallback to gcloud auth token + REST endpoint
    project = os.environ.get("VERTEXAI_PROJECT") or os.environ.get("GOOGLE_CLOUD_PROJECT", "")
    location = os.environ.get("VERTEXAI_LOCATION") or os.environ.get("GOOGLE_CLOUD_REGION", "us-central1")

    token_res = subprocess.run(
        ["gcloud", "auth", "application-default", "print-access-token"],
        capture_output=True,
        text=True,
    )
    access_token = token_res.stdout.strip()
    if not access_token:
        auth_print = subprocess.run(["gcloud", "auth", "print-access-token"], capture_output=True, text=True)
        access_token = auth_print.stdout.strip()

    if not access_token:
        raise RuntimeError("Unable to acquire Vertex access token via SDK or gcloud auth.")

    # Gemini 3.x on Vertex is global generateContent (not regional :predict)
    location = "global"
    url = (
        f"https://aiplatform.googleapis.com/v1/projects/{project}/"
        f"locations/{location}/publishers/google/models/{model_name}:generateContent"
    )

    req_body = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": prompt}],
            }
        ],
        "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.2},
    }

    import urllib.request
    req = urllib.request.Request(
        url,
        data=json.dumps(req_body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            candidates = data.get("candidates") or data.get("predictions") or []
            if candidates:
                cand = candidates[0]
                if "content" in cand and "parts" in cand["content"]:
                    return "".join(p.get("text", "") for p in cand["content"]["parts"])
            return json.dumps(data, indent=2)
    except Exception as ex:
        print(f"[ERROR] Vertex REST prediction error: {ex}")
        return f"Vertex call error: {ex}"


def run_playwright_soak(step_name: str) -> subprocess.CompletedProcess:
    """Execute Playwright LIVE_MEAL_EDIT soak test."""
    print(f"\n=======================================================")
    print(f"[SOAK] Running LIVE_MEAL_EDIT Playwright Soak ({step_name})")
    print(f"Meal Photo: {MEAL_PHOTO_PATH}")
    print(f"=======================================================")

    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    step_out_dir = DEBUG_DIR / step_name
    step_out_dir.mkdir(parents=True, exist_ok=True)

    env_overrides = {
        "LIVE_MEAL_EDIT": "1",
        "MEAL_PHOTO_PATH": str(MEAL_PHOTO_PATH),
        "DEBUG_OUTPUT_DIR": str(step_out_dir),
        "PLAYWRIGHT_HTML_REPORT": str(step_out_dir / "playwright-report"),
    }

    # Run Playwright test targeted at live meal edit
    cmd = [
        "npx",
        "playwright",
        "test",
        "-g",
        "LIVE_MEAL_EDIT",
        "--reporter=list,json",
        f"--output={step_out_dir}/traces",
    ]

    res = run_command(cmd, env=env_overrides)

    # Save log dumps to target debug directory
    with open(step_out_dir / "stdout.log", "w", encoding="utf-8") as f:
        f.write(res.stdout or "")
    with open(step_out_dir / "stderr.log", "w", encoding="utf-8") as f:
        f.write(res.stderr or "")

    # Collect any extra traces / screenshot artifacts
    for item in glob.glob("test-results/**", recursive=True):
        src_p = Path(item)
        if src_p.is_file():
            dest_p = step_out_dir / "artifacts" / src_p.name
            dest_p.parent.mkdir(parents=True, exist_ok=True)
            try:
                shutil.copy2(src_p, dest_p)
            except Exception:
                pass

    return res


def collect_debug_summary(debug_dir: Path) -> str:
    """Aggregate logs and test reports for diagnosis."""
    summary_parts = []
    for root, _, files in os.walk(debug_dir):
        for f in files:
            if f.endswith((".log", ".json", ".txt")) and not f.endswith("package-lock.json"):
                fp = Path(root) / f
                rel = fp.relative_to(debug_dir)
                try:
                    content = fp.read_text(encoding="utf-8", errors="replace")
                    # Truncate large files to prevent context window overflow
                    if len(content) > 12000:
                        content = content[:6000] + "\n...[TRUNCATED]...\n" + content[-6000:]
                    summary_parts.append(f"--- File: {rel} ---\n{content}\n")
                except Exception as e:
                    summary_parts.append(f"--- File: {rel} (Read Error: {e}) ---")
    return "\n".join(summary_parts)


def diagnose_with_gemini(client_info: Optional[dict], debug_context: str) -> str:
    """Perform diagnosis via gemini-3.5-flash-lite."""
    print(f"\n[DIAGNOSE] Querying {DIAGNOSTIC_MODEL} for failure root cause & structural fix recommendation...")

    prompt = (
        "You are an expert full-stack Playwright and TypeScript/React developer inspecting a failure "
        "in the LIVE_MEAL_EDIT Playwright soak test.\n\n"
        f"Input meal image: {MEAL_PHOTO_PATH}\n"
        "Here are the test artifacts and logs:\n\n"
        f"{debug_context}\n\n"
        "Please provide a precise diagnosis:\n"
        "1. Identify the structural root cause of any failures, UI synchronization issues, or assertion mismatches.\n"
        "2. Provide concrete structural fixes only (architecture, race conditions, selectors, type definitions, modal handling).\n"
        "3. Specify exact files and code adjustments required for Aider to implement."
    )

    diagnosis = generate_content(client_info, DIAGNOSTIC_MODEL, prompt)
    print("\n[DIAGNOSIS RESULT]")
    print(diagnosis)
    (DEBUG_DIR / "diagnosis_gemini_3.5_flash_lite.md").write_text(diagnosis, encoding="utf-8")
    return diagnosis


def apply_fix_with_aider(diagnosis: str):
    """Run Aider using gemini-2.5-flash on Vertex AI with structural instruction."""
    print(f"\n[FIX] Invoking Aider with {AIDER_MODEL}...")

    aider_instruction = (
        "Apply structural fixes only based on the following Playwright soak test diagnosis.\n"
        "Do not apply cosmetic changes. Fix selector timeouts, async race conditions, state transitions, "
        "or payload parsing issues.\n\n"
        f"DIAGNOSIS:\n{diagnosis}"
    )

    instruction_file = DEBUG_DIR / "aider_prompt.txt"
    instruction_file.write_text(aider_instruction, encoding="utf-8")

    cmd = [
        "aider",
        f"--model={AIDER_MODEL}",
        "--no-auto-commits",
        "--yes",
        f"--message-file={instruction_file}",
    ]

    run_command(cmd)


def summarize_run(client_info: Optional[dict], initial_res: int, resoaked_res: int, git_diff: str) -> str:
    """Generate final executive summary using gemini-3.8-flash."""
    print(f"\n[SUMMARY] Generating final iteration summary via {SUMMARY_MODEL}...")

    prompt = (
        "You are an engineering release manager.\n"
        "Summarize this automated soak test and fix iteration for LIVE_MEAL_EDIT:\n\n"
        f"- Initial Playwright Soak Exit Code: {initial_res}\n"
        f"- Re-soak Playwright Exit Code: {resoaked_res}\n"
        f"- Test Photo: {MEAL_PHOTO_PATH}\n"
        f"- Debug Artifacts Directory: {DEBUG_DIR}\n\n"
        "Git Diff applied:\n"
        f"{git_diff[:8000] if git_diff else 'No git diff changes'}\n\n"
        "Generate a structured Markdown report including:\n"
        "1. Executive Overview (PASS/FAIL)\n"
        "2. Root Cause Identified\n"
        "3. Structural Fixes Applied\n"
        "4. Re-soak Validation Results\n"
        "5. Next Recommended Actions\n"
    )

    summary = generate_content(client_info, SUMMARY_MODEL, prompt)
    print("\n[EXECUTIVE SUMMARY]")
    print(summary)
    (DEBUG_DIR / "FINAL_SUMMARY_gemini_3.8_flash.md").write_text(summary, encoding="utf-8")
    return summary


def commit_and_push():
    """Commit verified changes and push to git remote."""
    print("\n[GIT] Committing and pushing verified structural fixes...")
    status = run_command(["git", "status", "--porcelain"])
    if not status.stdout.strip():
        print("[GIT] Working tree clean. Nothing to commit.")
        return

    run_command(["git", "add", "-A"])
    commit_msg = (
        "fix(meal-edit): structural fixes from vertex soak iteration\n\n"
        "Verified via LIVE_MEAL_EDIT soak Playwright test using meal-tawar-nilai-web.jpg.\n"
        "Diagnosed with gemini-3.5-flash-lite, resolved via gemini-2.5-flash, reviewed via gemini-3.8-flash."
    )
    commit_res = run_command(["git", "commit", "-m", commit_msg])
    if commit_res.returncode == 0:
        push_res = run_command(["git", "push"])
        if push_res.returncode != 0:
            print("[WARN] Git push failed. Please inspect remote access.", file=sys.stderr)
    else:
        print("[WARN] Git commit did not complete successfully.", file=sys.stderr)


def main():
    print("================================================================================")
    print("STARTING VERTEX MEAL ITERATION ORCHESTRATOR")
    print("================================================================================")

    # 1. Load Vertex environment
    load_env_file(VERTEX_ENV_PATH)
    client_info = init_vertex_client()

    # 2. Run initial soak test
    initial_res = run_playwright_soak(step_name="initial_soak")

    # 3. Collect debug logs
    debug_context = collect_debug_summary(DEBUG_DIR / "initial_soak")

    # 4. Diagnose with gemini-3.5-flash-lite
    diagnosis = diagnose_with_gemini(client_info, debug_context)

    # 5. Fix with Aider (gemini-2.5-flash) if failure occurred or structural issue flagged
    apply_fix_with_aider(diagnosis)

    # 6. Re-soak test verification
    resoak_res = run_playwright_soak(step_name="resoak_verification")

    # 7. Collect git diff for summary
    diff_output = run_command(["git", "diff"]).stdout

    # 8. Produce summary via gemini-3.8-flash
    summarize_run(
        client_info=client_info,
        initial_res=initial_res.returncode,
        resoaked_res=resoak_res.returncode,
        git_diff=diff_output,
    )

    # 9. Commit & push verified fixes
    if resoak_res.returncode == 0:
        print("[INFO] Soak verification PASSED. Committing and pushing.")
        commit_and_push()
    else:
        print(
            f"[WARN] Re-soak verification failed with exit code {resoak_res.returncode}. "
            f"Review artifacts at {DEBUG_DIR}.",
            file=sys.stderr,
        )
        sys.exit(resoak_res.returncode)

    print("================================================================================")
    print("VERTEX MEAL ITERATION ORCHESTRATION COMPLETED")
    print("================================================================================")


if __name__ == "__main__":
    main()
