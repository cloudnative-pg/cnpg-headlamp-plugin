export interface DecodedExecFrame {
  channel: number;
  text: string;
}

// Exec stream channels: 0 stdin, 1 stdout, 2 stderr, 3 server error, 4 resize.
function decodeBytes(bytes: Uint8Array): DecodedExecFrame | null {
  if (bytes.length === 0) {
    return null;
  }
  const channel = bytes[0] as number;
  return { channel, text: new TextDecoder().decode(bytes.slice(1)) };
}

/** Decodes one exec websocket frame. Frames arrive either as binary (first byte is the
 *  channel, rest is UTF-8 — the form Headlamp itself consumes) or, when the base64
 *  subprotocol is negotiated, as text (first char is the channel, rest is base64).
 *  Returns null for empty/unrecognized frames. */
export function decodeExecFrame(frame: unknown): DecodedExecFrame | null {
  if (typeof frame === 'string') {
    if (!/^[0-9]/.test(frame)) {
      return null;
    }
    const channel = Number(frame.charAt(0));
    try {
      const binary = atob(frame.slice(1));
      const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
      return { channel, text: new TextDecoder().decode(bytes) };
    } catch {
      return null;
    }
  }
  if (frame instanceof ArrayBuffer) {
    return decodeBytes(new Uint8Array(frame));
  }
  if (ArrayBuffer.isView(frame)) {
    return decodeBytes(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength));
  }
  return null;
}

/** Minimal surface of a Pod needed to exec. Structural (rather than the SDK Pod class) so
 *  this module stays free of Headlamp runtime imports and unit-testable — any
 *  `K8s.ResourceClasses.Pod` instance satisfies it. */
export interface ExecCapablePod {
  exec(
    container: string,
    onExec: (frame: unknown) => void,
    options?: {
      command?: string[];
      stdin?: boolean;
      stdout?: boolean;
      stderr?: boolean;
      tty?: boolean;
      reconnectOnFailure?: boolean;
      failCb?: () => void;
    }
  ): {
    cancel: () => void;
    getSocket: () => WebSocket | null;
  };
}

// Runs a one-shot command in a pod container and captures stdout/stderr. The apiserver
// closes the socket once the process exits, so completion is observed as the stream's close
// (failCb) — the caller decides success from the collected output.
export function execCommand(
  pod: ExecCapablePod,
  container: string,
  command: string[],
  timeoutMs = 60000
): { result: Promise<{ stdout: string; stderr: string }>; cancel: () => void } {
  let cancelStream = () => {};
  const result = new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const settle = (fn: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn();
      }
    };
    const timer = setTimeout(() => {
      cancelStream();
      settle(() => reject(new Error('Timed out waiting for the command output.')));
    }, timeoutMs);
    const { cancel } = pod.exec(container, onFrame, {
      command,
      stdin: false,
      stdout: true,
      stderr: true,
      tty: false,
      reconnectOnFailure: false,
      failCb: () => settle(() => resolve({ stdout, stderr })),
    });
    cancelStream = cancel;

    function onFrame(frame: unknown) {
      const decoded = decodeExecFrame(frame);
      if (!decoded) {
        return;
      }
      if (decoded.channel === 1) {
        stdout += decoded.text;
      } else if (decoded.channel === 2 || decoded.channel === 3) {
        stderr += decoded.text;
      }
    }
  });
  return { result, cancel: () => cancelStream() };
}
