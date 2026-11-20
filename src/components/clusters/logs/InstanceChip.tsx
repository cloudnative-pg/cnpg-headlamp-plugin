import Box from '@mui/material/Box';
import { alpha } from '@mui/material/styles';
import { LogColors } from './logTheme';

/**
 * An instance name in a chip tinted with its role's color (the same green/blue as the role tags);
 * neutral when the role is unknown.
 */
export function InstanceChip({
  name,
  role,
  colors,
}: {
  name: string;
  role: string | undefined;
  colors: LogColors;
}) {
  const color = role === 'primary' || role === 'replica' ? colors.role[role] : undefined;
  return (
    <Box
      component="span"
      title={name}
      sx={{
        fontFamily: 'monospace',
        px: 0.75,
        py: 0.1,
        minWidth: 0,
        border: '1px solid',
        borderColor: color ?? 'divider',
        bgcolor: theme =>
          color ? alpha(color, theme.palette.mode === 'dark' ? 0.2 : 0.1) : 'transparent',
        borderRadius: 0.5,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {name}
    </Box>
  );
}
