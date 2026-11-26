import { describe, expect, it, vi } from 'vitest';
import { decodeExecFrame, ExecCapablePod,execCommand } from './podExec';

describe('decodeExecFrame', () => {
  it('decodes binary frames (channel byte + UTF-8)', () => {
    const bytes = new Uint8Array([1, ...new TextEncoder().encode('[{"a":1}]')]);
    expect(decodeExecFrame(bytes.buffer)).toEqual({ channel: 1, text: '[{"a":1}]' });
  });

  it('decodes base64 text frames (channel char + base64)', () => {
    // '1' + base64('hi')
    expect(decodeExecFrame('1aGk=')).toEqual({ channel: 1, text: 'hi' });
  });

  it('rejects empty and unrecognized frames', () => {
    expect(decodeExecFrame('')).toBeNull();
    expect(decodeExecFrame('oops')).toBeNull();
    expect(decodeExecFrame(new ArrayBuffer(0))).toBeNull();
    expect(decodeExecFrame(null)).toBeNull();
  });
});

function frame(channel: number, text: string): ArrayBuffer {
  const bytes = new Uint8Array([channel, ...new TextEncoder().encode(text)]);
  return bytes.buffer;
}

// A fake pod capturing the exec call so completion can be driven manually.
function mockPod() {
  const calls: {
    container: string;
    onFrame: (frame: unknown) => void;
    failCb?: () => void;
  }[] = [];
  const pod: ExecCapablePod = {
    exec: (container, onFrame, options) => {
      calls.push({ container, onFrame, failCb: options?.failCb });
      return { cancel: vi.fn(), getSocket: () => null };
    },
  };
  return { pod, calls };
}

describe('execCommand', () => {
  it('accumulates stdout/stderr across frames and resolves on close', async () => {
    const { pod, calls } = mockPod();
    const { result } = execCommand(pod, 'server', ['klio', 'admin', 'list-backups']);
    calls[0].onFrame(frame(1, '[{"a"'));
    calls[0].onFrame(frame(1, ':1}]'));
    calls[0].onFrame(frame(2, 'warn'));
    calls[0].failCb?.();
    await expect(result).resolves.toEqual({ stdout: '[{"a":1}]', stderr: 'warn' });
  });

  it('rejects on timeout', async () => {
    const { pod } = mockPod();
    const { result } = execCommand(pod, 'server', ['sleep', '60'], 10);
    await expect(result).rejects.toThrow('Timed out waiting for the command output.');
  });
});
