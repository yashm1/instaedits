import React from 'react';
import {Hook, Flow, Fanout, Compare, Stat} from './lib';

export const scenes: {id: string; durationInFrames: number; Component: React.FC}[] = [
  {
    id: 's1',
    durationInFrames: 54,
    Component: () => (
      <Hook text="Millions of likes. Every second." hot={['Millions', 'second']} tag="HLD" />
    ),
  },
  {
    id: 's2',
    durationInFrames: 54,
    Component: () => (
      <Flow
        title="Step one"
        nodes={[
          {label: 'Client', icon: 'client'},
          {label: 'Load Balancer', icon: 'lb'},
        ]}
        highlight={1}
        tag="01"
      />
    ),
  },
  {
    id: 's3',
    durationInFrames: 54,
    Component: () => (
      <Fanout
        title="Stateless API servers"
        from={{label: 'Load Balancer', icon: 'lb'}}
        to={[
          {label: 'API', icon: 'api'},
          {label: 'API', icon: 'api'},
          {label: 'API', icon: 'api'},
        ]}
        tag="02"
      />
    ),
  },
  {
    id: 's4',
    durationInFrames: 54,
    Component: () => (
      <Compare
        left={{title: 'Kafka first', points: ['Absorbs the write']}}
        right={{title: 'Database', points: ['Not hit directly']}}
        tag="03"
      />
    ),
  },
  {
    id: 's5',
    durationInFrames: 54,
    Component: () => <Hook text="Spikes never crash it" hot={['never']} />,
  },
  {
    id: 's6',
    durationInFrames: 54,
    Component: () => (
      <Flow
        title="Batched writes"
        nodes={[
          {label: 'Kafka', icon: 'queue'},
          {label: 'Workers', icon: 'server', note: 'batch'},
          {label: 'Cassandra', icon: 'db'},
        ]}
        highlight={2}
        tag="04"
      />
    ),
  },
  {
    id: 's7',
    durationInFrames: 66,
    Component: () => <Stat value="99.99%" label="uptime" tag="RESULT" />,
  },
];
