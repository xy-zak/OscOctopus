// One status vocabulary for every pill, lamp and dot (docs/ARCHITECTURE.md › Design rules).
import type { EndpointState, PeerState } from '../ipc/types';

export type Tone = 'ok' | 'warn' | 'bad' | 'off';

const TONES: Record<EndpointState | PeerState, Tone> = {
  ready: 'ok',
  connected: 'ok',
  starting: 'warn',
  connecting: 'warn',
  retrying: 'warn',
  error: 'bad',
  refused: 'bad',
  disabled: 'off',
};

/** How an endpoint's or a peer's state reads; nothing known yet is `off`. */
export const toneOf = (state: EndpointState | PeerState | undefined): Tone =>
  state ? TONES[state] : 'off';
