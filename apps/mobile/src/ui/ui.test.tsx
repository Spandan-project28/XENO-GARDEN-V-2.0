import { fireEvent, screen } from '@testing-library/react-native';
import { Droplets, Leaf } from 'lucide-react-native';
import { themes } from '@/design';
import { renderWithProviders } from '@/test/render';
import {
  Badge,
  Banner,
  Button,
  Card,
  ChipGroup,
  EmptyState,
  Gauge,
  IconButton,
  ListGroup,
  ListRow,
  MetricTile,
  RangeSlider,
  Screen,
  SegmentedControl,
  SkeletonCard,
  Slider,
  Text,
  TextField,
  Toggle,
} from './index';
import { snap } from './Slider';

describe('ui primitives render in both themes', () => {
  it.each([themes.dark, themes.light])('Screen + Card + Text ($name)', async (theme) => {
    await renderWithProviders(
      <Screen title="Garden" subtitle="All good" eyebrow="Good morning">
        <Card>
          <Text>Hello</Text>
        </Card>
      </Screen>,
      { theme },
    );
    expect(screen.getByText('Garden')).toBeOnTheScreen();
    expect(screen.getByText('Hello')).toBeOnTheScreen();
    expect(screen.getByRole('header')).toHaveTextContent('Garden');
  });
});

describe('Button', () => {
  it('fires onPress and exposes accessibility state', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<Button title="Water now" icon={Droplets} onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Water now' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('does not fire while loading', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<Button title="Save" loading onPress={onPress} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeBusy();
  });
  it('IconButton has an accessible name', async () => {
    await renderWithProviders(<IconButton icon={Leaf} accessibilityLabel="Plants" />);
    expect(screen.getByRole('button', { name: 'Plants' })).toBeOnTheScreen();
  });
});

describe('selection controls', () => {
  it('SegmentedControl changes value', async () => {
    const onChange = jest.fn();
    await renderWithProviders(
      <SegmentedControl
        options={[
          { value: 'auto', label: 'Auto' },
          { value: 'manual', label: 'Manual' },
        ]}
        value="auto"
        onChange={onChange}
      />,
    );
    await fireEvent.press(screen.getByTestId('segment-manual'));
    expect(onChange).toHaveBeenCalledWith('manual');
    await fireEvent.press(screen.getByTestId('segment-auto')); // already selected → no-op
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ChipGroup selects', async () => {
    const onChange = jest.fn();
    await renderWithProviders(
      <ChipGroup
        options={[
          { value: '24h', label: '24H' },
          { value: '7d', label: '7D' },
        ]}
        value="24h"
        onChange={onChange}
      />,
    );
    expect(screen.getByTestId('chip-24h')).toBeSelected();
    await fireEvent.press(screen.getByTestId('chip-7d'));
    expect(onChange).toHaveBeenCalledWith('7d');
  });

  it('Toggle is a switch', async () => {
    const onChange = jest.fn();
    await renderWithProviders(<Toggle value={false} onChange={onChange} accessibilityLabel="Rain lockout" />);
    await fireEvent.press(screen.getByRole('switch', { name: 'Rain lockout' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('Slider supports accessibility increment', async () => {
    const onChange = jest.fn();
    await renderWithProviders(<Slider min={0} max={100} step={5} value={50} onChange={onChange} accessibilityLabel="Runtime" />);
    await fireEvent(screen.getByLabelText('Runtime'), 'accessibilityAction', { nativeEvent: { actionName: 'increment' } });
    expect(onChange).toHaveBeenCalledWith(55);
  });

  it('RangeSlider renders its value', async () => {
    await renderWithProviders(
      <RangeSlider min={0} max={100} low={30} high={45} onChange={jest.fn()} accessibilityLabel="Moisture range" />,
    );
    expect(screen.getByLabelText('Moisture range')).toHaveAccessibilityValue({ text: '30 to 45' });
  });

  it('snap clamps and rounds to step', () => {
    expect(snap(47, 0, 100, 5)).toBe(45);
    expect(snap(48, 0, 100, 5)).toBe(50);
    expect(snap(-3, 0, 100, 5)).toBe(0);
    expect(snap(130, 10, 120, 10)).toBe(120);
  });
});

describe('display components', () => {
  it('Gauge shows value or dash', async () => {
    const { rerender } = await renderWithProviders(<Gauge value={42.6} label="Soil moisture" />);
    expect(screen.getByText('43')).toBeOnTheScreen();
    await rerender(<Gauge value={null} label="Soil moisture" />);
    expect(screen.getByText('—')).toBeOnTheScreen();
  });

  it('MetricTile is announced as one element', async () => {
    await renderWithProviders(
      <MetricTile icon={Droplets} label="Humidity" value="55" unit="%" color="#0af" background="#013" />,
    );
    expect(screen.getByLabelText('Humidity: 55%')).toBeOnTheScreen();
  });

  it('TextField shows errors and toggles secure entry', async () => {
    await renderWithProviders(<TextField label="Password" secure error="Too short" value="abc" />);
    expect(screen.getByText('Too short')).toBeOnTheScreen();
    expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByLabelText('Password')).toHaveProp('secureTextEntry', false);
  });

  it('EmptyState action', async () => {
    const onAction = jest.fn();
    await renderWithProviders(<EmptyState icon={Leaf} title="No devices" actionLabel="Add device" onAction={onAction} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add device' }));
    expect(onAction).toHaveBeenCalled();
  });

  it('ListGroup, ListRow, Badge, Banner, SkeletonCard render', async () => {
    const onPress = jest.fn();
    await renderWithProviders(
      <>
        <ListGroup title="Device">
          <ListRow title="Rename" onPress={onPress} />
          <ListRow title="Firmware" value="2.0.0" />
        </ListGroup>
        <Badge label="Online" color="#0f0" dot pulse />
        <Banner tone="offline" title="You're offline" />
        <SkeletonCard />
      </>,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Rename' }));
    expect(onPress).toHaveBeenCalled();
    expect(screen.getByText('2.0.0')).toBeOnTheScreen();
    expect(screen.getByText('Online')).toBeOnTheScreen();
    expect(screen.getByRole('alert')).toHaveTextContent(/offline/);
    expect(screen.getByLabelText('Loading')).toBeOnTheScreen();
  });
});
