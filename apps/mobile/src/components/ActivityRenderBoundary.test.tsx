import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

import { ActivityRenderBoundary } from './ActivityRenderBoundary';

jest.mock('../themeContext', () => ({
  useThemedStyles: (createStyles: (colors: object) => object) => ({
    styles: createStyles(require('../theme').lightColors),
  }),
}));
jest.mock('./SolscanButton', () => ({ SolscanButton: () => null }));
jest.mock('../lib/crashReporting', () => ({ recordActivityRenderError: jest.fn() }));

function BrokenActivity(): React.ReactNode {
  throw new Error('Malformed historical activity');
}

it('keeps the feed mounted when one activity card cannot render', () => {
  const report = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  let root: TestRenderer.ReactTestRenderer;
  act(() => {
    root = TestRenderer.create(<ActivityRenderBoundary activityId="bad-activity" onOpenSolscan={jest.fn()}>
      <BrokenActivity />
    </ActivityRenderBoundary>);
  });
  expect(root!.root.findAllByType(Text).map(node => node.props.children)).toContain('Transaction couldn’t be displayed');
  expect(report).toHaveBeenCalled();
  act(() => root!.unmount());
  report.mockRestore();
});
