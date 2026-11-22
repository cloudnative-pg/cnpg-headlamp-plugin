// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthDisabledButton } from './AuthDisabledButton';

let allowedNamespaces: string[] = [];
let authResult = { allowed: false };
const authChecks = vi.fn();

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  Utils: { getCluster: () => 'c1' },
  K8s: { cluster: { getAllowedNamespaces: () => allowedNamespaces } },
}));
vi.mock('@kinvolk/headlamp-plugin/lib/CommonComponents', () => ({
  AuthVisible: ({ onAuthResult }: { onAuthResult: (r: { allowed: boolean }) => void }) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { useEffect } = require('react');
    useEffect(() => {
      authChecks();
      onAuthResult(authResult);
    }, []);
    return null;
  },
}));

function renderButton(hint: boolean) {
  render(
    <AuthDisabledButton
      item={null}
      authVerb="create"
      deniedMessage="denied"
      allowedNamespacesHint={hint}
    >
      <button>Create</button>
    </AuthDisabledButton>
  );
  return screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement;
}

describe('AuthDisabledButton allowedNamespacesHint', () => {
  afterEach(() => {
    cleanup();
    authChecks.mockClear();
    allowedNamespaces = [];
    authResult = { allowed: false };
  });

  it('enables without checking when Allowed Namespaces is set', () => {
    allowedNamespaces = ['team-a'];
    expect(renderButton(true).disabled).toBe(false);
    expect(authChecks).not.toHaveBeenCalled();
  });

  it('still disables on a denied check when Allowed Namespaces is not set', () => {
    expect(renderButton(true).disabled).toBe(true);
    expect(authChecks).toHaveBeenCalled();
  });

  it('ignores Allowed Namespaces unless the hint is requested', () => {
    allowedNamespaces = ['team-a'];
    expect(renderButton(false).disabled).toBe(true);
  });
});
