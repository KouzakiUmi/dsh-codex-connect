#!/usr/bin/env python3
"""Install exact PR #327 artifact into an owned temporary prefix and run native CLI acceptance."""
import hashlib
import json
import os
import pathlib
import platform
import shutil
import subprocess
import sys
import tempfile
import time

EXPECTED_HEAD = "a297fa6808982eed57c219a8a3518bd8c37b6761"
source = pathlib.Path(sys.argv[1]).resolve()
fixture = pathlib.Path(__file__).with_name("acceptance.mjs").resolve()
assert sys.platform == "darwin", "Use the separate container procedure for Linux"
assert subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=source, text=True).strip() == EXPECTED_HEAD
assert not subprocess.check_output(["git", "status", "--porcelain"], cwd=source, text=True).strip()
evidence = pathlib.Path(tempfile.mkdtemp(prefix="codex-connect-installed-native-macos-evidence-"))
owned = pathlib.Path(tempfile.mkdtemp(prefix="codex-connect-installed-native-macos-work-")).resolve()
install = owned / "installation"
install.mkdir()
(owned / "npm-userconfig").write_text("")
(owned / "npm-globalconfig").write_text("")
(install / "package.json").write_text(json.dumps({"name":"owned-native-acceptance","private":True,"version":"0.0.0"}) + "\n")
env = {key: os.environ[key] for key in ["PATH", "LANG", "LC_ALL", "TMPDIR", "TEMP", "TMP"] if key in os.environ}
env.update({
    "HOME": str(owned), "XDG_CONFIG_HOME": str(owned / "config"), "XDG_CACHE_HOME": str(owned / "cache"),
    "npm_config_userconfig": str(owned / "npm-userconfig"),
    "npm_config_globalconfig": str(owned / "npm-globalconfig"),
    "npm_config_cache": str(owned / "npm-cache"), "npm_config_registry": "https://registry.npmjs.org/",
    "DSH_TELEMETRY_MODE": "DISABLED",
})
report = {
    "schemaVersion": 1, "sourceCommit": EXPECTED_HEAD,
    "sourceTree": subprocess.check_output(["git", "rev-parse", "HEAD^{tree}"], cwd=source, text=True).strip(),
    "platform": platform.system(), "architecture": platform.machine(), "osRelease": platform.release(),
    "node": subprocess.check_output(["node", "--version"], text=True).strip(),
    "npm": subprocess.check_output(["npm", "--version"], env=env, text=True).strip(),
    "sourceBinSha256": hashlib.sha256((source / "lib/bin.js").read_bytes()).hexdigest(),
    "fixtureSha256": hashlib.sha256(fixture.read_bytes()).hexdigest(),
    "installation": "temporary npm prefix, lifecycle scripts disabled, peer dependencies omitted for standalone CLI",
    "steps": [], "cleanup": {}, "passed": False,
}
print(json.dumps({"evidenceRoot":str(evidence),"sourceCommit":EXPECTED_HEAD}), flush=True)
native_started = False
accepted = None

def run(label, args, cwd, timeout, require_success=True, child_env=None):
    started = time.monotonic()
    try:
        result = subprocess.run(args, cwd=cwd, env=env if child_env is None else child_env, text=True, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        report["steps"].append({"name":label,"timedOut":True})
        raise
    text = result.stdout + ("\n[stderr]\n" + result.stderr if result.stderr else "")
    for old, new in [(str(source), "<SOURCE>"), (str(owned), "<OWNED_INSTALL_ROOT>"), (str(evidence), "<EVIDENCE>")]:
        text = text.replace(old, new)
    text = "\n".join(line.rstrip() for line in text.splitlines()) + "\n"
    log = evidence / (label + ".log")
    log.write_text(text)
    report["steps"].append({"name":label,"exitCode":result.returncode,"elapsedSeconds":round(time.monotonic()-started,3),
                            "log":log.name,"logSha256":hashlib.sha256(log.read_bytes()).hexdigest()})
    print(json.dumps({"step":label,"exit":result.returncode}), flush=True)
    if result.returncode and require_success:
        raise RuntimeError(label + " failed; retained " + log.name)
    return result

try:
    run("fixture-syntax", ["node", "--check", str(fixture)], source, 30)
    packed = run("pack", ["npm","pack","--json","--ignore-scripts","--pack-destination",str(owned)], source, 120)
    inventory = json.loads(packed.stdout)
    assert len(inventory) == 1
    package = inventory[0]
    filename = package["filename"]
    assert pathlib.Path(filename).name == filename
    tarball = owned / filename
    report["package"] = {key:package[key] for key in ["name","version","filename","size","unpackedSize","shasum","integrity"]}
    report["package"]["sha256"] = hashlib.sha256(tarball.read_bytes()).hexdigest()
    run("install", ["npm","install","--prefix",str(install),"--legacy-peer-deps","--ignore-scripts",
                     "--no-audit","--no-fund","--package-lock=false",str(tarball)], install, 600)
    installed_bin = install / "node_modules/dsh-codex-connect/lib/bin.js"
    report["installedBinSha256"] = hashlib.sha256(installed_bin.read_bytes()).hexdigest()
    assert report["installedBinSha256"] == report["sourceBinSha256"]
    native_env = dict(env)
    native_env["HOME"] = os.environ["HOME"]  # OS Keychain location only; fixture supplies an owned DSH_HOME.
    native_started = True
    result = run("native-acceptance", ["node",str(fixture),"--synthetic-owned-entries-only",str(install)], install, 240, require_success=False, child_env=native_env)
    accepted = json.loads(result.stdout)
    (evidence / "native-result.json").write_text(json.dumps(accepted,indent=2)+"\n")
    assert result.returncode == 0 and accepted["passed"] and accepted["cleanup"]["entriesAbsent"] and accepted["cleanup"]["temporaryHomeRemoved"]
    report["passed"] = True
except Exception as error:
    report["failure"] = {"errorKind": type(error).__name__, "message": str(error).replace(str(owned), "<OWNED_INSTALL_ROOT>")}
finally:
    report["sourceHeadAfter"] = subprocess.check_output(["git","rev-parse","HEAD"],cwd=source,text=True).strip()
    report["sourceCleanAfter"] = not subprocess.check_output(["git","status","--porcelain"],cwd=source,text=True).strip()
    if report["sourceHeadAfter"] != EXPECTED_HEAD or not report["sourceCleanAfter"]:
        report["passed"] = False
    safe_cleanup = not native_started or (accepted is not None and accepted["cleanup"]["entriesAbsent"] and accepted["cleanup"]["temporaryHomeRemoved"])
    if safe_cleanup:
        shutil.rmtree(owned)
    else:
        report["cleanup"]["recoveryInstallation"] = str(owned)
    report["cleanup"]["installationAndCacheRemoved"] = not owned.exists()
    (evidence / "result.json").write_text(json.dumps(report,indent=2)+"\n")
print(json.dumps({"evidenceRoot":str(evidence),"result":report}), flush=True)
sys.exit(0 if report["passed"] else 1)
