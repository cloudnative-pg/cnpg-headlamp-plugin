import Alert from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Typography from '@mui/material/Typography';
import { ClusterWarning } from '../../resources/cluster';
import { formatElapsedSince } from '../common/formatElapsed';

/**
 * Prominent banner for the cluster detail page while WAL archiving is failing. The cluster
 * badge stays Healthy (the database is serving), but this is a data-protection and disk-space
 * risk that must not go unnoticed.
 */
export function WalArchivingAlert({ warnings }: { warnings: ClusterWarning[] }) {
  const warning = warnings.find(w => w.id === 'wal-archiving');
  if (!warning) {
    return null;
  }
  const failingFor = formatElapsedSince(warning.since);

  return (
    <Alert severity="error">
      <AlertTitle>WAL archiving is failing{failingFor ? ` — for ${failingFor}` : ''}</AlertTitle>
      {warning.details} Check the ObjectStore and the Barman Cloud plugin logs.
      {warning.conditionMessage && (
        <Typography
          variant="caption"
          component="div"
          sx={{ mt: 0.5, fontFamily: 'monospace', wordBreak: 'break-word' }}
        >
          {warning.conditionMessage}
        </Typography>
      )}
    </Alert>
  );
}
