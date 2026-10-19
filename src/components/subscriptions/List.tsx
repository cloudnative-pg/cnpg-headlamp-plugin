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
import { Subscription } from '../../resources/subscription';
import { AppliedStatusLabel } from '../common/AppliedStatusLabel';
import { AuthDisabledButton } from '../common/AuthDisabledButton';
import { ListPageHeader, SummaryStat } from '../common/ListHeader';
import { launchSubscriptionCreate } from './Create';

const { createRouteURL } = Router;

export function SubscriptionAppliedLabel({ subscription }: { subscription: Subscription }) {
  return <AppliedStatusLabel applied={subscription.applied} message={subscription.message} />;
}

function subscriptionStats(items: Subscription[]): SummaryStat[] {
  const total = items.length;
  const applied = items.filter(item => item.applied === true).length;
  const needsAttention = items.filter(item => item.applied === false).length;
  return [
    { value: total, label: total === 1 ? 'Subscription' : 'Subscriptions' },
    { value: applied, label: 'Applied' },
    { value: needsAttention, label: 'Needs attention', highlight: needsAttention > 0 },
  ];
}

function subscriptionColumns(): (ResourceTableColumn<Subscription> | ColumnType)[] {
  return [
    {
      id: 'name',
      label: 'Name',
      getValue: (item: Subscription) => item.getName(),
      render: (item: Subscription) => <Link kubeObject={item} />,
    },
    'namespace',
    {
      id: 'cluster',
      label: 'Cluster',
      getValue: (item: Subscription) => item.clusterName,
    },
    {
      id: 'pgName',
      label: 'PG Name',
      getValue: (item: Subscription) => item.pgName,
    },
    {
      id: 'dbname',
      label: 'Database',
      getValue: (item: Subscription) => item.dbname,
    },
    {
      id: 'publication',
      label: 'Publication',
      getValue: (item: Subscription) => item.publicationName,
    },
    {
      id: 'externalCluster',
      label: 'Publisher (External Cluster)',
      getValue: (item: Subscription) => item.externalClusterName,
    },
    {
      id: 'applied',
      label: 'Status',
      getValue: (item: Subscription) => (item.applied ? 'Applied' : item.message ?? 'Unknown'),
      render: (item: Subscription) => <SubscriptionAppliedLabel subscription={item} />,
    },
    'age',
  ];
}

function subscriptionActions(): ReactNode[] {
  return [
    <AuthDisabledButton
      key="create-subscription"
      item={Subscription}
      authVerb="create"
      deniedMessage="You don't have permission to create Subscriptions."
    >
      <Button variant="contained" color="primary" onClick={() => launchSubscriptionCreate()}>
        Create Subscription
      </Button>
    </AuthDisabledButton>,
  ];
}

function SubscriptionListTitleDefault() {
  const [subscriptions] = Subscription.useList();
  return (
    <ListPageHeader
      title="Subscriptions"
      actions={subscriptionActions()}
      stats={subscriptionStats(subscriptions ?? [])}
    />
  );
}

export function SubscriptionsList() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const clusterFilter = params.get('cluster');
  const namespaceFilter = params.get('namespace');

  // "View Subscriptions" on the Cluster detail page links here with ?cluster=&namespace= to
  // pre-filter — same client-side-filter approach as DatabasesList, since Subscription has no
  // label back to its (subscriber) cluster.
  const [allSubscriptions] = Subscription.useList({
    namespace: namespaceFilter ?? undefined,
  });
  const filteredSubscriptions = clusterFilter
    ? (allSubscriptions ?? []).filter(item => item.clusterName === clusterFilter)
    : null;

  if (clusterFilter) {
    return (
      <ResourceListView
        title={
          <ListPageHeader
            title={`Subscriptions for ${clusterFilter}`}
            actions={subscriptionActions()}
            stats={subscriptionStats(filteredSubscriptions ?? [])}
          />
        }
        backLink={createRouteURL('CNPG Cluster', {
          namespace: namespaceFilter,
          name: clusterFilter,
        })}
        data={filteredSubscriptions}
        id="cnpg-subscriptions"
        columns={subscriptionColumns()}
      />
    );
  }

  return (
    <ResourceListView
      title={<SubscriptionListTitleDefault />}
      resourceClass={Subscription}
      id="cnpg-subscriptions"
      columns={subscriptionColumns()}
    />
  );
}
