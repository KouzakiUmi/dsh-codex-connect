#!/usr/bin/env python3
"""One isolated Linux native-store check; no host home or Docker socket is mounted."""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile
import uuid

EXPECTED_HEAD = "a297fa6808982eed57c219a8a3518bd8c37b6761"
IMAGE = "node:24.19.0-bookworm@sha256:4196d66a565c6f195728d9952f161f4adfe2ad753052a08b7ec7f1c5a6bda42b"
source = pathlib.Path(sys.argv[1]).resolve()
scripts = pathlib.Path(__file__).resolve().parent
assert subprocess.check_output(["git","rev-parse","HEAD"],cwd=source,text=True).strip() == EXPECTED_HEAD
assert not subprocess.check_output(["git","status","--porcelain"],cwd=source,text=True).strip()
root = pathlib.Path(tempfile.mkdtemp(prefix="codex-connect-locked-native-linux-evidence-")).resolve()
inputs = root / "input"
outputs = root / "output"
inputs.mkdir()
outputs.mkdir()
subprocess.run(["git","archive","--format=tar","--output="+str(inputs/"source.tar"),EXPECTED_HEAD],cwd=source,check=True)
for filename in ["acceptance.mjs","container.mjs","native-session.mjs"]:
    shutil.copyfile(scripts/filename,inputs/filename)
container_name = "codex-connect-owned-locked-native-" + uuid.uuid4().hex[:12]
args = ["docker","run","--rm","--name",container_name,
        "--mount","type=bind,src="+str(inputs)+",dst=/input,readonly",
        "--mount","type=bind,src="+str(outputs)+",dst=/out",
        IMAGE,"node","/input/container.mjs"]
summary = {"sourceCommit":EXPECTED_HEAD,"image":IMAGE,"containerName":container_name,
           "sourceArchiveSha256":hashlib.sha256((inputs/"source.tar").read_bytes()).hexdigest(),
           "mounts":["owned source archive/fixture read-only","owned evidence output read-write"],
           "hostHomeMounted":False,"dockerSocketMounted":False,"privileged":False}
print(json.dumps({"evidenceRoot":str(root),"containerName":container_name}),flush=True)
try:
    with (root/"docker.log").open("w") as log:
        result = subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,timeout=1200)
    summary["dockerExitCode"] = result.returncode
except subprocess.TimeoutExpired:
    summary["timedOut"] = True
    subprocess.run(["docker","rm","-f",container_name],capture_output=True,text=True)
finally:
    check = subprocess.run(["docker","container","inspect",container_name],capture_output=True,text=True)
    summary["containerAbsent"] = check.returncode != 0 and "No such container" in check.stderr
    summary["sourceHeadAfter"] = subprocess.check_output(["git","rev-parse","HEAD"],cwd=source,text=True).strip()
    summary["sourceCleanAfter"] = not subprocess.check_output(["git","status","--porcelain"],cwd=source,text=True).strip()
    (root/"runner-result.json").write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps({"evidenceRoot":str(root),"runner":summary}),flush=True)
if (outputs/"result.json").exists():
    print((outputs/"result.json").read_text(),flush=True)
passed = summary.get("dockerExitCode") == 0 and summary["containerAbsent"] and summary["sourceCleanAfter"] and summary["sourceHeadAfter"] == EXPECTED_HEAD
sys.exit(0 if passed else 1)