// Two steps, so the window shows something at once: this small entry paints the launch screen
// (views/Launch.svelte), and the app itself is a separate chunk that loads, mounts and starts
// behind it. The launch screen closes once the app is ready, or has failed to start.
import { mount, unmount } from 'svelte';
import './app.css';
import { errorText } from './lib/util';
import Launch from './views/Launch.svelte';

const target = document.getElementById('app');
if (!target) throw new Error('#app element missing from index.html');

let started!: () => void;
const ready = new Promise<void>((resolve) => (started = resolve));
let closed!: () => void;
const launched = new Promise<void>((resolve) => (closed = resolve));

const launch = mount(Launch, {
  target: document.body,
  props: {
    ready,
    ondone: () => {
      void unmount(launch);
      closed();
    },
  },
});

import('./App.svelte')
  .then(({ default: App }) => mount(App, { target, props: { onready: started, launched } }))
  .catch((e: unknown) => {
    target.textContent = `OscOctopus could not load: ${errorText(e)}`;
    started();
  });
