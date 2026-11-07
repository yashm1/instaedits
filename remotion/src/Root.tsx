import React from 'react';
import {Composition} from 'remotion';
import {Reel, type ReelProps} from './Reel';
import {canvas} from './lib/theme';

// One composition: the finished picture. Props (video, scenes, zooms, assets, screens) come from the pipeline's reel.json.
const sample: ReelProps = {video: 'tight.mp4', duration: 4, scenes: [{id: 's1', start: 0.1, dur: 3, kind: 'Hook', props: {text: 'Preview', hot: ['Preview']}}], zooms: []};

export const Root: React.FC = () => (
  <Composition
    id="reel"
    component={Reel as unknown as React.FC<Record<string, unknown>>}
    defaultProps={sample as unknown as Record<string, unknown>}
    calculateMetadata={({props}) => ({durationInFrames: Math.max(1, Math.round(Number((props as unknown as ReelProps).duration) * canvas.fps))})}
    durationInFrames={120}
    fps={canvas.fps}
    width={canvas.width}
    height={canvas.height}
  />
);
