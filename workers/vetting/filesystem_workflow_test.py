"""Real Linux filesystem operations against the guest capture code; no execution release."""
import base64
from pathlib import Path
import os
import tempfile
from guest import FilesystemCapture


def main():
    if not hasattr(os, 'O_PATH'):
        raise RuntimeError('This workflow requires the actual Linux descriptor API')
    with tempfile.TemporaryDirectory(prefix='slop-filesystem-workflow-') as directory:
        parent = Path(directory)
        root = parent / 'workspace'
        root.mkdir()
        secret = parent / 'outside-secret'
        secret.write_bytes(b'Harmless outside-root sentinel')
        (root / 'old').write_bytes(b'before')
        (root / 'deleted').write_bytes(b'remove')
        capture = FilesystemCapture(root)
        capture.snapshot('before-command')
        (root / 'old').write_bytes(b'after')
        (root / 'deleted').unlink()
        (root / 'new').write_bytes(b'new bytes')
        (root / 'link').symlink_to(secret)
        os.mkfifo(root / 'pipe')
        capture.snapshot('after-traced-command')
        (root / 'new').rename(root / 'moved')
        capture.snapshot('after-post-collector-probe')
        result = capture.result()
        assert result['state'] == 'incomplete' and result['executionAuthorized'] is False
        assert 'filesystem-symlink-target-not-followed' in result['visibilityGaps']
        assert 'filesystem-special-file-not-opened' in result['visibilityGaps']
        bodies = {base64.b64decode(value) for value in result['objects'].values()}
        assert bodies == {b'before', b'remove', b'after', b'new bytes'}
        assert secret.read_bytes() not in bodies
        assert {'path': 'old', 'observed': 'changed'} in [
            {'path': row['path'], 'observed': row['observed']} for row in result['changes']]
        assert not any(row['observed'] == 'renamed' for row in result['changes'])
        assert any(row['path'] == 'new' and row['observed'] == 'absent' for row in result['changes'])
        assert any(row['path'] == 'moved' and row['observed'] == 'added' for row in result['changes'])
        limited = parent / 'limited'
        limited.mkdir()
        (limited / 'large').write_bytes(b'x' * (FilesystemCapture.MAX_BYTES + 1))
        overflow = FilesystemCapture(limited)
        overflow.snapshot('before-command')
        assert 'filesystem-object-size-limit' in overflow.result()['visibilityGaps']
        assert overflow.result()['objects'] == {}
        # A path replaced by a symlink between lstat and O_PATH must never open its target.
        raced = parent / 'raced'
        raced.mkdir()
        target = raced / 'regular'
        target.write_bytes(b'original')
        original_open = os.open
        replaced = False
        def racing_open(path, flags, *args, **kwargs):
            nonlocal replaced
            if path == 'regular' and flags & os.O_PATH and not replaced:
                target.unlink()
                target.symlink_to(secret)
                replaced = True
            return original_open(path, flags, *args, **kwargs)
        os.open = racing_open
        try:
            raced_capture = FilesystemCapture(raced)
            raced_capture.snapshot('before-command')
        finally:
            os.open = original_open
        assert replaced
        assert 'filesystem-entry-unreadable-or-changed' in raced_capture.result()['visibilityGaps']
        assert raced_capture.result()['objects'] == {}
        churn = parent / 'churn'
        churn.mkdir()
        for index in range(100):
            (churn / str(index)).write_bytes(('before-' + str(index)).encode())
        changing = FilesystemCapture(churn)
        changing.snapshot('before-command')
        for index in range(100):
            (churn / str(index)).write_bytes(('after-' + str(index)).encode())
        changing.snapshot('after-traced-command')
        for index in range(100):
            (churn / str(index)).write_bytes(('last-' + str(index)).encode())
        changing.snapshot('after-post-collector-probe')
        assert 'filesystem-object-count-limit' in changing.result()['visibilityGaps'] or 'filesystem-metadata-limit' in changing.result()['visibilityGaps']
        assert len(changing.result()['objects']) <= 256
        # The real metadata budget stops deep long paths before serial framing expands them.
        wide = parent / 'wide'
        wide.mkdir()
        nested = wide
        for index in range(7):
            nested = nested / ('x' * 240)
            nested.mkdir()
        for index in range(128):
            (nested / str(index)).write_bytes(b'same')
        large_metadata = FilesystemCapture(wide)
        for phase in ('before-command', 'after-traced-command', 'after-post-collector-probe'):
            large_metadata.snapshot(phase)
        assert 'filesystem-metadata-limit' in large_metadata.result()['visibilityGaps']
        print('Actual filesystem capture, refusal, limit and replacement workflows passed')


if __name__ == '__main__':
    main()
