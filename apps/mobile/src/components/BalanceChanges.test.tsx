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
  it('omits the whole section when there are no balance changes', () => {
    act(() => { root = TestRenderer.create(<BalanceChanges />); });
    expect(root.toJSON()).toBeNull();
    act(() => { root.update(<BalanceChanges lines={[' ', '']} />); });
    expect(root.toJSON()).toBeNull();
  });
  it('uses a red divider and label for failed transactions with real balance changes', () => {
    act(() => { root = TestRenderer.create(<BalanceChanges lines={['−0.000005 SOL']} failed />); });
    const label = root.root.findAllByType(Text).find(node => node.props.children === 'NET CHANGE')!;
    expect(StyleSheet.flatten(label.props.style).color).toBe(lightColors.destructive);
    expect(StyleSheet.flatten(root.root.findByProps({ testID: 'balance-changes' }).props.style).borderTopColor).toBe(`${lightColors.destructive}30`);
  });
});
