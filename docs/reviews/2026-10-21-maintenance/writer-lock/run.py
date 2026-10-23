#!/usr/bin/env python3
"""Execute the four predeclared diagnostics once each. No result-based retry."""
import argparse, hashlib, json, os, pathlib, subprocess, sys
parser=argparse.ArgumentParser()
parser.add_argument("--baseline-root",required=True)
parser.add_argument("--candidate-root",required=True)
parser.add_argument("--output",required=True)
args=parser.parse_args()
base=pathlib.Path(args.baseline_root).resolve()
candidate=pathlib.Path(args.candidate_root).resolve()
out=pathlib.Path(args.output).resolve()
fixture=pathlib.Path(__file__).with_name("instrumented-store.mjs")
assert not out.exists(), "Refuse to overwrite any previous diagnostic evidence"
out.mkdir(parents=True)
def git(root,*values):
    return subprocess.check_output(["git","--no-optional-locks",*values],cwd=root,text=True).strip()
assert git(base,"rev-parse","HEAD")=="a019a1078526aad91ce8a65f9cd175da16167273"
assert git(candidate,"rev-parse","HEAD")=="eec7c892f5dfba21009bcaa71db8f626cbbfa9df"
paths=["src/adaptive-task-store.ts","src/adaptive-task-contract.ts","pnpm-lock.yaml","vitest.config.ts"]
for root in [base,candidate]:
    assert not git(root,"diff","--",*paths)
    for name in paths:
        baseline=subprocess.check_output(["git","show","e5579b71339ba932dec7dfba497fc97df8fbf124:"+name],cwd=root)
        assert (root/name).read_bytes()==baseline, name+" differs from exact main"
plan=[("main-natural",base,0),("candidate-natural",candidate,0),
      ("main-held-500ms",base,500),("candidate-held-500ms",candidate,500)]
summary={"schemaVersion":1,"baselineSourceCommit":"e5579b71339ba932dec7dfba497fc97df8fbf124",
 "baselineExecutionCommit":git(base,"rev-parse","HEAD"),"candidateCommit":git(candidate,"rev-parse","HEAD"),
 "fixtureSha256":hashlib.sha256(fixture.read_bytes()).hexdigest(),"plannedCases":[v[0] for v in plan],
 "scenarioCount":4,"retries":0,"sourceHashes":{p:hashlib.sha256((base/p).read_bytes()).hexdigest() for p in paths},"cases":[]}
(out/"declared-plan.json").write_text(json.dumps(summary,indent=2)+"\n")
for label,root,hold in plan:
    command=["node","--experimental-transform-types",str(fixture),str(root),str(hold),label]
    completed=subprocess.run(command,cwd=root,env=os.environ.copy(),capture_output=True,text=True,timeout=30)
    (out/(label+".json")).write_text(completed.stdout)
    stderr=completed.stderr.replace(str(base),"<BASELINE_ROOT>").replace(str(candidate),"<CANDIDATE_ROOT>").replace(str(fixture),"<DIAGNOSTIC_FIXTURE>")
    (out/(label+".stderr.log")).write_text(stderr)
    result=json.loads(completed.stdout)
    item={"label":label,"exitCode":completed.returncode,"fulfilled":result.get("fulfilled"),"rejected":result.get("rejected"),
      "lockTimeouts":result.get("lockTimeouts"),"integrityChecksPassed":result.get("integrityChecksPassed"),
      "cleanup":result.get("cleanup"),"resultSha256":hashlib.sha256(completed.stdout.encode()).hexdigest(),
      "atomicModuleSha256":result.get("atomicModuleSha256"),"maxHoldMs":max((v["observedHoldMs"] or 0 for v in result.get("writers",[])),default=None)}
    summary["cases"].append(item)
    (out/"summary.json").write_text(json.dumps(summary,indent=2)+"\n")
    print(json.dumps(item),flush=True)
summary["atomicModuleIdentical"]=len({v["atomicModuleSha256"] for v in summary["cases"]})==1
summary["sourceRootsStillUnchanged"]=all(not git(root,"diff","--",*paths) for root in [base,candidate])
summary["allDiagnosticsCompleted"]=all(v["exitCode"]==0 and v["integrityChecksPassed"] and v["cleanup"]["temporaryRootRemoved"] for v in summary["cases"])
(out/"summary.json").write_text(json.dumps(summary,indent=2)+"\n")
print(json.dumps(summary),flush=True)
sys.exit(0 if summary["allDiagnosticsCompleted"] and summary["atomicModuleIdentical"] and summary["sourceRootsStillUnchanged"] else 1)
