"""Actual Linux child-pipe/refusal controls; no repository or assessment data."""
import json
import subprocess
import sys

sys.path.insert(0, "/opt/slop")
from supervise import restrict

ENV = {"PATH": "/opt/slop-merge-git/bin:/usr/local/bin:/usr/bin:/bin",
       "HOME": "/analysis/work"}
NODE = """
const {execFileSync} = require('node:child_process');
try {
  const version = execFileSync('git', ['--version'], {
    encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:5000
  }).trim();
  process.stdout.write(JSON.stringify({version}));
} catch (error) {
  process.stdout.write(JSON.stringify({code:error.code === 'EPERM' ? 'EPERM' : 'unexpected'}));
}
"""
SOCKETS = """
import ctypes,json,socket
checks = {}
for name,family in [('inet',socket.AF_INET),('inet6',socket.AF_INET6),('unix',socket.AF_UNIX)]:
    try:
        s=socket.socket(family,socket.SOCK_STREAM);s.close();checks[name]=False
    except PermissionError:
        checks[name]=True
for name,family in [('unixPair',socket.AF_UNIX),('inetPair',socket.AF_INET)]:
    try:
        pair=socket.socketpair(family,socket.SOCK_STREAM)
        for s in pair:s.close()
        checks[name]=False
    except PermissionError:
        checks[name]=True
# Linux x86_64/aarch64 both assign io_uring_setup425. An invalid entry count
# would be EINVAL without a filter. EPERM proves retained refusal; Docker's
# outer seccomp may also deny this call, so it does not identify one filter.
lib=ctypes.CDLL(None,use_errno=True)
checks['ioUring']=lib.syscall(425,0,0)==-1 and ctypes.get_errno()==1
print(json.dumps(checks))
"""


def run(args, merge):
    result = subprocess.run(args, cwd="/analysis/work", env=ENV,
                            preexec_fn=lambda: restrict(merge),
                            capture_output=True, timeout=10, check=False)
    if result.returncode != 0 or len(result.stdout) > 2048:
        raise RuntimeError("Child-pipe control failed")
    return json.loads(result.stdout)


before = run(["node", "-e", NODE], False)
after = run(["node", "-e", NODE], True)
assert before == {"code": "EPERM"}, "Original child-pipe refusal not reproduced"
assert after == {"version": "git version 2.56.0"}, "Fixed Git child did not run"
for merge in (False, True):
    sockets = run(["python3", "-c", SOCKETS], merge)
    assert sockets == {"inet": True, "inet6": True, "unix": True,
                       "unixPair": not merge, "inetPair": True, "ioUring": True}
print(json.dumps({"originalChildPipeCode": "EPERM", "fixedGitVersion": after["version"],
                  "networkRefusalsPreserved": True, "genericSocketpairRefused": True,
                  "fixedUnixPairOnly": True}))
