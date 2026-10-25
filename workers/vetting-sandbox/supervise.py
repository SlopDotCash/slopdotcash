"""Run one retained artifact without inherited environment or service authority."""
import base64
import ctypes
import errno
import json
import os
import resource
import selectors
import signal
import subprocess
import sys
import time

COMMANDS = {
    "shell": ["/bin/sh", "/analysis/artifact"],
    "python": ["python3", "/analysis/artifact"],
    "node": ["node", "--max-old-space-size=128", "/analysis/artifact"],
    "binary": ["/analysis/artifact"],
    "merge": ["node", "--max-old-space-size=128", "/opt/slop/merge.mjs"],
}
LIMIT = 65536


def block_network():
    # Docker development does not enforce Cloudflare's enableInternet flag.
    # Apply the same syscall boundary in both environments; descendants inherit it.
    lib = ctypes.CDLL("libseccomp.so.2", use_errno=True)
    lib.seccomp_init.argtypes = [ctypes.c_uint32]
    lib.seccomp_init.restype = ctypes.c_void_p
    lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    lib.seccomp_syscall_resolve_name.restype = ctypes.c_int
    lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
    lib.seccomp_rule_add.restype = ctypes.c_int
    lib.seccomp_load.argtypes = [ctypes.c_void_p]
    lib.seccomp_load.restype = ctypes.c_int
    lib.seccomp_release.argtypes = [ctypes.c_void_p]
    context = lib.seccomp_init(0x7FFF0000)  # SCMP_ACT_ALLOW
    if not context:
        raise OSError("Cannot allocate network filter")
    try:
        # No sockets are inherited. Block new sockets and io_uring, which can
        # otherwise create sockets without making a socket syscall.
        for name in (b"socket", b"socketpair", b"io_uring_setup"):
            number = lib.seccomp_syscall_resolve_name(name)
            if number < 0 or lib.seccomp_rule_add(context, 0x00050001, number, 0) != 0:
                raise OSError("Cannot define network filter")
        if lib.seccomp_load(context) != 0:
            raise OSError("Cannot install network filter")
    finally:
        lib.seccomp_release(context)


def restrict(merge=False):
    # PR_SET_NO_NEW_PRIVS prevents setuid programs from restoring authority.
    if ctypes.CDLL(None, use_errno=True).prctl(38, 1, 0, 0, 0) != 0:
        raise OSError("Cannot remove privilege escalation")
    block_network()
    os.setgroups([])
    os.setgid(65534)
    os.setuid(65534)
    resource.setrlimit(resource.RLIMIT_CPU, (20, 20))
    resource.setrlimit(resource.RLIMIT_FSIZE, ((128 if merge else 8) * 1024 * 1024,) * 2)
    resource.setrlimit(resource.RLIMIT_NPROC, (32, 32))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def main():
    interpreter = sys.argv[1]
    if interpreter not in COMMANDS:
        raise ValueError("Unsupported interpreter")
    try:
        child = subprocess.Popen(
            COMMANDS[interpreter],
            cwd="/analysis/work",
            env={"PATH": ("/opt/slop-merge-git/bin:" if interpreter == "merge" else "") + "/usr/local/bin:/usr/bin:/bin", "HOME": "/analysis/work", "TMPDIR": "/analysis/work"},
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            start_new_session=True,
            preexec_fn=lambda: restrict(interpreter == "merge"),
        )
    except OSError as error:
        # An unsupported executable or missing loader is an artifact result.
        # A failed preexec security setup raises SubprocessError instead and
        # must still fail the service request without running the artifact.
        if error.errno not in (errno.ENOEXEC, errno.ENOENT, errno.EACCES):
            raise
        print(json.dumps({
            "status": "not-executable", "exitCode": 126,
            "stdoutBase64": "",
            "stderrBase64": base64.b64encode(b"Artifact cannot execute in this image").decode("ascii"),
            "outputComplete": False,
        }))
        return
    streams = {"stdout": bytearray(), "stderr": bytearray()}
    status = "exited"
    selector = selectors.DefaultSelector()
    selector.register(child.stdout, selectors.EVENT_READ, "stdout")
    selector.register(child.stderr, selectors.EVENT_READ, "stderr")
    deadline = time.monotonic() + 30
    try:
        while selector.get_map():
            if interpreter == "merge":
                # This is a fail-closed observation, not a filesystem quota.
                # The container's disk ceiling and per-file rlimit remain hard
                # bounds; no mount or privilege expansion is needed here.
                used = sum(os.lstat(os.path.join(root, name)).st_size
                           for root, _, files in os.walk("/analysis/work")
                           for name in files)
                if used > 256 * 1024 * 1024:
                    status = "disk-limit"
                    break
            if time.monotonic() >= deadline:
                status = "timeout"
                break
            for key, _ in selector.select(0.1):
                chunk = os.read(key.fd, 8192)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                destination = streams[key.data]
                remaining = LIMIT - len(destination)
                destination.extend(chunk[:remaining])
                if len(chunk) > remaining:
                    status = "output-limit"
                    break
            if status != "exited":
                break
        if status == "exited":
            try:
                child.wait(timeout=max(0.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                status = "timeout"
    finally:
        # Always remove descendants, including children that closed their pipes.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.wait()
        selector.close()
        child.stdout.close()
        child.stderr.close()
    print(json.dumps({
        "status": status,
        "exitCode": child.returncode,
        "stdoutBase64": base64.b64encode(streams["stdout"]).decode("ascii"),
        "stderrBase64": base64.b64encode(streams["stderr"]).decode("ascii"),
        "outputComplete": status == "exited",
    }))


if __name__ == "__main__":
    main()
