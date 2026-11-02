import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { StyleSheet, Text } from 'react-native';
import { lightColors, type ThemeColors } from '../theme';
import { BalanceChanges } from './BalanceChanges';

jest.mock('../themeContext', () => ({
  useThemedStyles: (createStyles: (colors: ThemeColors) => object) => ({
    styles: createStyles(require('../theme').lightColors),
  }),
}));

describe('mobile balance changes', () => {
  let root: TestRenderer.ReactTestRenderer;
  afterEach(() => { act(() => root?.unmount()); });
  it('preserves small fee amounts and distinguishes incoming and outgoing balances', () => {
    act(() => { root = TestRenderer.create(<BalanceChanges lines={['−0.000005 SOL', '+25 USDC']} />); });
    const texts = root.root.findAllByType(Text);
    const fee = texts.find(node => node.props.children === '−0.000005')!;
    const incoming = texts.find(node => node.props.children === '+25')!;
    expect(StyleSheet.flatten(fee.props.style).color).toBe(lightColors.destructive);
    expect(StyleSheet.flatten(incoming.props.style).color).toBe(lightColors.positive);
    expect(fee.props.numberOfLines).toBeUndefined();
    expect(texts.map(node => node.props.children)).toEqual(expect.arrayContaining(['SOL', 'USDC']));
  });
  it('does not present missing history as a zero balance change', () => {
    act(() => { root = TestRenderer.create(<BalanceChanges />); });
    expect(root.root.findAllByType(Text).map(node => node.props.children)).toContain('Balance changes unavailable');
  });
});
