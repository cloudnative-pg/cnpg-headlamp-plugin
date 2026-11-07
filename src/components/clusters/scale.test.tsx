// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScaleAction } from './scale';

// The RBAC result AuthVisible reports; each test sets it before rendering.
let authResult = { allowed: true };

vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  AuthVisible: ({ onAuthResult }: { onAuthResult: (r: { allowed: boolean }) => void }) => {
    // Reports the result once, like the real component's resolved SelfSubjectAccessReview.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useEffect } = require('react');
    useEffect(() => onAuthResult(authResult), []);
    return null;
  },
  ActionButton: ({
    description,
    onClick,
    iconButtonProps,
  }: {
    description: string;
    onClick: () => void;
    iconButtonProps?: { disabled?: boolean };
  }) => (
    <button aria-label={description} onClick={onClick} disabled={iconButtonProps?.disabled}>
      {description}
    </button>
  ),
}));

vi.mock('notistack', () => ({ useSnackbar: () => ({ enqueueSnackbar: vi.fn() }) }));

function makeCluster(overrides: Record<string, unknown> = {}) {
  return {
    getName: () => 'pg',
    instances: 2,
    isSwitchoverInProgress: false,
    setInstances: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as any;
}

describe('ScaleAction RBAC', () => {
  afterEach(cleanup);

  beforeEach(() => {
    authResult = { allowed: true };
  });

  it('enables the button when the user may patch the cluster', () => {
    render(<ScaleAction cluster={makeCluster()} />);
    expect((screen.getByRole('button', { name: 'Scale' }) as HTMLButtonElement).disabled).toBe(
      false
    );
  });

  it('disables (not hides) the button for a read-only user and never patches', () => {
    authResult = { allowed: false };
    const cluster = makeCluster();
    render(<ScaleAction cluster={cluster} />);

    const button = screen.getByRole('button', { name: 'Scale' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(cluster.setInstances).not.toHaveBeenCalled();
  });

  it('disables the button while a switchover is in progress', () => {
    render(<ScaleAction cluster={makeCluster({ isSwitchoverInProgress: true })} />);
    expect((screen.getByRole('button', { name: 'Scale' }) as HTMLButtonElement).disabled).toBe(
      true
    );
  });
});
