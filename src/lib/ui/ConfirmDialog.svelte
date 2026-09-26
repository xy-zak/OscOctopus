<script lang="ts">
  // The one confirmation dialog (see confirmAction in state/ui.svelte.ts). A TUI box over a
  // dithered backdrop. Only the confirm button resolves true; Esc, CANCEL and clicking the
  // backdrop all resolve false. Focus starts on CANCEL so a stray Enter can't confirm.
  import { ui } from '../state/ui.svelte';

  let cancelBtn = $state<HTMLButtonElement>();
  $effect(() => {
    if (ui.confirm) cancelBtn?.focus();
  });

  function onkeydown(e: KeyboardEvent) {
    if (!ui.confirm) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      ui.confirm.resolve(false);
    }
  }
</script>

<svelte:window {onkeydown} />

{#if ui.confirm}
  {@const c = ui.confirm}
  <div
    class="backdrop"
    role="presentation"
    onpointerdown={(e) => e.target === e.currentTarget && c.resolve(false)}
  >
    <div
      class="dialog"
      class:danger={c.danger}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
    >
      <header><span id="confirm-title" class="title">{c.title}</span></header>
      <p class="message">{c.message}</p>
      {#each c.details ?? [] as line (line)}
        <p class="detail">· {line}</p>
      {/each}
      <div class="actions">
        <button class="btn" bind:this={cancelBtn} onclick={() => c.resolve(false)}>Cancel</button>
        <button
          class="btn"
          class:primary={!c.danger}
          class:danger-fill={c.danger}
          onclick={() => c.resolve(true)}>{c.confirmLabel}</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    padding: 2ch;
    background: repeating-conic-gradient(rgb(0 0 0 / 0.75) 0 25%, rgb(0 0 0 / 0.45) 0 50%) 0 0 / 4px
      4px;
    animation: fade var(--t-release) steps(3, end);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  .dialog {
    position: relative;
    width: min(60ch, 100%);
    padding: 20px 2ch 14px;
    border: 1px solid var(--accent);
    background: var(--bg-2);
    box-shadow: 6px 6px 0 0 var(--shadow-px);
    animation: pop var(--t-release) steps(3, end);
  }
  .dialog.danger {
    border-color: var(--danger);
  }
  @keyframes pop {
    from {
      transform: translateY(10px);
    }
  }
  header {
    position: absolute;
    top: 0;
    left: 1ch;
    translate: 0 -50%;
  }
  .title {
    padding: 0 1ch;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 700;
    text-transform: uppercase;
  }
  .danger .title {
    background: var(--danger);
    color: var(--bg);
  }
  p {
    margin: 0 0 6px;
  }
  .detail {
    color: var(--fg-dim);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 1ch;
    margin-top: 14px;
  }
  .danger-fill {
    background: var(--danger);
    border-color: var(--danger);
    color: var(--bg);
    font-weight: 700;
  }
</style>
