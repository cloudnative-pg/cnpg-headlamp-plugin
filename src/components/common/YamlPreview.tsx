import { Icon } from '@iconify/react';
import Editor from '@monaco-editor/react';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import FormControlLabel from '@mui/material/FormControlLabel';
import { useTheme } from '@mui/material/styles';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { dump, load } from 'js-yaml';
import { useMemo, useState } from 'react';

interface YamlPreviewProps {
  manifest: object;
  title?: string;
  /** Called while the "Edit" switch is on: with the parsed object on every keystroke that yields
   *  valid YAML, or with `null` once the switch is turned back off. The caller should submit this
   *  value instead of `manifest` whenever it isn't `null` — that's what makes the edit an
   *  override rather than something this component can apply back onto the form by itself. */
  onOverrideChange?: (override: object | null) => void;
}

// A collapsed-by-default, syntax-highlighted preview of the manifest a Create form is about to
// submit. Read-only by default, mirroring the form as it's filled in; an "Edit" switch turns it
// into a free-form editor for the rare case the form doesn't cover, at the cost of no longer
// reflecting further form changes while it's on (same tradeoff a raw kubectl edit would have).
// Uses the same Monaco editor Headlamp's own YAML dialogs use.
export function YamlPreview({ manifest, title = 'Review YAML', onOverrideChange }: YamlPreviewProps) {
  const theme = useTheme();
  const formYaml = useMemo(() => dump(manifest), [manifest]);
  const [editing, setEditing] = useState(false);
  const [editedYaml, setEditedYaml] = useState(formYaml);
  const [parseError, setParseError] = useState<string | null>(null);

  function handleEditingChange(next: boolean) {
    setEditing(next);
    setParseError(null);
    if (next) {
      // Seed the editable copy with the form's current YAML instead of whatever was left over
      // from a previous edit.
      setEditedYaml(formYaml);
    } else {
      // Back to read-only: drop the override so the form drives the manifest again.
      onOverrideChange?.(null);
    }
  }

  function handleChange(value: string | undefined) {
    const text = value ?? '';
    setEditedYaml(text);
    try {
      const parsed = load(text);
      if (parsed && typeof parsed === 'object') {
        setParseError(null);
        onOverrideChange?.(parsed as object);
      } else {
        setParseError('YAML must describe an object.');
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Invalid YAML.');
    }
  }

  return (
    <Accordion sx={{ mt: 2 }}>
      <AccordionSummary expandIcon={<Icon icon="mdi:chevron-down" />}>
        <Typography sx={{ flexGrow: 1, alignSelf: 'center' }}>{title}</Typography>
        {!!onOverrideChange && (
          <FormControlLabel
            label="Edit"
            control={
              <Switch
                size="small"
                checked={editing}
                onChange={(_, checked) => handleEditingChange(checked)}
              />
            }
            // Stops the switch from also toggling the accordion open/closed — AccordionSummary
            // treats the whole row as its click target otherwise.
            onClick={e => e.stopPropagation()}
            onFocus={e => e.stopPropagation()}
          />
        )}
      </AccordionSummary>
      <AccordionDetails sx={{ p: 0 }}>
        {editing && (
          <Typography variant="caption" color={parseError ? 'error' : 'text.secondary'} sx={{ display: 'block', p: 1 }}>
            {parseError
              ? `${parseError} — the last valid version below will be submitted instead.`
              : 'Editing overrides the form above — further form changes will be ignored.'}
          </Typography>
        )}
        <Editor
          height="400px"
          language="yaml"
          theme={theme.palette.mode === 'dark' ? 'vs-dark' : 'light'}
          value={editing ? editedYaml : formYaml}
          onChange={editing ? handleChange : undefined}
          options={{
            readOnly: !editing,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            automaticLayout: true,
          }}
        />
      </AccordionDetails>
    </Accordion>
  );
}
