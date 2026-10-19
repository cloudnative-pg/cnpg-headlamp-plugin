import { Router } from '@kinvolk/headlamp-plugin/lib';
import {
  ColumnType,
  Link,
  ResourceListView,
  ResourceTableColumn,
} from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Button from '@mui/material/Button';
import type { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { Publication } from '../../resources/publication';
import { AppliedStatusLabel } from '../common/AppliedStatusLabel';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { ListPageHeader, SummaryStat } from '../common/ListHeader';
import { launchPublicationCreate } from './Create';

const { createRouteURL } = Router;

export function PublicationAppliedLabel({ publication }: { publication: Publication }) {
  return <AppliedStatusLabel applied={publication.applied} message={publication.message} />;
}

export function PublicationTargetSummary({ publication }: { publication: Publication }) {
  if (publication.isAllTables) {
    return <>All Tables</>;
  }
  const count = publication.objects.length;
  return (
    <>
      {count} object{count === 1 ? '' : 's'}
    </>
  );
}

function publicationStats(items: Publication[]): SummaryStat[] {
  const total = items.length;
  const applied = items.filter(item => item.applied === true).length;
  const needsAttention = items.filter(item => item.applied === false).length;
  return [
    { value: total, label: total === 1 ? 'Publication' : 'Publications' },
    { value: applied, label: 'Applied' },
    { value: needsAttention, label: 'Needs attention', highlight: needsAttention > 0 },
  ];
}

function publicationColumns(): (ResourceTableColumn<Publication> | ColumnType)[] {
  return [
    {
      id: 'name',
      label: 'Name',
      getValue: (item: Publication) => item.getName(),
      render: (item: Publication) => <Link kubeObject={item} />,
    },
    'namespace',
    {
      id: 'cluster',
      label: 'Cluster',
      getValue: (item: Publication) => item.clusterName,
    },
    {
      id: 'pgName',
      label: 'PG Name',
      getValue: (item: Publication) => item.pgName,
    },
    {
      id: 'dbname',
      label: 'Database',
      getValue: (item: Publication) => item.dbname,
    },
    {
      id: 'target',
      label: 'Target',
      getValue: (item: Publication) =>
        item.isAllTables ? 'All Tables' : `${item.objects.length} objects`,
      render: (item: Publication) => <PublicationTargetSummary publication={item} />,
    },
    {
      id: 'applied',
      label: 'Status',
      getValue: (item: Publication) => (item.applied ? 'Applied' : item.message ?? 'Unknown'),
      render: (item: Publication) => <PublicationAppliedLabel publication={item} />,
    },
    'age',
  ];
}

function publicationActions(): ReactNode[] {
  return [
    <AuthDisabledButton
      key="create-publication"
      item={Publication}
      authVerb="create"
      deniedMessage="You don't have permission to create Publications."
    >
      <Button variant="contained" color="primary" onClick={() => launchPublicationCreate()}>
        Create Publication
      </Button>
    </AuthDisabledButton>,
  ];
}

function PublicationListTitleDefault() {
  const [publications] = Publication.useList();
  return (
    <ListPageHeader
      title="Publications"
      actions={publicationActions()}
      stats={publicationStats(publications ?? [])}
    />
  );
}

export function PublicationsList() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const clusterFilter = params.get('cluster');
  const namespaceFilter = params.get('namespace');

  // "View Publications" on the Cluster detail page links here with ?cluster=&namespace= to
  // pre-filter — same client-side-filter approach as DatabasesList, since Publication has no
  // label back to its cluster.
  const [allPublications] = Publication.useList({
    namespace: namespaceFilter ?? undefined,
  });
  const filteredPublications = clusterFilter
    ? (allPublications ?? []).filter(item => item.clusterName === clusterFilter)
    : null;

  if (clusterFilter) {
    return (
      <ResourceListView
        title={
          <ListPageHeader
            title={`Publications for ${clusterFilter}`}
            actions={publicationActions()}
            stats={publicationStats(filteredPublications ?? [])}
          />
        }
        backLink={createRouteURL('CNPG Cluster', {
          namespace: namespaceFilter,
          name: clusterFilter,
        })}
        data={filteredPublications}
        id="cnpg-publications"
        columns={publicationColumns()}
      />
    );
  }

  return (
    <ResourceListView
      title={<PublicationListTitleDefault />}
      resourceClass={Publication}
      id="cnpg-publications"
      columns={publicationColumns()}
    />
  );
}
