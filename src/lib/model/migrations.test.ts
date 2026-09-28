import { describe, expect, it } from 'vitest';
import { newPreset } from './factory';
import { colorFromId, migratePreset, PresetError } from './migrations';
import { CURRENT_SCHEMA_VERSION } from './preset';

describe('migratePreset', () => {
  it('accepts a fresh preset unchanged', () => {
    const p = newPreset();
    expect(migratePreset(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
  it('rejects newer schema versions with a clear message', () => {
    expect(() => migratePreset({ ...newPreset(), schemaVersion: 99 })).toThrow(/update the app/);
  });
  it('reports the failing path', () => {
    const p = newPreset() as unknown as { widgets: { x: number }[] };
    p.widgets[0]!.x = -1;
    expect(() => migratePreset(p)).toThrow(/widgets\.0\.x/);
  });
  it('rejects non-objects', () => {
    expect(() => migratePreset([])).toThrow(PresetError);
    expect(() => migratePreset({})).toThrow(/schemaVersion/);
  });
});

describe('v1 → v2: toggle buttons become switches', () => {
  it('converts toggle-mode buttons and leaves others alone', () => {
    const v2 = newPreset();
    const [a, b] = v2.widgets.filter((w) => w.type === 'button' || w.type === 'switch');
    const v1 = {
      ...JSON.parse(JSON.stringify(v2)),
      schemaVersion: 1,
      widgets: [
        { ...a, type: 'button', props: { mode: 'momentary', onValue: 1, offValue: 0 } },
        {
          ...b,
          type: 'button',
          label: 'Old toggle',
          props: { mode: 'toggle', onValue: 5, offValue: 2 },
        },
      ],
    };
    const migrated = migratePreset(v1);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.widgets[0]).toMatchObject({ type: 'button', props: { mode: 'momentary' } });
    expect(migrated.widgets[1]).toMatchObject({
      type: 'switch',
      label: 'Old toggle',
      props: { onValue: 5, offValue: 2 },
      bindings: b!.bindings,
    });
  });
});

describe('v2 → v3: colours become palette indices', () => {
  it('maps CSS colours to the nearest RAINBOW index and keeps null as theme accent', () => {
    const v3 = newPreset();
    const v2 = {
      ...JSON.parse(JSON.stringify(v3)),
      schemaVersion: 2,
      theme: { accent: '#39d0b4', radius: 14 },
      widgets: v3.widgets.slice(0, 2).map((w, i) => ({ ...w, color: i === 0 ? '#ff0000' : null })),
    };
    const migrated = migratePreset(v2);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect('theme' in migrated).toBe(false); // v4: the palette is global now
    expect(migrated.widgets[0]!.color).toBe(0);
    expect(migrated.widgets[1]!.color).toBeNull();
  });
});

describe('v3 → v4: the palette becomes global', () => {
  it('drops the per-preset theme and keeps everything else', () => {
    const v4 = newPreset();
    const v3 = {
      ...JSON.parse(JSON.stringify(v4)),
      schemaVersion: 3,
      theme: { palette: 'neon', accent: 2 },
    };
    const migrated = migratePreset(v3);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect('theme' in migrated).toBe(false);
    expect(migrated.widgets).toEqual(v4.widgets);
  });
});

describe('v4 → v5: desks get an identity colour', () => {
  it('derives a stable palette index from the id', () => {
    const v5 = newPreset();
    const v4 = { ...JSON.parse(JSON.stringify(v5)), schemaVersion: 4 };
    delete v4.color;
    const a = migratePreset(structuredClone(v4));
    const b = migratePreset(structuredClone(v4));
    expect(a.color).toBe(colorFromId(v5.id));
    expect(a.color).toBe(b.color); // same desk, same colour, on every device
    expect(a.color).toBeGreaterThanOrEqual(0);
    expect(a.color).toBeLessThan(10);
  });
});

describe('v5 → v6: buttons get the arm-then-fire option', () => {
  it('adds arm defaults without touching existing props', () => {
    const v6 = newPreset();
    const v5 = { ...JSON.parse(JSON.stringify(v6)), schemaVersion: 5 };
    for (const w of v5.widgets) {
      if (w.type === 'button') {
        delete w.props.arm;
        delete w.props.armTimeoutMs;
        delete w.props.holdMs;
        w.props.onValue = 7;
      }
    }
    const migrated = migratePreset(v5);
    const button = migrated.widgets.find((w) => w.type === 'button');
    expect(button).toBeDefined();
    expect(button!.props).toMatchObject({
      arm: 'none',
      armTimeoutMs: 3000,
      holdMs: 800,
      onValue: 7,
    });
  });
});

describe('v6 → v7: pads become a numbered grid', () => {
  it('drops the note props and points old channels at the new ones', () => {
    const v7 = newPreset();
    const v6 = { ...JSON.parse(JSON.stringify(v7)), schemaVersion: 6 };
    v6.widgets = [
      {
        id: 'w-pads',
        type: 'pads',
        x: 0,
        y: 0,
        w: 4,
        h: 4,
        label: 'Pads 1',
        color: null,
        props: {
          rows: 2,
          cols: 3,
          mode: 'toggle',
          velocity: 'fixed',
          fixedVelocity: 1,
          baseNote: 36,
          midiChannel: 1,
        },
        bindings: [
          {
            id: 'b1',
            enabled: true,
            outputIds: [],
            address: '/pads/{index}',
            args: [
              { kind: 'value', type: 'i', channel: 'on' },
              { kind: 'value', type: 'f', channel: 'velocity' },
              { kind: 'value', type: 'm' },
              { kind: 'const', type: 's', value: 'x' },
            ],
          },
        ],
      },
    ];
    const pads = migratePreset(v6).widgets[0]!;
    expect(pads.props).toEqual({ rows: 2, cols: 3, mode: 'toggle' });
    expect(pads.bindings[0]!.address).toBe('/pads/{number}');
    expect(pads.bindings[0]!.args).toEqual([
      { kind: 'value', type: 'i', channel: 'on' },
      { kind: 'value', type: 'f', channel: 'on' },
      { kind: 'value', type: 'i', channel: 'number' },
      { kind: 'const', type: 's', value: 'x' },
    ]);
  });
});

describe('v7 → v8: messages can also be received', () => {
  it('turns `enabled` into `send` and adds receiving, switched off', () => {
    const current = newPreset();
    const v7 = {
      ...current,
      schemaVersion: 7,
      widgets: current.widgets.map((w, n) => ({
        ...w,
        bindings: w.bindings.map(
          ({ send: _send, receive: _r, sourceIds: _s, forward: _f, ...b }) => ({
            ...b,
            enabled: n !== 0,
          }),
        ),
      })),
    };
    const migrated = migratePreset(JSON.parse(JSON.stringify(v7)));
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const [first, second] = migrated.widgets;
    expect(first!.bindings[0]).toMatchObject({
      send: false,
      receive: false,
      sourceIds: [],
      forward: false,
    });
    expect(second!.bindings[0]).toMatchObject({
      send: true,
      receive: false,
      sourceIds: [],
      forward: false,
    });
    expect(first!.bindings[0]).not.toHaveProperty('enabled');
  });
});

describe('v8 → v9: knobs become faders', () => {
  const knob = (id: string, mode: 'bounded' | 'endless', args: unknown[], address: string) => ({
    id,
    type: 'knob',
    x: 0,
    y: 0,
    w: 2,
    h: 2,
    label: `Knob ${id}`,
    color: 3,
    props: {
      mode,
      min: -1,
      max: 5,
      step: 0.5,
      curve: 'exp',
      defaultValue: 2,
      deltaStep: 1,
      detentPx: 12,
      maxRateHz: 30,
    },
    bindings: [
      {
        id: `b${id}`,
        send: true,
        outputIds: [],
        receive: true,
        sourceIds: [],
        forward: false,
        address,
        args,
      },
    ],
  });

  it('keeps place, range, curve, rate and messages; one value replaces value and delta', () => {
    const current = newPreset();
    const v8 = {
      ...JSON.parse(JSON.stringify(current)),
      schemaVersion: 8,
      widgets: [
        knob('k1', 'bounded', [{ kind: 'value', type: 'f' }], '/pot'),
        knob(
          'k2',
          'endless',
          [
            { kind: 'value', type: 'f', channel: 'delta' },
            { kind: 'const', type: 's', value: 'x' },
            { kind: 'value', type: 'i', channel: 'value' },
          ],
          '/enc/{delta}/{value}',
        ),
      ],
    };
    const migrated = migratePreset(v8);
    expect(migrated.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const [bounded, endless] = migrated.widgets;
    expect(bounded).toMatchObject({
      id: 'k1',
      type: 'slider',
      x: 0,
      y: 0,
      w: 2,
      h: 2,
      label: 'Knob k1',
      color: 3,
      props: {
        orientation: 'vertical',
        min: -1,
        max: 5,
        step: 0.5,
        curve: 'exp',
        touch: 'relative',
        defaultValue: 2,
        maxRateHz: 30,
      },
    });
    expect(bounded!.props).not.toHaveProperty('mode');
    expect(bounded!.bindings[0]).toMatchObject({ address: '/pot', receive: true });
    expect(endless!.type).toBe('slider');
    expect(endless!.bindings[0]!.address).toBe('/enc/{value}/{value}');
    expect(endless!.bindings[0]!.args).toEqual([
      { kind: 'value', type: 'f' },
      { kind: 'const', type: 's', value: 'x' },
      { kind: 'value', type: 'i' },
    ]);
  });
});

describe('v9 → v10', () => {
  it('keeps a v9 desk exactly as it was (the new widget types need no change)', () => {
    const cur = newPreset();
    const old = { ...JSON.parse(JSON.stringify(cur)), schemaVersion: 9 };
    expect(migratePreset(old)).toEqual(cur);
  });
});

describe('v10 → v11: widgets can hide their title and value', () => {
  it('shows both on every widget, as before', () => {
    const cur = newPreset();
    const old = JSON.parse(JSON.stringify(cur)) as { schemaVersion: number; widgets: object[] };
    old.schemaVersion = 10;
    for (const w of old.widgets) delete (w as { show?: unknown }).show;
    const migrated = migratePreset(old);
    expect(migrated).toEqual(cur);
    expect(migrated.widgets.every((w) => w.show.title && w.show.value)).toBe(true);
  });
});
