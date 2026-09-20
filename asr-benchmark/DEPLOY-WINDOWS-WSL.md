# Deploy the Reader-Leader Evaluator on Windows 11 with WSL2 and Containers

This guide deploys the **current offline/batch evaluator and raw-audio ingester**. It does not create a live microphone correction service. The container includes Python, PyYAML, jsonschema, FFmpeg, FFprobe, schemas, configuration, evaluator, ingestion code, tests, and bundled references.

## Recommendation

Use **Docker Desktop with the WSL2 backend**, run commands from an Ubuntu WSL2 terminal, and keep the project and private recordings inside the WSL Linux filesystem. This gives a reproducible Linux runtime while avoiding repeated Python and FFmpeg installation on the host.

Microsoft and Docker both recommend keeping Linux-tool projects in the WSL filesystem rather than under `/mnt/c`; cross-filesystem access can be significantly slower. The WSL project remains visible from Windows Explorer through `\\wsl$` or `\\wsl.localhost`.

## Option comparison

| Option | First setup | Repeatable deployment | Runtime/performance | Operational burden | Recommendation |
|---|---:|---|---|---|---|
| WSL2 + Python virtual environment | 30–60 minutes | Medium | Fastest for one user | Python/FFmpeg installed in each WSL distro | Good if only one trusted machine is used. |
| Docker Desktop + WSL2 + Compose | 45–90 minutes | **High** | Very good; Linux filesystem avoids slow Windows bind mounts | Docker Desktop must be running | **Recommended for this package.** |
| Docker Engine installed directly inside WSL2 | 60–120 minutes | High | Very good | You maintain the daemon and systemd setup | Good for advanced Linux users who do not want Docker Desktop. |
| Microsoft `wslc` containers | 30–90 minutes, currently preview path | High | Potentially good | Requires WSL prerelease/container tooling | Evaluate later; not the stable default for a sensitive pilot. |
| Native Windows Python + FFmpeg | 30–120 minutes | Low | Adequate | Windows paths, FFmpeg, permissions, and package differences | Not recommended unless Docker/WSL is unavailable. |

**Do not run Docker Desktop and a separately installed Docker Engine in the same WSL distribution.** Choose one engine. Docker documents this as a potential conflict.

## Prerequisites

Recommended baseline:

- Windows 11 64-bit, current supported build.
- Hardware virtualization enabled in BIOS/UEFI.
- At least 8 GB system RAM for Docker Desktop; 16 GB is more comfortable when handling recordings.
- Ubuntu running as WSL2.
- Docker Desktop for Windows using the WSL2-based engine and Linux containers.
- Approximately 5–10 GB free disk space for the image, package, and working data.

Docker Desktop licensing depends on use. Personal use, education, non-commercial open source, and small businesses within Docker's published limits may use it without a paid subscription; larger commercial organizations need to check Docker's current subscription terms.

## 1. Install or verify WSL2

Open **PowerShell**. Use an elevated terminal for the first installation if Windows requests it:

```powershell
wsl --install
wsl --update
wsl --set-default-version 2
wsl --version
wsl --status
wsl --list --verbose
```

If Ubuntu is listed as version 1, convert it:

```powershell
wsl --set-version Ubuntu 2
wsl --set-default Ubuntu
```

Restart Windows if requested. Launch Ubuntu once from the Start menu and create the Linux username/password.

## 2. Install and configure Docker Desktop

Install Docker Desktop for Windows using the official installer. During installation select **Use WSL 2 instead of Hyper-V** when offered. Start Docker Desktop and configure:

1. **Settings → General → Use the WSL 2 based engine**.
2. **Settings → Resources → WSL Integration → Ubuntu → Enable integration**.
3. Switch to **Linux containers** if Docker Desktop is currently in Windows-container mode.
4. Apply the settings and wait until Docker Desktop reports that it is running.

Verify from the Ubuntu terminal:

```bash
docker version
docker compose version
docker run --rm hello-world
```

If `docker` is not found inside Ubuntu, enable WSL integration for that exact distribution and restart the terminal.

## 3. Put the project in the WSL filesystem

From Ubuntu, use a Linux-native path. Do not use `/mnt/c/...` for the active project or high-volume recordings:

```bash
mkdir -p ~/readerleader
cd ~/readerleader
# Copy or unzip the evaluation package here.
unzip ~/readerleader-asr-evaluation-v1.1.zip -d .
cd readerleader-asr-evaluation-v1.1
mkdir -p input output-local
```

If the ZIP is currently on Windows, it is visible through a path such as `/mnt/c/Users/<WindowsUser>/Downloads/...`; copy it into the WSL filesystem before extracting:

```bash
cp /mnt/c/Users/<WindowsUser>/Downloads/readerleader-asr-evaluation-v1.1.zip ~/readerleader/
```

You can open the WSL project in Windows Explorer with:

```bash
explorer.exe .
```

Or open it in VS Code with the WSL extension:

```bash
code .
```

The VS Code window should show the WSL remote indicator.

## 4. Build the image

From the package root:

```bash
docker compose build
```

The first build downloads the Python base image and installs FFmpeg and Python requirements. Later runs reuse Docker's cached layers and are much faster. The build context excludes private recordings and generated output through `.dockerignore`.

## 5. Run the tests inside the container

```bash
docker compose run --rm benchmark
```

Expected result: all package tests pass. The tests include evaluator, ingestion, package-integrity, schema, and synthetic-evidence-gate checks.

## 6. Run the synthetic evaluator

The image contains the synthetic fixtures. Run the smoke report into the mounted WSL output directory:

```bash
rm -rf output-local/example

docker compose run --rm benchmark \
  python3 src/evaluate_asr.py \
  --sessions data/example_sessions.jsonl \
  --events data/example_events.jsonl \
  --variants data/example_variants.jsonl \
  --config config/benchmark.yaml \
  --output /workspace/output/example
```

View the report from WSL:

```bash
less output-local/example/summary.md
```

The synthetic fixture should report `stage_pass: false` because it intentionally fails child-evidence sufficiency. That is correct: the fixture validates the software, not child-ASR readiness.

## 7. Ingest controlled recordings

Copy only approved, consented recordings and metadata into the WSL-native `input` directory. Use pseudonymous IDs and keep consent documents separate from the benchmark data.

Example layout:

```text
input/
├── recordings.csv
├── free_asr_results.jsonl
├── approved_variants.jsonl
└── raw_audio/
    ├── session_001.m4a
    └── session_002.wav
```

The manifest's `audio_path` values may be relative to `input`, for example `raw_audio/session_001.m4a`. Start with `data/ingest_manifest.example.csv` and replace every example value.

Run ingestion:

```bash
rm -rf output-local/ingest

docker compose run --rm benchmark \
  python3 src/ingest_audio.py \
  --manifest /workspace/input/recordings.csv \
  --asr-results /workspace/input/free_asr_results.jsonl \
  --output-dir /workspace/output/ingest
```

The output contains canonical audio and session records:

```text
output-local/ingest/
├── audio/<pseudonymous_session_id>.wav
├── sessions.jsonl
└── event_annotation_template.csv
```

To merge complete reviewed event evidence:

```bash
docker compose run --rm benchmark \
  python3 src/ingest_audio.py \
  --manifest /workspace/input/recordings.csv \
  --asr-results /workspace/input/free_asr_results.jsonl \
  --event-annotations /workspace/input/reviewed_events.jsonl \
  --output-dir /workspace/output/ingest
```

The script refuses missing consent/assent, invalid IDs, missing recordings, invalid metadata, and incomplete reviewed event records. It does not infer accent and does not fabricate gold labels.

## 8. Run the frozen holdout evaluation

```bash
docker compose run --rm benchmark \
  python3 src/evaluate_asr.py \
  --sessions /workspace/output/ingest/sessions.jsonl \
  --events /workspace/output/ingest/events.jsonl \
  --variants /workspace/input/approved_variants.jsonl \
  --config config/benchmark.yaml \
  --output /workspace/output/report \
  --fail-on-gates
```

Exit codes:

- `0`: evaluation completed and all required gates passed, when `--fail-on-gates` is used.
- `2`: schema or cross-file validation failed.
- `3`: hard safety-policy violation detected.
- `4`: one or more required gates failed or were not evaluable.

Reports are available under `output-local/report/`.

## 9. Optional direct `docker run` form

Compose is easier to maintain, but the equivalent one-shot command is:

```bash
docker build -t readerleader-asr-evaluation:1.1 .
mkdir -p output-local

docker run --rm \
  -v "$PWD/output-local:/workspace/output" \
  readerleader-asr-evaluation:1.1 \
  python3 src/evaluate_asr.py \
  --sessions data/example_sessions.jsonl \
  --events data/example_events.jsonl \
  --variants data/example_variants.jsonl \
  --config config/benchmark.yaml \
  --output /workspace/output/example
```

For private input files, use a read-only mount:

```bash
-v "$PWD/input:/workspace/input:ro"
```

Do not mount the entire Windows `C:\` drive and do not use a writable mount for raw recordings unless the workflow requires it.

## Data protection guidance

- Keep the project and recordings in the WSL filesystem, not a broad Windows bind mount.
- Use pseudonymous IDs; do not put child names in filenames or manifests.
- Do not put raw recordings in the Docker image or Git repository.
- Mount input recordings read-only where possible.
- Keep `output-local/` private and back it up only to an approved encrypted location.
- Do not expose the evaluator's container port; this batch package does not need a server port.
- If an external ASR provider is used, confirm the approved processing and retention route before sending child audio.
- Delete or separately archive raw audio according to the consent and research-retention policy.

## What this deployment does not provide

This container runs completed-recording ingestion and offline evaluation. It does not provide:

- Browser microphone capture.
- Streaming ASR.
- Live PROMPT/MODEL/STAY SILENT decisions.
- A live child-facing audio interface.
- Automatic human event annotation.

Those features require a separate streaming application and ASR adapter. The same schemas, accent policy, state-machine logic, and evaluator can be reused for its event log.

## Troubleshooting

### `docker: command not found` in Ubuntu

Enable Docker Desktop's WSL integration for Ubuntu, close and reopen the WSL terminal, then run `docker version` again.

### Slow builds or evaluation

Confirm the project is under `~/readerleader/...`, not `/mnt/c/...`. Microsoft recommends storing Linux-tool projects in the WSL filesystem because cross-filesystem access can be significantly slower.

### Docker Desktop and Docker Engine conflict

Do not install a second Docker daemon inside the same WSL distro when Docker Desktop WSL integration is enabled. Remove the direct Engine installation or disable Docker Desktop integration, then choose one route.

### Out-of-memory or disk pressure

Reduce parallelism, process recordings in smaller batches, clean unused images/containers, and increase Docker Desktop's allocated memory if needed. WSL can reclaim memory after updates/builds when supported; restart Docker Desktop or WSL only after saving outputs.

### Permission problems in output

Run the container from a WSL-owned directory and check ownership of `output-local`. Avoid generating output into protected Windows paths.

## Official references

[1]: https://docs.docker.com/desktop/features/wsl/ "Docker Desktop WSL 2 backend"
[2]: https://docs.docker.com/desktop/setup/install/windows-install/ "Install Docker Desktop on Windows"
[3]: https://learn.microsoft.com/en-us/windows/wsl/setup/environment "Set up a WSL development environment"
[4]: https://learn.microsoft.com/en-us/windows/wsl/tutorials/wsl-containers "Get started with WSL containers"
