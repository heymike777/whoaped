import React from 'react';
import { Composition } from 'remotion';
import { LaunchVideo } from './Video';

export const Root: React.FC = () => (
  <Composition id="WhoApedLaunch" component={LaunchVideo}
    width={1080} height={1080} fps={30} durationInFrames={900} />
);
