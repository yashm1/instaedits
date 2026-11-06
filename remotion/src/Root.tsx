import React from 'react';
import {Composition} from 'remotion';
import {scenes} from './Scenes';

export const FPS = 30;

// One composition per scene (id "s1", "s2", ...). Scenes.tsx is generated per job.
export const Root: React.FC = () => (
  <>
    {scenes.map((s) => (
      <Composition
        key={s.id}
        id={s.id}
        component={s.Component}
        durationInFrames={s.durationInFrames}
        fps={FPS}
        width={1080}
        height={1920}
      />
    ))}
  </>
);
